// MkuuCode webview client
const vscode = acquireVsCodeApi()

const chatDiv = document.getElementById("chat")!
const promptArea = document.getElementById("prompt") as HTMLTextAreaElement
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement
const statusDiv = document.getElementById("status")!

vscode.postMessage({ type: "ready" })

function postPrompt(text: string) {
  if (!text) return
  vscode.postMessage({ type: "sendPrompt", text })
  promptArea.value = ""
}

sendBtn.addEventListener("click", () => postPrompt(promptArea.value.trim()))
promptArea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    sendBtn.click()
  }
})

function appendMessage(role, content) {
  const el = document.createElement("div")
  el.className = `message ${role}`
  const body = document.createElement("div")
  body.className = "message-content"
  body.textContent = content
  el.appendChild(body)
  chatDiv.appendChild(el)
  chatDiv.scrollTop = chatDiv.scrollHeight
}

function appendActivity(content) {
  const el = document.createElement("div")
  el.className = "activity"
  el.textContent = content
  chatDiv.appendChild(el)
  chatDiv.scrollTop = chatDiv.scrollHeight
}

window.addEventListener("message", (event) => {
  const message = event.data
  switch (message.type) {
    case "addMessage": {
      appendMessage(message.role, message.content)
      break
    }
    case "addActivity": {
      appendActivity(message.content)
      break
    }
    case "setLoading": {
      statusDiv.textContent = message.value ? "Running agent…" : "Idle"
      sendBtn.disabled = message.value
      promptArea.disabled = message.value
      break
    }
  }
})

window.addEventListener("error", (event) => {
  statusDiv.textContent = "Error: " + (event.message || "unknown")
})