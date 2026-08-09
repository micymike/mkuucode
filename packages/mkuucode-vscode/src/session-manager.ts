import type { OpencodeClient } from "@opencode-ai/sdk/client"

export class SessionManager {
  private sessionID?: string

  async getOrCreate(client: OpencodeClient, directory: string): Promise<string> {
    if (this.sessionID) return this.sessionID

    const created = await client.session.create({
      query: { directory },
    })

    if (created.error || !created.data) {
      throw new Error(errorText(created.error))
    }

    this.sessionID = (created.data as { id: string }).id
    return this.sessionID
  }

  reset(): void {
    this.sessionID = undefined
  }
}

function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as { name?: string; data?: { message?: string } }
    if (anyErr.data?.message) return anyErr.data.message
    if (anyErr.name) return anyErr.name
  }

  return String(err)
}
