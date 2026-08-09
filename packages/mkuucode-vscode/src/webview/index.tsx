import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

declare function acquireVsCodeApi(): { postMessage: (message: unknown) => void }

const vscode = acquireVsCodeApi()

type Role = "user" | "assistant"

interface ChatMessage {
  id: number
  role: Role
  content: string
}

interface StreamData {
  type: "thinking" | "text" | "tool" | "done"
  content?: string
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
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}

type StreamState =
  | { active: false; streamed: boolean }
  | { active: true; thinking: boolean; streamed: boolean }

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState("")
  const [status, setStatus] = useState("Idle")
  const [loading, setLoading] = useState(false)
  const [stream, setStream] = useState<StreamState>({ active: false, streamed: false })
  const [thinking, setThinking] = useState("")
  const [text, setText] = useState("")
  const [tools, setTools] = useState<string[]>([])
  const chatRef = useRef<HTMLDivElement>(null)
  const nextID = useRef(0)

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
          setTools((prev) => [...prev, message.content])
          break
        }
        case "setLoading": {
          setLoading(message.value)
          setStatus(message.value ? "Running agent…" : "Idle")
          break
        }
        case "stream": {
          const data = message.data as StreamData
          if (data.type === "done") {
            setStream({ active: false, streamed: true })
            setThinking("")
            setText("")
            setTools([])
          } else if (data.type === "thinking") {
            setThinking(data.content ?? "")
            setStream({ active: true, streamed: true, thinking: true })
          } else if (data.type === "text") {
            setText(data.content ?? "")
            setStream({ active: true, streamed: true, thinking: false })
          } else if (data.type === "tool") {
            setTools((prev) => [...prev, data.content ?? ""])
            setStream({ active: true, streamed: true, thinking: false })
          }
          break
        }
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking, text, tools, stream])

  const submit = () => {
    const value = prompt.trim()
    if (!value || loading) return
    vscode.postMessage({ type: "sendPrompt", text: value })
    setPrompt("")
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <>
      <div className="status">{status}</div>
      <div className="chat" ref={chatRef}>
        {messages.map((m) => (
          <Message key={m.id} role={m.role} content={m.content} />
        ))}
        {stream.active && (
          <div className="message assistant">
            {stream.thinking && thinking && <div className="thinking">{thinking}</div>}
            {text && (
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              </div>
            )}
            {tools.map((t, i) => (
              <div key={i} className="activity">
                {t}
              </div>
            ))}
          </div>
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
        <button id="send-btn" className="send" disabled={loading} onClick={submit}>
          Send
        </button>
      </div>
    </>
  )
}

createRoot(document.getElementById("root")!).render(<App />)