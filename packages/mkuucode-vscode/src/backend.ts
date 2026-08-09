import { spawn, type ChildProcess } from "node:child_process"
import { createOpencodeClient, type OpencodeClient, type Part } from "@opencode-ai/sdk/client"
import { AGENT_ID, mkuucodeConfig } from "./mkuucode.js"

export interface PromptResult {
  reply: string
  activity: string[]
}

export class MkuuCodeBackend {
  private proc?: ChildProcess
  private client?: OpencodeClient
  private directory: string
  private ready: Promise<void> | undefined
  private sessionID?: string

  constructor(directory: string) {
    this.directory = directory
  }

  dispose(): void {
    if (this.proc && !this.proc.killed) this.proc.kill()
    this.proc = undefined
    this.client = undefined
    this.ready = undefined
    this.sessionID = undefined
  }

  async send(raw: string): Promise<PromptResult> {
    await this.ensureStarted()
    const client = this.client
    if (!client) throw new Error("MkuuCode backend not connected")

    await this.ensureSession(client)
    if (!this.sessionID) throw new Error("MkuuCode session was not initialized")

    const prompt = await client.session.prompt({
      path: { id: this.sessionID },
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

  private async ensureSession(client: OpencodeClient): Promise<void> {
    if (this.sessionID) return

    const created = await client.session.create({
      query: { directory: this.directory },
    })
    if (created.error || !created.data) throw new Error(errorText(created.error))

    const sessionID = (created.data as { id: string }).id
    this.sessionID = sessionID
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
    const { port, proc } = await spawnServer()
    this.proc = proc
    this.client = createOpencodeClient({
      baseUrl: `http://127.0.0.1:${port}`,
      directory: this.directory,
    })
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

async function spawnServer(): Promise<{ port: number; proc: ChildProcess }> {
  const net = await import("node:net")
  const port = await new Promise<number>((resolve) => {
    const srv = net.createServer()
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number }
      srv.close(() => resolve(addr.port))
    })
  })

  const proc = spawn("opencode", ["serve", "--hostname=127.0.0.1", `--port=${port}`], {
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(mkuucodeConfig()),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  await waitForHealthy(`http://127.0.0.1:${port}`, proc)
  return { port, proc }
}

async function waitForHealthy(url: string, proc: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15000
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`opencode server exited early with code ${proc.exitCode}`)
    try {
      const res = await fetch(`${url}/config`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for OpenCode server")
    await new Promise((r) => setTimeout(r, 200))
  }
}