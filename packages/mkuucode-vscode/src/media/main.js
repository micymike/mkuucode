// MkuuCode webview client
const vscode = acquireVsCodeApi()

const chatDiv = document.getElementById("chat")
const promptArea = document.getElementById("prompt")
const sendBtn = document.getElementById("send-btn")
const statusDiv = document.getElementById("status")

vscode.postMessage({ type: "ready" })

function postPrompt(text) {
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

let streamBubble = null
let streamThinking = null
let streamBody = null

function ensureStreamBubble() {
  if (streamBubble) return
  streamBubble = document.createElement("div")
  streamBubble.className = "message assistant"
  streamThinking = document.createElement("div")
  streamThinking.className = "thinking"
  streamThinking.hidden = true
  streamBody = document.createElement("div")
  streamBody.className = "message-content"
  streamBubble.appendChild(streamThinking)
  streamBubble.appendChild(streamBody)
  chatDiv.appendChild(streamBubble)
  scrollToBottom()
}

function scrollToBottom() {
  chatDiv.scrollTop = chatDiv.scrollHeight
}

function onStreamEvent(message) {
  if (message.type === "thinking") {
    ensureStreamBubble()
    streamThinking.hidden = false
    streamThinking.textContent = message.content
  } else if (message.type === "text") {
    ensureStreamBubble()
    streamBody.textContent = message.content
  } else if (message.type === "tool") {
    appendActivity(message.content)
  } else if (message.type === "done") {
    streamBubble = null
    streamThinking = null
    streamBody = null
  }
  scrollToBottom()
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
    case "stream": {
      onStreamEvent(message.data)
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