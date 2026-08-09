# MkuuCode — VS Code extension + OpenCode agent (prototype)

MkuuCode is a prototype coding assistant that lives *inside* VS Code, like a
GitHub-Copilot-style panel, but delegates all agent reasoning, tools, and code
generation to the **local OpenCode server** via the [OpenCode SDK](https://github.com/anomalyco/opencode).

It is a thin extension layer on top of OpenCode — it does **not** reimplement the
agent, tools, sessions, or the model loop. It registers a dedicated `mkuucode`
agent (a careful senior-SWE persona) in a self-spawned OpenCode server, then
sends prompts through the existing HTTP API.

```
VS Code webview ⇄ extension.ts ⇄ @opencode-ai/sdk/client ⇄ OpenCode server (mkuucode agent) ⇄ LLM + tools
```

## What works (first vertical slice)

- **`MkuuCode: Open`** command opens the MkuuCode sidebar chat.
- Conversation history, text input, a Send button, a loading/"Running agent…" state, basic tool/step activity, and rendered assistant replies.
- The extension **spawns its own** OpenCode server on a free local port with the `mkuucode` agent config injected (no manual server setup).
- Sending a prompt creates a session and calls the real `POST /session/{id}/message` API, passing `{ agent: "mkuucode", parts: [{ type: "text", text }] }` and correct request/response shapes.
- `/plan`, `/review`, `/test`, `/explain`, `/fix` typed into the input are expanded into the MkuuCode workflow prompts (no editing planned for `/plan`/`/review`/`/explain`).

## Requirements

- Node.js + **bun** (repo standard). `bun install` at the repo root links `@opencode-ai/sdk`.
- The `opencode` binary on your `PATH`, e.g. `npm i -g opencode` (the extension spawns `opencode serve`).

## Run locally

```bash
# 1. from the repo root, install the workspace (also installs this package)
bun install

# 2. build the extension (bundles the SDK with esbuild)
cd packages/mkuucode-vscode
bun run build          # -> dist/extension.cjs (VS Code entrypoint)

# 3. Launch in VS Code
```
Add a launch config to the repo's `.vscode/launch.json`:

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "extensionHost",
      "request": "launch",
      "name": "MkuuCode Extension Host",
      "runtimeExecutable": "${execPath}",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/packages/mkuucode-vscode"],
      "outFiles": ["${workspaceFolder}/packages/mkuucode-vscode/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```
Then in VS Code: press F5 (or the Run & Debug ▶), click the **MkuuCode** icon in
the Activity Bar, type a request (e.g. *"explain how packages/plugin/src/index.ts works"*),
and Send. The response is produced by the `mkuucode` agent engine.

> Note: `permission` is currently set to `allow` for edit/bash so the synchronous
> `session.prompt()` call completes without an interactive permission prompt. For a
> production extension, wire the SDK's permission/consent flow and the event stream
> (`event` `/event`) for live tool deltas instead of post-hoc activity.

## Commands

| Command | Effect |
| --- | --- |
| `M: Open` | open the MkuuCode sidebar |
| `M: /plan` | analyze and produce a plan, no edits |
| `M: /review` | review the current changes |
| `M: /test` | run the relevant tests, fix failures |
| `M: /explain` | explain code (or select code, then send `/explain`) |
| `M: /fix` | investigate and fix the current problem |

Typing `/plan `, `/review `, `/test `, `/explain `, or `/fix ` as the start of a
message (optionally followed by scoped text) triggers the corresponding workflow.

## Files

| File | Purpose |
| --- | --- |
| `src/extension.ts` | VS Code glue: command, sidebar webview provider, message handling, loading/error states |
| `src/backend.ts` | Spawns the OpenCode server (with agent config), creates the SDK client for the workspace dir, runs `session.prompt` |
| `src/mkuucode.ts` | The `mkuucode` agent config + senior-engineer system prompt + `/…` command prompt builders |
| `src/media/main.js`, `main.css` | The webview chat UI |
| `build.js` | Bundles the extension (and the embedded SDK) with esbuild |
| `package.json` | Extension manifest, commands, build/typecheck scripts |

## Verification

From `packages/mkuucode-vscode`:
- `bun run build` — bundles the SDK + extension into `dist/extension.cjs`.
- `bun run typecheck` — `tsc --noEmit` (exit 0).

## What's intentionally NOT done yet

- Streaming/live activity via the SSE event stream (activity is read from the
  completed assistant message's parts).
- A permission/consent dialog for `ask`-scoped tool requests.
- Using an already-running OpenCode daemon to avoid spawning a server per session
  (the extension currently spawns and disposes its own).
- Polished rendering (markdown/code). The UI is deliberately minimal.