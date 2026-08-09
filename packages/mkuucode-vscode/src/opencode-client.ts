import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"

export function createClient(baseUrl: string, directory: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl,
    directory,
  })
}
