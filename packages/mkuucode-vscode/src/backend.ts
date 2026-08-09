import type { ChildProcess } from "node:child_process"
import type { OpencodeClient, Part } from "@opencode-ai/sdk/client"

import { AGENT_ID } from "./mkuucode.js"
import { createClient } from "./opencode-client.js"
import { startOpenCodeServer, stopOpenCodeServer } from "./opencode-process.js"
import { SessionManager } from "./session-manager.js"

export interface PromptResult {
  reply: string
  activity: string[]
}

export interface ToolStreamEvent {
  type: "tool"
  content: string
  callID: string
  tool: string
  title: string
  status: "pending" | "running" | "completed" | "error"
}

export type StreamEvent =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | ToolStreamEvent

export class MkuuCodeBackend {
  private proc?: ChildProcess
  private client?: OpencodeClient
  private directory: string
  private storeDir: string
  private ready: Promise<void> | undefined
  private sessionManager = new SessionManager()
  private sendQueue: Promise<void> = Promise.resolve()

  // A single long-lived yet non-retried event subscription drives all
  // streaming. Opening and closing one SSE stream per prompt leaks sockets and
  // eventually makes the server refuse new connections ("fetch failed"), so we
  // start it once at bootstrap and filter by the active session.
  private streamStream?: AsyncIterable<unknown>
  private streamAbort?: AbortController
  private activeSessionID?: string
  private promptAbort?: AbortController

  constructor(
    directory: string,
    storeDir: string,
    private readonly onStatus?: (status: string) => void,
    private readonly onStream?: (event: StreamEvent) => void,
  ) {
    this.directory = directory
    this.storeDir = storeDir
  }

  dispose(): void {
    this.promptAbort?.abort()
    this.streamAbort?.abort()
    stopOpenCodeServer(this.proc)
    this.proc = undefined
    this.client = undefined
    this.ready = undefined
    this.sessionManager.reset()
  }

  stop(): void {
    this.promptAbort?.abort()
  }

  resetSession(): void {
    this.sessionManager.reset()
  }

  async send(raw: string): Promise<PromptResult> {
    const run = async () => {
      await this.ensureStarted()
      const client = this.client
      if (!client) throw new Error("MkuuCode backend not connected")

      const sessionID = await this.sessionManager.getOrCreate(client, this.directory)
      this.activeSessionID = sessionID

      const controller = new AbortController()
      this.promptAbort = controller

      let prompt
      try {
        prompt = await client.session.prompt({
          path: { id: sessionID },
          query: { directory: this.directory },
          body: {
            agent: AGENT_ID,
            parts: [{ type: "text", text: raw }],
          },
          signal: controller.signal as never,
        })
      } finally {
        this.promptAbort = undefined
        this.activeSessionID = undefined
      }

      if (prompt.error || !prompt.data) throw new Error(errorText(prompt.error))

      const parts: Part[] = (prompt.data as { parts: Part[] }).parts
      return { reply: collectText(parts), activity: collectActivity(parts) }
    }

    const previous = this.sendQueue
    const next = previous.then(run)
    this.sendQueue = next.then(() => undefined, () => undefined)
    return await next
  }

  private forwardStreamEvent(event: unknown): void {
    const onStream = this.onStream
    const sessionID = this.activeSessionID
    if (!onStream || !sessionID) return

    if (typeof event !== "object" || event === null) return
    const evt = event as { type?: string; properties?: { part?: Part; sessionID?: string } }
    if (evt.type !== "message.part.updated") return
    const part = evt.properties?.part
    if (!part || part.sessionID !== sessionID) return

    if (part.type === "reasoning") {
      onStream({ type: "thinking", content: part.text })
    } else if (part.type === "text") {
      onStream({ type: "text", content: part.text })
    } else if (part.type === "tool") {
      const state = part.state
      if (!state || state.status === "pending") return
      const title = state.status === "completed" ? state.title : (state as { title?: string }).title ?? part.tool
      const detail = state.status === "error" ? (state as { error?: string }).error : title
      onStream({
        type: "tool",
        content: `tool: ${part.tool} — ${detail}`,
        callID: part.callID,
        tool: part.tool,
        title,
        status: state.status,
      })
    }
  }

  private ensureStarted(): Promise<void> {
    if (!this.ready) {
      this.ready = this.bootstrap().catch((error) => {
        this.ready = undefined
        throw error
      })
    }

    return this.ready
  }

  private async bootstrap(): Promise<void> {
    const { port, proc } = await startOpenCodeServer(this.directory, this.storeDir, this.onStatus)
    this.proc = proc
    this.client = createClient(`http://127.0.0.1:${port}`, this.directory)

    const abort = new AbortController()
    this.streamAbort = abort
    const sub = await this.client.event.subscribe({
      query: { directory: this.directory },
      signal: abort.signal as never,
      sseMaxRetryAttempts: 0,
    } as never)
    this.streamStream = sub.stream
    void this.drainStream(sub.stream)
  }

  private async drainStream(stream: AsyncIterable<unknown>): Promise<void> {
    try {
      for await (const event of stream) {
        this.forwardStreamEvent(event)
      }
    } catch {
      // Stream ended: either the backend was disposed or the subscription closed.
    }
  }
}

function collectText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

function collectActivity(parts: Part[]): string[] {
  const lines: string[] = []
  for (const part of parts) {
    if (part.type === "tool" && part.state.status === "completed") {
      lines.push(`tool: ${part.tool} — ${part.state.title}`)
    } else if (part.type === "subtask" && part.description) {
      lines.push(`subtask: ${part.description}`)
    }
  }
  return lines
}

function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as { name?: string; data?: { message?: string } }
    if (anyErr.data?.message) return anyErr.data.message
    if (anyErr.name) return anyErr.name
  }
  return String(err)
}