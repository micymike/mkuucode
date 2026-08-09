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

export class MkuuCodeBackend {
  private proc?: ChildProcess
  private client?: OpencodeClient
  private directory: string
  private storeDir: string
  private ready: Promise<void> | undefined
  private sessionManager = new SessionManager()
  private sendQueue: Promise<void> = Promise.resolve()

  constructor(directory: string, storeDir: string, private readonly onStatus?: (status: string) => void) {
    this.directory = directory
    this.storeDir = storeDir
  }

  dispose(): void {
    stopOpenCodeServer(this.proc)
    this.proc = undefined
    this.client = undefined
    this.ready = undefined
    this.sessionManager.reset()
  }

  async send(raw: string): Promise<PromptResult> {
    const run = async () => {
      await this.ensureStarted()
      const client = this.client
      if (!client) throw new Error("MkuuCode backend not connected")

      const sessionID = await this.sessionManager.getOrCreate(client, this.directory)
      const prompt = await client.session.prompt({
        path: { id: sessionID },
        query: { directory: this.directory },
        body: {
          agent: AGENT_ID,
          parts: [{ type: "text", text: raw }],
        },
      })

      if (prompt.error || !prompt.data) throw new Error(errorText(prompt.error))

      const parts: Part[] = (prompt.data as { parts: Part[] }).parts
      return { reply: collectText(parts), activity: collectActivity(parts) }
    }

    const previous = this.sendQueue
    const next = previous.then(run)
    this.sendQueue = next.then(() => undefined, () => undefined)
    return await next
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