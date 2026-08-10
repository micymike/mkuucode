import * as vscode from "vscode"
import * as path from "node:path"
import * as fs from "node:fs"
import { MkuuCodeBackend, type ModelInfo } from "./backend.js"
import { COMMANDS, commandify } from "./mkuucode.js"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

interface SavedSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  tokenCount?: number
}

let backend: MkuuCodeBackend | undefined
let chatHistory: ChatMessage[] = []
let currentSessionId: string = newSessionId()
let totalTokens = 0
const log = vscode.window.createOutputChannel("MkuuCode")

function newSessionId(): string {
  return `session-${Date.now()}`
}

function sessionTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")
  if (!first) return "New session"
  return first.content.slice(0, 60) + (first.content.length > 60 ? "…" : "")
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MkuuCodeChatProvider(
    context.extensionUri,
    context.globalStorageUri.fsPath,
    context.globalState,
  )

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("mkuucode.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("mkuucode.open", () => {
      vscode.commands.executeCommand("workbench.view.extension.mkuucode-sidebar")
    }),
  )

  // Right-click context menu commands
  context.subscriptions.push(
    vscode.commands.registerCommand("mkuucode.explainSelection", () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const selection = editor.document.getText(editor.selection)
      if (!selection.trim()) {
        vscode.window.showInformationMessage("Select some code first, then run MkuuCode: Explain Selection.")
        return
      }
      vscode.commands.executeCommand("workbench.view.extension.mkuucode-sidebar")
      provider.sendExternalPrompt(`/explain\n\`\`\`\n${selection}\n\`\`\``)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("mkuucode.fixSelection", () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const selection = editor.document.getText(editor.selection)
      if (!selection.trim()) {
        vscode.window.showInformationMessage("Select some code first, then run MkuuCode: Fix Selection.")
        return
      }
      vscode.commands.executeCommand("workbench.view.extension.mkuucode-sidebar")
      provider.sendExternalPrompt(`/fix\n\`\`\`\n${selection}\n\`\`\``)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("mkuucode.focusInput", () => {
      vscode.commands.executeCommand("workbench.view.extension.mkuucode-sidebar")
      provider.focusInput()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("mkuucode.exportChat", () => {
      provider.exportChat()
    }),
  )

  for (const id of Object.keys(COMMANDS)) {
    const name = COMMANDS[id]!.label.toLowerCase()
    context.subscriptions.push(
      vscode.commands.registerCommand(`mkuucode.${name}`, () => {
        vscode.commands.executeCommand("workbench.view.extension.mkuucode-sidebar")
      }),
    )
  }
}

export function deactivate(): void {
  backend?.dispose()
  backend = undefined
}

function directoryForWorkspace(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  return folder ? folder.uri.fsPath : process.cwd()
}

class MkuuCodeChatProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private stopped = false

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storageDir: string,
    private readonly globalState: vscode.Memento,
  ) {}

  sendExternalPrompt(text: string): void {
    this.view?.webview.postMessage({ type: "injectPrompt", text })
  }

  focusInput(): void {
    this.view?.webview.postMessage({ type: "focusInput" })
  }

  exportChat(): void {
    if (chatHistory.length === 0) {
      vscode.window.showInformationMessage("No chat to export.")
      return
    }
    const lines: string[] = [`# MkuuCode Chat — ${new Date().toLocaleString()}`, ""]
    for (const m of chatHistory) {
      lines.push(`## ${m.role === "user" ? "You" : "MkuuCode"}`, "", m.content, "")
    }
    const content = lines.join("\n")
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.storageDir
    const filePath = path.join(folder, `mkuucode-chat-${Date.now()}.md`)
    fs.writeFileSync(filePath, content, "utf8")
    vscode.workspace.openTextDocument(filePath).then((doc) => vscode.window.showTextDocument(doc))
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this.html(webviewView.webview)

    this.postTheme(webviewView.webview)
    const themeListener = vscode.window.onDidChangeActiveColorTheme(() => this.postTheme(webviewView.webview))
    webviewView.onDidDispose(() => themeListener.dispose())

    webviewView.webview.onDidReceiveMessage((data) => {
      log.appendLine(`webview message: ${JSON.stringify(data)}`)
      switch (data.type) {
        case "sendPrompt":
          void this.handlePrompt(data.text as string)
          break
        case "stop":
          this.handleStop(data as { text?: string; thinking?: string })
          break
        case "copy":
          void vscode.env.clipboard.writeText(String(data.text ?? ""))
          break
        case "newSession":
          this.handleNewSession()
          break
        case "loadHistory":
          this.sendHistoryList()
          break
        case "loadSession":
          this.handleLoadSession(data.sessionId as string)
          break
        case "deleteSession":
          this.handleDeleteSession(data.sessionId as string)
          break
        case "getModels":
          void this.handleGetModels()
          break
        case "setModel":
          void this.handleSetModel(data.modelId as string)
          break
        case "attachFile":
          void this.handleAttachFile()
          break
        case "showDiff":
          void this.handleShowDiff(data.sessionId as string)
          break
        case "openDiff":
          void this.handleOpenDiff(data.diff as string, data.filename as string)
          break
        case "editMessage":
          void this.handleEditMessage(data.index as number, data.text as string)
          break
        case "exportChat":
          this.exportChat()
          break
        case "ready":
          log.appendLine("webview reported ready")
          this.sendHistoryList()
          void this.handleGetModels()
          break
      }
    })

    for (const message of chatHistory) {
      webviewView.webview.postMessage({ type: "addMessage", role: message.role, content: message.content })
    }
    if (totalTokens > 0) {
      webviewView.webview.postMessage({ type: "tokenCount", total: totalTokens })
    }
  }

  private getSessions(): SavedSession[] {
    return this.globalState.get<SavedSession[]>("mkuucode.sessions", [])
  }

  private saveSessions(sessions: SavedSession[]): void {
    void this.globalState.update("mkuucode.sessions", sessions.slice(-50))
  }

  private saveCurrentSession(): void {
    if (chatHistory.length === 0) return
    const sessions = this.getSessions().filter((s) => s.id !== currentSessionId)
    sessions.push({
      id: currentSessionId,
      title: sessionTitle(chatHistory),
      messages: [...chatHistory],
      createdAt: Date.now(),
      tokenCount: totalTokens,
    })
    this.saveSessions(sessions)
    this.sendHistoryList()
  }

  private sendHistoryList(): void {
    const sessions = this.getSessions()
      .slice()
      .reverse()
      .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, active: s.id === currentSessionId, tokenCount: s.tokenCount }))
    this.view?.webview.postMessage({ type: "historyList", sessions })
  }

  private handleLoadSession(sessionId: string): void {
    const view = this.view
    if (!view) return
    this.saveCurrentSession()
    const session = this.getSessions().find((s) => s.id === sessionId)
    if (!session) return
    backend?.resetSession()
    chatHistory = [...session.messages]
    currentSessionId = session.id
    totalTokens = session.tokenCount ?? 0
    view.webview.postMessage({ type: "clear" })
    for (const message of chatHistory) {
      view.webview.postMessage({ type: "addMessage", role: message.role, content: message.content })
    }
    view.webview.postMessage({ type: "tokenCount", total: totalTokens })
    this.sendHistoryList()
  }

  private handleDeleteSession(sessionId: string): void {
    const sessions = this.getSessions().filter((s) => s.id !== sessionId)
    this.saveSessions(sessions)
    if (sessionId === currentSessionId) {
      this.handleNewSession()
    } else {
      this.sendHistoryList()
    }
  }

  private async handleGetModels(): Promise<void> {
    if (!backend) return
    try {
      const [models, current] = await Promise.all([backend.getModels(), backend.getCurrentModel()])
      this.view?.webview.postMessage({ type: "models", models, current })
    } catch {
      // ignore — backend may not be ready yet
    }
  }

  private async handleSetModel(modelId: string): Promise<void> {
    if (!backend) return
    try {
      await backend.setModel(modelId)
      this.view?.webview.postMessage({ type: "status", text: `Model set to ${modelId}` })
    } catch (err) {
      log.appendLine(`setModel error: ${err}`)
    }
  }

  private async handleAttachFile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Attach",
      filters: { "All files": ["*"] },
    })
    if (!uris || uris.length === 0) return
    const filePath = uris[0]!.fsPath
    const relPath = vscode.workspace.asRelativePath(filePath)
    this.view?.webview.postMessage({ type: "attachedFile", path: relPath, fullPath: filePath })
  }

  private async handleShowDiff(sessionId: string): Promise<void> {
    if (!backend) return
    const diff = await backend.getSessionDiff(sessionId || currentSessionId)
    this.view?.webview.postMessage({ type: "diffResult", diff, sessionId: sessionId || currentSessionId })
  }

  private async handleOpenDiff(diff: string, filename: string): Promise<void> {
    if (!diff.trim()) {
      vscode.window.showInformationMessage("No changes in this session.")
      return
    }
    // Write diff to a temp file and open it
    const tmpDir = this.storageDir
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, filename || "session.diff")
    fs.writeFileSync(tmpFile, diff, "utf8")
    const uri = vscode.Uri.file(tmpFile)
    await vscode.workspace.openTextDocument(uri).then((doc) => vscode.window.showTextDocument(doc))
  }

  private async handleEditMessage(index: number, newText: string): Promise<void> {
    const view = this.view
    if (!view || index < 0 || index >= chatHistory.length) return
    // Slice history up to (not including) the edited message so handlePrompt
    // can push the new user message without duplication.
    chatHistory = chatHistory.slice(0, index)
    backend?.resetSession()
    // Tell the webview to remove everything from this index onward; handlePrompt
    // will re-add the user bubble itself via "addMessage".
    view.webview.postMessage({ type: "truncateMessages", fromIndex: index })
    await this.handlePrompt(newText)
  }

  private async handlePrompt(raw: string): Promise<void> {
    const view = this.view
    if (!view) return

    this.stopped = false
    const rendered = commandify(raw)

    chatHistory.push({ role: "user", content: raw })
    view.webview.postMessage({ type: "addMessage", role: "user", content: raw })
    view.webview.postMessage({ type: "setLoading", value: true })

    try {
      let streamed = false
      if (!backend) {
        backend = new MkuuCodeBackend(
          directoryForWorkspace(),
          this.storageDir,
          (status) => view.webview.postMessage({ type: "status", text: status }),
          (event) => {
            if (event.type === "thinking" || event.type === "text") streamed = true
            view.webview.postMessage({ type: "stream", data: event })
          },
        )
        // Load models once backend is ready
        void backend.getModels().then((models) => {
          backend!.getCurrentModel().then((current) => {
            view.webview.postMessage({ type: "models", models, current })
          })
        })
      }

      const { reply, activity, usage } = await backend.send(rendered)

      if (usage) {
        totalTokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        view.webview.postMessage({ type: "tokenCount", total: totalTokens, last: usage })
      }

      if (this.stopped) return
      if (streamed) {
        view.webview.postMessage({ type: "stream", data: { type: "done" } })
      } else {
        for (const line of activity) {
          view.webview.postMessage({ type: "addActivity", content: line })
        }
        view.webview.postMessage({ type: "addMessage", role: "assistant", content: reply })
      }
      chatHistory.push({ role: "assistant", content: reply })
      this.saveCurrentSession()
    } catch (error) {
      if (this.stopped) return
      const reason = error instanceof Error ? error.message : String(error)
      const isConnErr =
        reason.toLowerCase().includes("fetch failed") ||
        reason.toLowerCase().includes("econnrefused") ||
        reason.toLowerCase().includes("connection") ||
        reason.toLowerCase().includes("timed out")

      if (isConnErr) {
        backend?.dispose()
        backend = undefined
        view.webview.postMessage({
          type: "addMessage",
          role: "assistant",
          content: `⚠️ Connection lost. Please try again — the server will restart automatically.`,
        })
      } else {
        view.webview.postMessage({ type: "addMessage", role: "assistant", content: `Error: ${reason}` })
      }
    } finally {
      view.webview.postMessage({ type: "setLoading", value: false })
    }
  }

  private handleStop(flushed: { text?: string; thinking?: string }): void {
    const view = this.view
    if (!view) return
    this.stopped = true
    backend?.stop()
    const text = flushed.text?.trim()
    chatHistory.push({ role: "assistant", content: text || "*(generation stopped)*" })
    this.saveCurrentSession()
    view.webview.postMessage({ type: "stream", data: { type: "done" } })
    view.webview.postMessage({ type: "setLoading", value: false })
  }

  private handleNewSession(): void {
    const view = this.view
    if (!view) return
    this.saveCurrentSession()
    backend?.resetSession()
    chatHistory = []
    currentSessionId = newSessionId()
    totalTokens = 0
    view.webview.postMessage({ type: "clear" })
    view.webview.postMessage({ type: "tokenCount", total: 0 })
    this.sendHistoryList()
  }

  private postTheme(webview: vscode.Webview): void {
    const kind = vscode.window.activeColorTheme.kind
    webview.postMessage({ type: "theme", kind: kind === vscode.ColorThemeKind.Dark ? "dark" : "light" })
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "webview.js"))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "main.css"))
    const csp = `
      default-src 'none';
      script-src ${webview.cspSource};
      style-src ${webview.cspSource} 'unsafe-inline';
      img-src ${webview.cspSource} https: data:;
    `
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<title>MkuuCode</title>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`
  }
}
