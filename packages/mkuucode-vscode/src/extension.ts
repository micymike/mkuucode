import * as vscode from "vscode"
import { MkuuCodeBackend } from "./backend.js"
import { COMMANDS, commandify } from "./mkuucode.js"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

let backend: MkuuCodeBackend | undefined
let chatHistory: ChatMessage[] = []
const log = vscode.window.createOutputChannel("MkuuCode")

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
      log.appendLine(`webview message: ${JSON.stringify(data)}`)
      switch (data.type) {
        case "sendPrompt": {
          void this.handlePrompt(data.text as string)
          break
        }
        case "ready": {
          log.appendLine("webview reported ready")
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
      let streamed = false
      if (!backend) {
        backend = new MkuuCodeBackend(
          directoryForWorkspace(),
          this.storageDir,
          (status) => {
            view.webview.postMessage({ type: "addActivity", content: status })
          },
          (event) => {
            if (event.type === "thinking" || event.type === "text") streamed = true
            view.webview.postMessage({ type: "stream", data: event })
          },
        )
      }
      const { reply, activity } = await backend.send(rendered)

      if (streamed) {
        // The streamed bubble already shows thinking, text, and tool activity.
        view.webview.postMessage({ type: "stream", data: { type: "done" } })
      } else {
        for (const line of activity) {
          view.webview.postMessage({ type: "addActivity", content: line })
        }
        view.webview.postMessage({ type: "addMessage", role: "assistant", content: reply })
      }
      chatHistory.push({ role: "assistant", content: reply })
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
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "webview.js"))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "main.css"))
    log.appendLine(`scriptUri=${scriptUri.toString()}`)
    log.appendLine(`cspSource=${webview.cspSource}`)
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