import * as esbuild from "esbuild"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))

fs.mkdirSync(path.join(root, "dist", "media"), { recursive: true })
fs.copyFileSync(path.join(root, "src", "media", "main.js"), path.join(root, "dist", "media", "main.js"))
fs.copyFileSync(path.join(root, "src", "media", "main.css"), path.join(root, "dist", "media", "main.css"))

const options = {
  entryPoints: [path.join(root, "src", "extension.ts")],
  outfile: path.join(root, "dist", "extension.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
}

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log("watching for changes…")
} else {
  await esbuild.build(options)
}