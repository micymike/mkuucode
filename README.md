<p align="center">
  <img src="logo.png" alt="Mkuu Code" width="480">
</p>
<h1 align="center">Mkuu Code</h1>
<p align="center">A coding assistant for VS Code, built on the OpenCode engine.</p>

---

Mkuu Code is a VS Code extension that brings an AI coding assistant into your
editor — like a GitHub Copilot-style side panel — while delegating all agent
reasoning, tools, and code generation to the **OpenCode** agent engine running
under the hood.

It is a fork of [OpenCode](https://github.com/anomalyco/opencode). It is **not**
built by the OpenCode team and is not affiliated with them in any way.

---

# Using the Mkuu Code VS Code extension

## Installation

### Prerequisites
- **VS Code** 1.80.0 or newer

No other installs needed. Mkuu Code downloads and caches its own copy of the
OpenCode engine the first time you use it (no `opencode` on your PATH required).

### Install from a `.vsix`
1. Build the extension:
   ```bash
   cd packages/mkuucode-vscode
   bun install        # links the workspace SDK
   bun run build      # bundles to dist/extension.js
   ```
2. Open VS Code → Extensions view (`Ctrl+Shift+X`) → `...` menu → **Install from VSIX...**.
3. Select `mkuucode-vscode-0.1.0.vsix`.

### Run in development
Open this repo in VS Code, press `F5`, and click the **Mkuu code** icon in the
Activity Bar to open the chat sidebar.

## Using the chat

1. Click the **Mkuu code** icon in the Activity Bar (or run the **`MkuuCode: Open`** command).
2. Type a request in the input box and press **Send**.
3. The assistant replies in the panel. Tool calls and sub-steps appear as activity lines while it works.

### Slash commands
Type any of these as the start of your message to run a focused workflow:

| Command | Effect |
| --- | --- |
| `/plan` | Analyze the ask and produce an implementation plan (no edits) |
| `/review` | Review the current changes |
| `/test` | Run the relevant tests and fix failures |
| `/explain` | Explain code (select code first, then send `/explain`) |
| `/fix` | Investigate and fix the current problem |

## Configuration

Mkuu Code registers a dedicated `mkuucode` agent with a careful, senior-engineer
system prompt. You can see the config and prompt in
`packages/mkuucode-vscode/src/mkuucode.ts`.

> Security note: the agent currently sets `edit` and `bash` permissions to `allow`
> so it can run without an interactive prompt. Review this before sharing it
> broadly.

## Commands

| Command | Action |
| --- | --- |
| MkuuCode: Open | open the Mkuu Code sidebar |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## License

[MIT](./LICENSE).