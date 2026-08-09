import { existsSync, mkdirSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"

const FALLBACK_BASE = "https://github.com/anomalyco/opencode/releases/latest/download"

interface BinaryInfo {
  archive: ".zip" | ".tar.gz"
  bareName: string
  executableName: string
}

function platformInfo(): BinaryInfo {
  const arch = process.arch === "arm64" ? "arm64" : "x64"

  if (process.platform === "win32") {
    return {
      archive: ".zip",
      bareName: `opencode-windows-${arch}`,
      executableName: "opencode.exe",
    }
  }

  if (process.platform === "darwin") {
    return {
      archive: ".zip",
      bareName: `opencode-darwin-${arch}`,
      executableName: "opencode",
    }
  }

  return {
    archive: ".tar.gz",
    bareName: `opencode-linux-${arch}`,
    executableName: "opencode",
  }
}

function releaseBase(binary: BinaryInfo): string {
  const configured = process.env.MKUUCODE_RELEASE_URL
  if (configured && configured.trim()) return configured.trim()
  return FALLBACK_BASE
}

export async function resolveOpenCodeBinary(
  storeDir: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  const configured = process.env.OPENCODE_BINARY
  if (configured && configured.trim() && existsSync(configured.trim())) return configured.trim()

  const binary = platformInfo()
  const dir = join(storeDir, "bin")
  const executable = join(dir, binary.executableName)

  if (existsSync(executable)) return executable

  // Fall back to an `opencode` already on the user's PATH if the bundle is missing.
  const fromPath = await findOnPath()
  if (fromPath) return fromPath

  onStatus?.("Downloading the OpenCode engine (first run only)…")
  return downloadBinary(binary, dir)
}

function downloadBinary(binary: BinaryInfo, dir: string): Promise<string> {
  const url = `${releaseBase(binary)}/${binary.bareName}${binary.archive}`
  const executable = join(dir, binary.executableName)

  return (async () => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to download OpenCode binary (${res.status}): ${url}`)

    mkdirSync(dir, { recursive: true })
    const archivePath = join(dir, `opencode${binary.archive}`)
    await writeFile(archivePath, Buffer.from(await res.arrayBuffer()))

    await extractArchive(archivePath, binary)
    if (process.platform !== "win32") chmodSync(executable, 0o755)

    return executable
  })()
}

function extractArchive(archivePath: string, binary: BinaryInfo): Promise<void> {
  const dir = join(archivePath, "..")
  const args = binary.archive === ".zip" ? ["-xf", archivePath, "-C", dir] : ["-xzf", archivePath, "-C", dir]
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: "ignore" })
    child.on("error", (error) => reject(error))
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`tar extraction failed with exit code ${code}`))
      else resolve()
    })
  })
}

function writeFile(path: string, data: Buffer): Promise<void> {
  return import("node:fs").then((fs) => fs.promises.writeFile(path, data))
}

async function findOnPath(): Promise<string | undefined> {
  const pathVar = process.env.PATH ?? ""
  const separator = process.platform === "win32" ? ";" : ":"
  const exeName = "opencode.exe"
  const binName = "opencode"

  const dirs = pathVar.split(separator).filter(Boolean)
  for (const dir of dirs) {
    // Real binary, e.g. /usr/local/bin/opencode.
    const real = join(dir, binName)
    if (process.platform !== "win32" && existsSync(real)) return real

    const direct = join(dir, exeName)
    if (existsSync(direct)) return direct

    // npm global shims (opencode.cmd / opencode.ps1) resolve to a real binary
    // under node_modules/opencode-ai/bin. Follow the shim instead of spawning it.
    if (process.platform === "win32" && existsSync(join(dir, "opencode.cmd"))) {
      const viaNpm = join(dir, "node_modules", "opencode-ai", "bin", exeName)
      if (existsSync(viaNpm)) return viaNpm
    }
  }
  return undefined
}