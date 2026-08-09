import { spawn, type ChildProcess } from "node:child_process"

import { mkuucodeConfig } from "./mkuucode.js"
import { resolveOpenCodeBinary } from "./opencode-binary.js"

export interface OpenCodeServerProcess {
  port: number
  proc: ChildProcess
}

export async function startOpenCodeServer(
  directory: string,
  storeDir: string,
  onStatus?: (status: string) => void,
): Promise<OpenCodeServerProcess> {
  const binary = await resolveOpenCodeBinary(storeDir, onStatus)
  const net = await import("node:net")

  const port = await new Promise<number>((resolve) => {
    const srv = net.createServer()
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number }
      srv.close(() => resolve(addr.port))
    })
  })

  const proc = spawn(binary, ["serve", "--hostname=127.0.0.1", `--port=${port}`], {
    cwd: directory,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(mkuucodeConfig()),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  await waitForHealthy(`http://127.0.0.1:${port}`, proc)
  return { port, proc }
}

export function stopOpenCodeServer(proc: ChildProcess | undefined): void {
  if (proc && !proc.killed) proc.kill()
}

async function waitForHealthy(url: string, proc: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15000
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`opencode server exited early with code ${proc.exitCode}`)

    try {
      const res = await fetch(`${url}/config`)
      if (res.ok) return
    } catch {
      // server is still warming up
    }

    if (Date.now() > deadline) throw new Error("Timed out waiting for OpenCode server")
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}
