import { useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import hljs from "highlight.js"

declare function acquireVsCodeApi(): { postMessage: (message: unknown) => void }

const vscode = acquireVsCodeApi()

type Role = "user" | "assistant"

interface ChatMessage {
  id: number
  role: Role
  content: string
}

interface ToolStreamEvent {
  type: "tool"
  content: string
  callID: string
  tool: string
  title: string
  status: "pending" | "running" | "completed" | "error"
}

type StreamData =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | ToolStreamEvent
  | { type: "done" }

const TOOL_ICONS: Record<string, string> = {
  bash: "▸",
  read: "📖",
  edit: "✏️",
  write: "✏️",
  glob: "🔎",
  grep: "🔎",
  webfetch: "🌐",
}

function ToolRow({ tool }: { tool: ToolStreamEvent }) {
  const icon = TOOL_ICONS[tool.tool] ?? "⚙"
  const statusClass = `tool-status ${tool.status}`
  const statusLabel =
    tool.status === "completed" ? "✓" : tool.status === "error" ? "✕" : tool.status === "running" ? "◌" : "·"
  return (
    <div className={`tool-row ${tool.status}`}>
      <span className="tool-icon">{icon}</span>
      <span className={`${statusClass}`}>{statusLabel}</span>
      <span className="tool-title">
        {tool.tool}
        <span className="tool-detail">{tool.title}</span>
      </span>
    </div>
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const copy = () => {
    vscode.postMessage({ type: "copy", text: code })
  }
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(code, { language }).value
    : hljs.highlightAuto(code).value
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{language || "text"}</span>
        <button className="code-copy" onClick={copy}>
          Copy
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}

function Markdown({ content }: { content: string }) {
  const components = {
    pre({ children }: { children?: React.ReactNode }) {
      const child = Array.isArray(children) ? children[0] : children
      const codeEl = child as React.ReactElement<{ className?: string; children?: string }>
      const className = codeEl?.props?.className ?? ""
      const language = className.replace(/^language-/, "")
      const code = String(codeEl?.props?.children ?? "").replace(/\n$/, "")
      return <CodeBlock language={language} code={code} />
    },
    code({ className, children }: { className?: string; children?: React.ReactNode }) {
      // Inline code (no parent pre) stays unstyled.
      return <code className={className}>{children}</code>
    },
  }
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
      {content}
    </ReactMarkdown>
  )
}

function Message({ role, content }: { role: Role; content: string }) {
  if (role === "user") {
    return (
      <div className="message user">
        <div className="message-content">{content}</div>
      </div>
    )
  }
  return (
    <div className="message assistant">
      <Markdown content={content} />
    </div>
  )
}

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

  const chatRef = useRef<HTMLDivElement>(null)
  const nextID = useRef(0)
  const streamStarted = useRef(false)
  const textRef = useRef("")
  const thinkingRef = useRef("")
  const toolsRef = useRef<ToolStreamEvent[]>([])

  const commitStream = useCallback(() => {
    const full = textRef.current
    if (full.trim()) {
      nextID.current += 1
      setMessages((prev) => [...prev, { id: nextID.current, role: "assistant", content: full }])
    }
    textRef.current = ""
    thinkingRef.current = ""
    toolsRef.current = []
    setThinking("")
    setText("")
    setTools([])
    setStreaming(false)
    streamStarted.current = false
  }, [])

  useEffect(() => {
    vscode.postMessage({ type: "ready" })

    const onMessage = (event: MessageEvent) => {
      const message = event.data
      switch (message.type) {
        case "addMessage": {
          nextID.current += 1
          setMessages((prev) => [...prev, { id: nextID.current, role: message.role, content: message.content }])
          break
        }
        case "addActivity": {
          setTools((prev) => [
            ...prev,
            {
              type: "tool",
              content: message.content,
              callID: String(nextID.current),
              tool: "activity",
              title: message.content,
              status: "completed",
            },
          ])
          break
        }
        case "setLoading": {
          setLoading(message.value)
          setStatus(message.value ? "Running agent…" : "Idle")
          if (!message.value) {
            // A completed run without a stream "done" still needs to commit.
            if (streamStarted.current) commitStream()
          }
          break
        }
        case "status": {
          setStatus(message.text)
          break
        }
        case "theme": {
          setTheme(message.kind === "dark" ? "dark" : "light")
          break
        }
        case "clear": {
          setMessages([])
          setThinking("")
          setText("")
          setTools([])
          setStreaming(false)
          streamStarted.current = false
          textRef.current = ""
          thinkingRef.current = ""
          toolsRef.current = []
          break
        }
        case "stream": {
          const data = message.data as StreamData
          if (data.type === "done") {
            commitStream()
          } else if (data.type === "thinking") {
            streamStarted.current = true
            thinkingRef.current = data.content
            setThinking(data.content)
            setStreaming(true)
          } else if (data.type === "text") {
            streamStarted.current = true
            textRef.current = data.content
            setText(data.content)
            setStreaming(true)
          } else if (data.type === "tool") {
            toolsRef.current = [...toolsRef.current.filter((t) => t.callID !== data.callID), data]
            setTools(toolsRef.current)
            setStreaming(true)
          }
          break
        }
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [commitStream])

  // Smart auto-scroll: stick to the bottom unless the user scrolled up to read.
  const [stuck, setStuck] = useState(true)
  const onScroll = () => {
    const el = chatRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setStuck(distance < 48)
  }
  const jumpToLatest = () => {
    const el = chatRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      setStuck(true)
    }
  }
  useEffect(() => {
    if (stuck) {
      const el = chatRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [messages, thinking, text, tools, stuck])

  const submit = () => {
    const value = prompt.trim()
    if (!value || loading) return
    vscode.postMessage({ type: "sendPrompt", text: value })
    setPrompt("")
  }

  const stop = () => {
    vscode.postMessage({ type: "stop", text, thinking })
  }

  const newSession = () => {
    vscode.postMessage({ type: "newSession" })
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const showStream = streaming || thinking || text || tools.length > 0
  const thinkingOpen = streaming && !text

  return (
    <>
      <div className="header">
        <div className="header-left">
          <span className="status-dot" />
          <span className="status-text">{status}</span>
        </div>
        <div className="header-right">
          <button className="btn small" onClick={newSession} title="New session">
            New session
          </button>
        </div>
      </div>
      <div className="chat" ref={chatRef} onScroll={onScroll} data-theme={theme}>
        {messages.map((m) => (
          <Message key={m.id} role={m.role} content={m.content} />
        ))}
        {showStream && (
          <div className="message assistant">
            {thinking && (
              <details className="thinking" open={thinkingOpen}>
                <summary>Thinking…</summary>
                <div>{thinking}</div>
              </details>
            )}
            {tools.map((t, i) => (
              <ToolRow key={`${t.callID}-${i}`} tool={t} />
            ))}
            {text && (
              <div className="markdown">
                <Markdown content={text} />
                {streaming && <span className="caret" />}
              </div>
            )}
          </div>
        )}
        {!stuck && (
          <button className="jump-pill" onClick={jumpToLatest}>
            ↓ Jump to latest
          </button>
        )}
      </div>
      <div className="input-container">
        <textarea
          id="prompt"
          className="prompt"
          placeholder="Ask MkuuCode…  ( /plan /review /test /explain /fix )"
          value={prompt}
          disabled={loading}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKey}
        />
        {loading ? (
          <button id="stop-btn" className="send stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button id="send-btn" className="send" onClick={submit}>
            Send
          </button>
        )}
      </div>
    </>
  )
}

createRoot(document.getElementById("root")!).render(<App />)