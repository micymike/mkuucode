import { Component, useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import hljs from "highlight.js"

declare function acquireVsCodeApi(): { postMessage: (message: unknown) => void }
const vscode = acquireVsCodeApi()

// ── Error boundary — catches render crashes and shows them instead of blank ──
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "var(--vscode-errorForeground, #f14c4c)", fontFamily: "monospace", fontSize: 12 }}>
          <strong>MkuuCode render error:</strong>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{this.state.error}</pre>
          <button style={{ marginTop: 8, cursor: "pointer" }} onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

type Role = "user" | "assistant"

interface ChatMessage { id: number; role: Role; content: string }
interface ToolStreamEvent {
  type: "tool"; content: string; callID: string; tool: string; title: string
  status: "pending" | "running" | "completed" | "error"
}
type StreamData =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | ToolStreamEvent
  | { type: "done" }

interface HistorySession { id: string; title: string; createdAt: number; active: boolean; tokenCount?: number }
interface ModelInfo { id: string; name: string; provider: string }

const TOOL_ICONS: Record<string, string> = {
  bash: "⬡", read: "📖", edit: "✏️", write: "✏️", glob: "🔎",
  grep: "🔎", webfetch: "🌐", todowrite: "📋", task: "⚡",
}

// ── Tool row ──────────────────────────────────────────────────────────────────
function ToolRow({ tool }: { tool: ToolStreamEvent }) {
  const [expanded, setExpanded] = useState(false)
  const isBash = tool.tool === "bash"
  const icon = TOOL_ICONS[tool.tool] ?? "⚙"
  const statusIcon = tool.status === "completed" ? "✓" : tool.status === "error" ? "✕" : tool.status === "running" ? "◌" : "·"
  const hasOutput = Boolean(tool.content)
  return (
    <div className={`tool-row ${tool.status}${isBash ? " tool-bash" : ""}`}>
      <div className="tool-row-header" onClick={() => hasOutput && setExpanded(v => !v)} style={{ cursor: hasOutput ? "pointer" : "default" }}>
        <span className="tool-icon">{icon}</span>
        <span className={`tool-status-badge ${tool.status}`}>{statusIcon}</span>
        <span className="tool-name">{isBash ? "Terminal" : tool.tool}</span>
        <span className="tool-title-text">{tool.title}</span>
        {hasOutput && <span className="tool-expand">{expanded ? "▴" : "▾"}</span>}
      </div>
      {expanded && hasOutput && (
        <div className={`tool-output${isBash ? " tool-terminal" : ""}`}>
          <pre>{tool.content}</pre>
        </div>
      )}
    </div>
  )
}

// ── Code block ────────────────────────────────────────────────────────────────
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { vscode.postMessage({ type: "copy", text: code }); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(code, { language }).value
    : hljs.highlightAuto(code).value
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{language || "text"}</span>
        <button className="code-copy" onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
      <pre><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
    </div>
  )
}

// ── Markdown ──────────────────────────────────────────────────────────────────
function Markdown({ content }: { content: string }) {
  const components = {
    pre({ children }: { children?: React.ReactNode }) {
      const child = Array.isArray(children) ? children[0] : children
      const codeEl = child as React.ReactElement<{ className?: string; children?: string }>
      const lang = (codeEl?.props?.className ?? "").replace(/^language-/, "")
      const code = String(codeEl?.props?.children ?? "").replace(/\n$/, "")
      return <CodeBlock language={lang} code={code} />
    },
    code({ className, children }: { className?: string; children?: React.ReactNode }) {
      return <code className={className}>{children}</code>
    },
  }
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>{content}</ReactMarkdown>
}

// ── Thinking block ────────────────────────────────────────────────────────────
function ThinkingBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)
  useEffect(() => { if (!streaming) setOpen(false) }, [streaming])
  return (
    <details className="thinking" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="thinking-icon">{streaming ? "◌" : "💭"}</span>
        {streaming ? "Thinking…" : "Thought process"}
      </summary>
      <div className="thinking-body">
        <Markdown content={content} />
      </div>
    </details>
  )
}

// ── Inline diff viewer ────────────────────────────────────────────────────────
function DiffViewer({ diff, onOpenFull }: { diff: string; onOpenFull: () => void }) {
  if (!diff.trim()) return <div className="diff-empty">No file changes in this session.</div>
  const lines = diff.split("\n")
  return (
    <div className="diff-viewer">
      <div className="diff-toolbar">
        <span className="diff-title">Session diff</span>
        <button className="diff-open-btn" onClick={onOpenFull} title="Open full diff file">Open file ↗</button>
      </div>
      <div className="diff-content">
        {lines.map((line, i) => {
          const cls = line.startsWith("+") && !line.startsWith("+++") ? "diff-add"
            : line.startsWith("-") && !line.startsWith("---") ? "diff-del"
            : line.startsWith("@@") ? "diff-hunk"
            : line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++") ? "diff-meta"
            : "diff-ctx"
          return <div key={i} className={`diff-line ${cls}`}><pre>{line}</pre></div>
        })}
      </div>
    </div>
  )
}

// ── Message ───────────────────────────────────────────────────────────────────
function Message({
  msg, index, onEdit,
}: { msg: ChatMessage; index: number; onEdit: (index: number, text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.content)

  if (msg.role === "user") {
    return (
      <div className="message user">
        {editing ? (
          <div className="edit-area">
            <textarea className="edit-textarea" value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEdit(index, draft); setEditing(false) } if (e.key === "Escape") setEditing(false) }} autoFocus />
            <div className="edit-actions">
              <button className="edit-save" onClick={() => { onEdit(index, draft); setEditing(false) }}>Re-send ↵</button>
              <button className="edit-cancel" onClick={() => { setDraft(msg.content); setEditing(false) }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="message-user-inner">
            <div className="message-content">{msg.content}</div>
            <button className="msg-edit-btn" onClick={() => setEditing(true)} title="Edit and re-send">✎</button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="message assistant">
      <Markdown content={msg.content} />
    </div>
  )
}

// ── History panel ─────────────────────────────────────────────────────────────
function HistoryPanel({
  sessions, query, onQueryChange, onLoad, onDelete, onClose,
}: {
  sessions: HistorySession[]; query: string; onQueryChange: (q: string) => void
  onLoad: (id: string) => void; onDelete: (id: string) => void; onClose: () => void
}) {
  const filtered = query.trim()
    ? sessions.filter(s => s.title.toLowerCase().includes(query.toLowerCase()))
    : sessions
  return (
    <div className="history-panel">
      <div className="history-header">
        <span className="history-title">Chat History</span>
        <button className="history-close" onClick={onClose}>✕</button>
      </div>
      <div className="history-search-wrap">
        <input className="history-search" placeholder="Search…" value={query} onChange={e => onQueryChange(e.target.value)} />
      </div>
      <div className="history-list">
        {filtered.length === 0 && <div className="history-empty">{query ? "No matches" : "No previous sessions"}</div>}
        {filtered.map(s => (
          <div key={s.id} className={`history-item${s.active ? " active" : ""}`}>
            <button className="history-item-btn" onClick={() => onLoad(s.id)} title={s.title}>
              <span className="history-item-title">{s.title}</span>
              <span className="history-item-meta">
                {new Date(s.createdAt).toLocaleDateString()}
                {s.tokenCount ? ` · ${fmtTokens(s.tokenCount)}` : ""}
              </span>
            </button>
            {!s.active && <button className="history-item-delete" onClick={() => onDelete(s.id)} title="Delete">✕</button>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Model selector ────────────────────────────────────────────────────────────
function ModelSelector({ models, current, onChange }: { models: ModelInfo[]; current?: string; onChange: (id: string) => void }) {
  const grouped: Record<string, ModelInfo[]> = {}
  for (const m of models) {
    ;(grouped[m.provider] ??= []).push(m)
  }
  return (
    <select className="model-select" value={current ?? ""} onChange={e => onChange(e.target.value)} title="Select model">
      {!current && <option value="">— model —</option>}
      {Object.entries(grouped).map(([provider, ms]) => (
        <optgroup key={provider} label={provider}>
          {ms.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`
}

// ── Download progress ─────────────────────────────────────────────────────────
function StatusBar({ status, tokenTotal, lastUsage }: { status: string; tokenTotal: number; lastUsage?: { inputTokens: number; outputTokens: number } }) {
  return (
    <div className="status-bar">
      <span className="status-bar-text">{status}</span>
      {tokenTotal > 0 && (
        <span className="token-counter" title={lastUsage ? `Last: ${lastUsage.inputTokens}↑ ${lastUsage.outputTokens}↓` : undefined}>
          {fmtTokens(tokenTotal)}
        </span>
      )}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState("")
  const [status, setStatus] = useState("Idle")
  const [loading, setLoading] = useState(false)
  const [theme, setTheme] = useState<"dark" | "light">("dark")

  const [thinking, setThinking] = useState("")
  const [text, setText] = useState("")
  const [tools, setTools] = useState<ToolStreamEvent[]>([])
  const [streaming, setStreaming] = useState(false)

  const [queue, setQueue] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyQuery, setHistoryQuery] = useState("")
  const [sessions, setSessions] = useState<HistorySession[]>([])

  const [models, setModels] = useState<ModelInfo[]>([])
  const [currentModel, setCurrentModel] = useState<string | undefined>()

  const [attachedFiles, setAttachedFiles] = useState<Array<{ path: string; fullPath: string }>>([])
  const [tokenTotal, setTokenTotal] = useState(0)
  const [lastUsage, setLastUsage] = useState<{ inputTokens: number; outputTokens: number } | undefined>()

  const [diffData, setDiffData] = useState<{ diff: string; sessionId: string } | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const chatRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const nextID = useRef(0)
  const streamStarted = useRef(false)
  const textRef = useRef("")
  const thinkingRef = useRef("")
  const toolsRef = useRef<ToolStreamEvent[]>([])
  const loadingRef = useRef(false)
  const queueRef = useRef<string[]>([])

  const commitStream = useCallback((fallbackText?: string) => {
    const full = textRef.current || fallbackText || ""
    if (full.trim()) {
      nextID.current += 1
      setMessages(prev => [...prev, { id: nextID.current, role: "assistant", content: full }])
    }
    textRef.current = ""; thinkingRef.current = ""; toolsRef.current = []
    setThinking(""); setText(""); setTools([]); setStreaming(false)
    streamStarted.current = false
  }, [])

  const processQueue = useCallback(() => {
    const next = queueRef.current[0]
    if (!next) return
    queueRef.current = queueRef.current.slice(1)
    setQueue([...queueRef.current])
    vscode.postMessage({ type: "sendPrompt", text: next })
  }, [])

  useEffect(() => {
    vscode.postMessage({ type: "ready" })

    const onMessage = (event: MessageEvent) => {
      const msg = event.data
      switch (msg.type) {
        case "addMessage":
          if (msg.role === "assistant") {
            // Route assistant messages through commitStream so they never
            // double-render with an in-progress stream bubble.
            commitStream(msg.content as string)
          } else {
            nextID.current += 1
            setMessages(prev => [...prev, { id: nextID.current, role: msg.role, content: msg.content }])
          }
          break
        case "addActivity":
          setTools(prev => [...prev, { type: "tool", content: msg.content, callID: String(nextID.current), tool: "activity", title: msg.content, status: "completed" }])
          break
        case "setLoading":
          loadingRef.current = msg.value
          setLoading(msg.value)
          setStatus(msg.value ? "Running agent…" : "Idle")
          if (!msg.value) {
            // Only force-commit if a stream started but "done" never arrived
            // (e.g. stop button pressed). Normal completions send "done" first.
            if (streamStarted.current) commitStream(undefined)
            processQueue()
          }
          break
        case "status": setStatus(msg.text); break
        case "theme": setTheme(msg.kind === "dark" ? "dark" : "light"); break
        case "clear":
          setMessages([]); setThinking(""); setText(""); setTools([])
          setStreaming(false); streamStarted.current = false
          textRef.current = ""; thinkingRef.current = ""; toolsRef.current = []
          setDiffData(null); setShowDiff(false)
          break
        case "historyList": setSessions(msg.sessions as HistorySession[]); break
        case "models": setModels(msg.models as ModelInfo[]); if (msg.current) setCurrentModel(msg.current as string); break
        case "tokenCount":
          setTokenTotal(msg.total as number)
          if (msg.last) setLastUsage(msg.last as { inputTokens: number; outputTokens: number })
          break
        case "attachedFile":
          setAttachedFiles(prev => [...prev, { path: msg.path as string, fullPath: msg.fullPath as string }])
          break
        case "diffResult":
          setDiffData({ diff: msg.diff as string, sessionId: msg.sessionId as string })
          setShowDiff(true)
          break
        case "injectPrompt": setPrompt(msg.text as string); textareaRef.current?.focus(); break
        case "focusInput": textareaRef.current?.focus(); break
        case "truncateMessages":
          // fromIndex is the chatHistory index; slice the rendered messages array
          // to the same length so the UI stays in sync.
          setMessages(prev => prev.slice(0, msg.fromIndex as number))
          break
        case "stream": {
          const data = msg.data as StreamData
          if (data.type === "done") { commitStream(undefined) }
          else if (data.type === "thinking") { streamStarted.current = true; thinkingRef.current = data.content; setThinking(data.content); setStreaming(true) }
          else if (data.type === "text") { streamStarted.current = true; textRef.current = data.content; setText(data.content); setStreaming(true) }
          else if (data.type === "tool") { toolsRef.current = [...toolsRef.current.filter(t => t.callID !== data.callID), data]; setTools(toolsRef.current); setStreaming(true) }
          break
        }
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [commitStream, processQueue])

  // Auto-scroll
  const onScroll = () => {
    const el = chatRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }
  useEffect(() => {
    if (autoScroll) chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [messages, thinking, text, tools, autoScroll])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 160) + "px"
  }, [prompt])

  const buildPromptText = () => {
    let value = prompt.trim()
    if (!value) return ""
    if (attachedFiles.length > 0) {
      const refs = attachedFiles.map(f => `@${f.path}`).join(" ")
      value = `${refs}\n\n${value}`
    }
    return value
  }

  const submit = () => {
    const value = buildPromptText()
    if (!value) return
    setPrompt(""); setAttachedFiles([])
    if (loadingRef.current) {
      queueRef.current = [...queueRef.current, value]
      setQueue([...queueRef.current])
    } else {
      vscode.postMessage({ type: "sendPrompt", text: value })
    }
  }

  const cancelQueued = (idx: number) => {
    queueRef.current = queueRef.current.filter((_, i) => i !== idx)
    setQueue([...queueRef.current])
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const handleEditMessage = (index: number, newText: string) => {
    vscode.postMessage({ type: "editMessage", index, text: newText })
  }

  const showStream = streaming || thinking || text || tools.length > 0

  return (
    <>
      {/* ── Header ── */}
      <div className="header">
        <div className="header-left">
          <span className={`status-dot${loading ? " loading" : ""}`} />
          {models.length > 0
            ? <ModelSelector models={models} current={currentModel} onChange={id => { setCurrentModel(id); vscode.postMessage({ type: "setModel", modelId: id }) }} />
            : <span className="status-text">{status}</span>
          }
        </div>
        <div className="header-right">
          <button className="btn small" onClick={() => { setShowDiff(false); setShowHistory(v => !v); if (!showHistory) vscode.postMessage({ type: "loadHistory" }) }} title="Chat history">☰</button>
          <button className="btn small" onClick={() => { setAutoScroll(v => !v) }} title={autoScroll ? "Unpin scroll" : "Pin scroll"} style={{ opacity: autoScroll ? 1 : 0.5 }}>📌</button>
          <button className="btn small" onClick={() => vscode.postMessage({ type: "newSession" })} title="New conversation">＋</button>
        </div>
      </div>

      {/* ── Status bar (when model selector is shown) ── */}
      {models.length > 0 && <StatusBar status={status} tokenTotal={tokenTotal} lastUsage={lastUsage} />}

      {/* ── History panel ── */}
      {showHistory && (
        <HistoryPanel
          sessions={sessions} query={historyQuery} onQueryChange={setHistoryQuery}
          onLoad={id => { vscode.postMessage({ type: "loadSession", sessionId: id }); setShowHistory(false) }}
          onDelete={id => vscode.postMessage({ type: "deleteSession", sessionId: id })}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* ── Diff panel ── */}
      {showDiff && diffData && (
        <div className="diff-panel">
          <div className="diff-panel-header">
            <span>Changes</span>
            <button className="history-close" onClick={() => setShowDiff(false)}>✕</button>
          </div>
          <DiffViewer diff={diffData.diff} onOpenFull={() => vscode.postMessage({ type: "openDiff", diff: diffData.diff, filename: "session.diff" })} />
        </div>
      )}

      {/* ── Chat ── */}
      <div className="chat" ref={chatRef} onScroll={onScroll} data-theme={theme}>
        {messages.length === 0 && !showStream && (
          <div className="empty-state">
            <div className="empty-icon">⬡</div>
            <div className="empty-title">MkuuCode</div>
            <div className="empty-hint">Ask anything about your code</div>
            <div className="empty-commands">
              {["/plan", "/review", "/test", "/explain", "/fix"].map(cmd => (
                <button key={cmd} className="cmd-chip" onClick={() => setPrompt(cmd + " ")}>{cmd}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={m.id} msg={m} index={i} onEdit={handleEditMessage} />
        ))}
        {showStream && (
          <div className="message assistant">
            {thinking && <ThinkingBlock content={thinking} streaming={streaming && !text} />}
            {tools.map((t, i) => <ToolRow key={`${t.callID}-${i}`} tool={t} />)}
            {text && (
              <div className="markdown">
                <Markdown content={text} />
                {streaming && <span className="caret" />}
              </div>
            )}
          </div>
        )}
        {!autoScroll && (
          <button className="jump-pill" onClick={() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); setAutoScroll(true) }}>
            ↓ Jump to latest
          </button>
        )}
      </div>

      {/* ── Queue bar ── */}
      {queue.length > 0 && (
        <div className="queue-bar">
          <span className="queue-label">Queued ({queue.length}):</span>
          {queue.map((q, i) => (
            <span key={i} className="queue-item">
              <span className="queue-text">{q.slice(0, 40)}{q.length > 40 ? "…" : ""}</span>
              <button className="queue-cancel" onClick={() => cancelQueued(i)}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* ── Attached files ── */}
      {attachedFiles.length > 0 && (
        <div className="attached-bar">
          {attachedFiles.map((f, i) => (
            <span key={i} className="attached-chip">
              <span className="attached-name">📎 {f.path}</span>
              <button className="attached-remove" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* ── Input ── */}
      <div className="input-container">
        <div className="input-row">
          <button className="attach-btn" onClick={() => vscode.postMessage({ type: "attachFile" })} title="Attach file">📎</button>
          <textarea
            ref={textareaRef} id="prompt" className="prompt"
            placeholder="Ask MkuuCode…  ( /plan /review /test /explain /fix )  Shift+Enter for newline"
            value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={handleKey} rows={1}
          />
        </div>
        <div className="input-actions">
          <button className="btn small diff-btn" onClick={() => { vscode.postMessage({ type: "showDiff", sessionId: "" }); setShowHistory(false) }} title="View session diff">⊟ Diff</button>
          <button className="btn small" onClick={() => vscode.postMessage({ type: "exportChat" })} title="Export chat as Markdown">↓ Export</button>
          {loading
            ? <button id="stop-btn" className="send stop" onClick={() => vscode.postMessage({ type: "stop", text, thinking })}>■ Stop</button>
            : <button id="send-btn" className="send" onClick={submit} disabled={!prompt.trim() && attachedFiles.length === 0}>Send ↵</button>
          }
        </div>
      </div>
    </>
  )
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
