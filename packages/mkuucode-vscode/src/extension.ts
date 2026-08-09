import * as vscode from "vscode"
import { MkuuCodeBackend } from "./backend.js"
import { COMMANDS, commandify } from "./mkuucode.js"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

let backend: MkuuCodeBackend | undefined
let chatHistory: ChatMessage[] = []

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MkuuCodeChatProvider(context.extensionUri, context.globalStorageUri.fsPath)

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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storageDir: string,
  ) {}

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

    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case "sendPrompt": {
          void this.handlePrompt(data.text as string)
          break
        }
      }
    })

    for (const message of chatHistory) {
      webviewView.webview.postMessage({ type: "addMessage", role: message.role, content: message.content })
    }
  }

  private async handlePrompt(raw: string): Promise<void> {
    const view = this.view
    if (!view) return

    const rendered = commandify(raw)

    chatHistory.push({ role: "user", content: raw })
    view.webview.postMessage({ type: "addMessage", role: "user", content: raw })
    view.webview.postMessage({ type: "setLoading", value: true })

    try {
      if (!backend) {
        backend = new MkuuCodeBackend(directoryForWorkspace(), this.storageDir, (status) => {
          view.webview.postMessage({ type: "addActivity", content: status })
        })
      }
      const { reply, activity } = await backend.send(rendered)

      for (const line of activity) {
        view.webview.postMessage({ type: "addActivity", content: line })
      }
      chatHistory.push({ role: "assistant", content: reply })
      view.webview.postMessage({ type: "addMessage", role: "assistant", content: reply })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      view.webview.postMessage({
        type: "addMessage",
        role: "assistant",
        content: `Connection error: ${reason}`,
      })
    } finally {
      view.webview.postMessage({ type: "setLoading", value: false })
    }
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "main.js"))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "main.css"))
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<title>MkuuCode</title>
</head>
<body>
  <div id="status" class="status">Idle</div>
  <div id="chat" class="chat"></div>
  <div class="input-container">
    <textarea id="prompt" class="prompt" placeholder="Ask MkuuCode…  ( /plan /review /test /explain /fix )"></textarea>
    <button id="send-btn" class="send">Send</button>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`
  }
}