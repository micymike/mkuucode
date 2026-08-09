// Self-contained VSIX packaging. vsce enumerates git-tracked files with the
// repository root, which, because mkuucode-vscode lives inside the OpenCode
// monorepo, would drag in the entire repo. Stage only the extension's required
// files into a temp dir and run vsce there so the package stays small and clean.
import { createRequire } from "node:module"
import { cpSync, mkdtempSync, realpathSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = dirname(fileURLToPath(import.meta.url))
const vsce = resolve(require.resolve("@vscode/vsce/package.json"), "..", "vsce")
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version

const files = ["package.json", "README.md", "LICENSE", ".vscodeignore", "dist/", "resources/"]

try {
  execFileSync(process.execPath, [join(root, "build.js")], { cwd: root, stdio: "inherit" })
} catch {
  process.exit(1)
}

const stage = mkdtempSync(join(realpathSync(tmpdir()), "mkuucode-"))
try {
  for (const f of files) {
    cpSync(join(root, f), join(stage, f), { recursive: true })
  }
  const out = join(root, `mkuucode-vscode-${version}.vsix`)
  const result = spawnSync(process.execPath, [vsce, "package", "--out", out], {
    cwd: stage,
    stdio: "inherit",
  })
  process.exit(result.status ?? 1)
} finally {
  rmSync(stage, { recursive: true, force: true })
}