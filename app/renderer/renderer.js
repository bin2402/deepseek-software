const MODELS = {
  "deepseek-v4-flash": "Flash",
  "deepseek-v4-pro": "Pro",
};

const state = {
  settings: {
    apiKey: "",
    apiBase: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  conversations: [],
  currentId: null,
  streaming: false,
  activeRequestId: null,
  activeConversationId: null,
};

const dom = {
  sidebar: document.getElementById("sidebar"),
  conversationList: document.getElementById("conversationList"),
  messagesContainer: document.getElementById("messagesContainer"),
  chatArea: document.getElementById("chatArea"),
  newChatBtn: document.getElementById("newChatBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  apiBaseInput: document.getElementById("apiBaseInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),
  settingsStatus: document.getElementById("settingsStatus"),
  dataPathText: document.getElementById("dataPathText"),
  modelSelect: document.getElementById("modelSelect"),
  modelBadge: document.getElementById("modelBadge"),
  clearBtn: document.getElementById("clearBtn"),
  userInput: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
  sendIcon: document.getElementById("sendIcon"),
  sidebarToggle: document.getElementById("sidebarToggle"),
};

function now() {
  return new Date().toISOString();
}

function normalizeModel(model) {
  return MODELS[model] ? model : "deepseek-v4-flash";
}

function createConversation() {
  return {
    id: String(Date.now()),
    title: "新对话",
    model: state.settings.model,
    messages: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

function currentConversation() {
  return state.conversations.find((conversation) => conversation.id === state.currentId);
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function renderMarkdown(content) {
  if (window.marked) {
    return marked.parse(content || "");
  }
  return escapeHtml(content || "").replace(/\n/g, "<br>");
}

function autoResize() {
  dom.userInput.style.height = "auto";
  dom.userInput.style.height = `${Math.min(dom.userInput.scrollHeight, 180)}px`;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    dom.chatArea.scrollTop = dom.chatArea.scrollHeight;
  });
}

async function persistConversations() {
  await window.deepseekApp.saveConversations({
    conversations: state.conversations,
  });
}

function ensureCurrentConversation() {
  if (state.currentId && currentConversation()) return;

  if (state.conversations.length === 0) {
    const conversation = createConversation();
    state.conversations.unshift(conversation);
    state.currentId = conversation.id;
    return;
  }

  state.currentId = state.conversations[0].id;
}

function updateConversationTitle(conversation) {
  const firstUserMessage = conversation.messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    conversation.title = "新对话";
    return;
  }

  conversation.title = firstUserMessage.content.slice(0, 28)
    + (firstUserMessage.content.length > 28 ? "..." : "");
}

function renderConversationList() {
  if (state.conversations.length === 0) {
    dom.conversationList.innerHTML = "<div class=\"empty\">暂无对话</div>";
    return;
  }

  dom.conversationList.innerHTML = state.conversations.map((conversation) => {
    const activeClass = conversation.id === state.currentId ? " active" : "";
    const date = new Date(conversation.updatedAt || conversation.createdAt).toLocaleDateString();
    return `
      <div class="conversation-item${activeClass}" data-id="${conversation.id}">
        <div class="conversation-title">
          <strong>${escapeHtml(conversation.title || "新对话")}</strong>
          <span>${date}</span>
        </div>
        <button class="delete-btn" type="button" data-delete="${conversation.id}" title="删除">×</button>
      </div>
    `;
  }).join("");
}

function renderMessages() {
  const conversation = currentConversation();

  if (!conversation || conversation.messages.length === 0) {
    dom.messagesContainer.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">🧠</div>
        <h1>DeepSeek 本地客户端</h1>
        <p>今天我能帮你做什么？</p>
        <div class="suggestions">
          <button class="suggestion" type="button" data-suggestion="用简单的话解释量子计算">解释量子计算</button>
          <button class="suggestion" type="button" data-suggestion="写一个 Python 排序函数">写 Python 代码</button>
          <button class="suggestion" type="button" data-suggestion="人生的意义是什么">人生的意义</button>
          <button class="suggestion" type="button" data-suggestion="帮我规划周末旅行">规划周末旅行</button>
        </div>
      </div>
    `;
    return;
  }

  dom.messagesContainer.innerHTML = conversation.messages
    .map((message) => renderMessage(message))
    .join("");

  dom.messagesContainer.querySelectorAll("pre code").forEach((block) => {
    if (window.hljs) {
      hljs.highlightElement(block);
    }
  });

  scrollToBottom();
}

function renderMessage(message) {
  const role = message.role === "user" ? "user" : "assistant";
  const avatar = role === "user" ? "你" : "AI";
  const streamingClass = message.streaming ? " streaming" : "";
  const reasoning = message.reasoning
    ? `<div class="thinking">
        <div class="thinking-header">推理过程</div>
        <div class="thinking-body">${renderMarkdown(message.reasoning)}</div>
      </div>`
    : "";

  return `
    <div class="message ${role}">
      <div class="avatar">${avatar}</div>
      <div class="bubble${streamingClass}">${reasoning}${renderMarkdown(message.content)}</div>
    </div>
  `;
}

function updateControls() {
  const hasApiKey = Boolean(state.settings.apiKey);
  dom.userInput.disabled = !hasApiKey;
  dom.sendBtn.disabled = !hasApiKey;
  dom.userInput.placeholder = hasApiKey ? "输入你的问题..." : "请先设置 API 密钥...";
  dom.modelSelect.value = normalizeModel(state.settings.model);
  dom.modelBadge.textContent = MODELS[normalizeModel(state.settings.model)];
}

function setSettingsStatus(message, isError = false) {
  dom.settingsStatus.textContent = message;
  dom.settingsStatus.classList.toggle("error", isError);
}

function openSettings() {
  dom.apiKeyInput.value = state.settings.apiKey || "";
  dom.apiBaseInput.value = state.settings.apiBase || "https://api.deepseek.com";
  setSettingsStatus("");
  dom.settingsModal.classList.add("open");
  dom.apiKeyInput.focus();
}

function closeSettings() {
  dom.settingsModal.classList.remove("open");
}

async function saveSettings() {
  const apiKey = dom.apiKeyInput.value.trim();
  if (!apiKey) {
    setSettingsStatus("请先填写 API 密钥。", true);
    return;
  }

  state.settings = await window.deepseekApp.saveSettings({
    apiKey,
    apiBase: dom.apiBaseInput.value.trim() || "https://api.deepseek.com",
    model: normalizeModel(dom.modelSelect.value),
  });

  setSettingsStatus("保存成功。");
  updateControls();
  setTimeout(closeSettings, 500);
}

async function newConversation() {
  const current = currentConversation();
  if (current && current.messages.length === 0) {
    return;
  }

  const conversation = createConversation();
  state.conversations.unshift(conversation);
  state.currentId = conversation.id;
  await persistConversations();
  renderConversationList();
  renderMessages();
  dom.userInput.focus();
}

async function deleteConversation(id) {
  state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
  if (state.currentId === id) {
    state.currentId = state.conversations[0]?.id || null;
  }

  ensureCurrentConversation();
  await persistConversations();
  renderConversationList();
  renderMessages();
}

async function clearConversation() {
  const conversation = currentConversation();
  if (!conversation) return;

  if (state.streaming) {
    await stopStreaming();
  }

  conversation.messages = [];
  conversation.updatedAt = now();
  updateConversationTitle(conversation);
  await persistConversations();
  renderConversationList();
  renderMessages();
}

async function sendMessage(text) {
  const content = (text || dom.userInput.value).trim();
  if (!content || state.streaming || !state.settings.apiKey) return;

  const conversation = currentConversation();
  if (!conversation) return;

  dom.userInput.value = "";
  autoResize();

  conversation.model = normalizeModel(state.settings.model);
  conversation.messages.push({ role: "user", content });
  const assistantMessage = {
    role: "assistant",
    content: "",
    reasoning: "",
    streaming: true,
  };
  conversation.messages.push(assistantMessage);
  conversation.updatedAt = now();
  updateConversationTitle(conversation);

  state.streaming = true;
  state.activeRequestId = `${conversation.id}-${Date.now()}`;
  state.activeConversationId = conversation.id;
  dom.sendIcon.textContent = "停止";
  dom.sendBtn.title = "停止";

  await persistConversations();
  renderConversationList();
  renderMessages();

  const apiMessages = conversation.messages
    .filter((message) => message.content && !message.streaming)
    .map((message) => ({ role: message.role, content: message.content }));

  window.deepseekApp.streamChat({
    requestId: state.activeRequestId,
    model: conversation.model,
    messages: apiMessages,
  });
}

async function stopStreaming() {
  if (!state.activeRequestId) return;
  await window.deepseekApp.abortChat(state.activeRequestId);
}

async function finishStreaming({ aborted = false, error = "" } = {}) {
  const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
  const assistantMessage = conversation?.messages.findLast((message) => message.streaming);

  if (assistantMessage) {
    assistantMessage.streaming = false;
    if (aborted) assistantMessage.content += " [已停止]";
    if (error) assistantMessage.content = `**错误**: ${error}`;
  }

  state.streaming = false;
  state.activeRequestId = null;
  state.activeConversationId = null;
  dom.sendIcon.textContent = "发送";
  dom.sendBtn.title = "发送";

  if (conversation) {
    conversation.updatedAt = now();
  }

  await persistConversations();
  renderMessages();
  renderConversationList();
}

function appendStreamChunk(payload) {
  if (payload.requestId !== state.activeRequestId) return;

  const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
  const assistantMessage = conversation?.messages.findLast((message) => message.streaming);
  if (!assistantMessage) return;

  assistantMessage.content += payload.content || "";
  assistantMessage.reasoning += payload.reasoning || "";
  renderMessages();
}

async function init() {
  state.settings = await window.deepseekApp.getSettings();
  state.settings.model = normalizeModel(state.settings.model);

  const dataPath = await window.deepseekApp.getDataDir();
  dom.dataPathText.textContent = `配置和会话会保存在：${dataPath}`;

  const data = await window.deepseekApp.getConversations();
  state.conversations = Array.isArray(data.conversations) ? data.conversations : [];

  ensureCurrentConversation();
  await persistConversations();

  renderConversationList();
  renderMessages();
  updateControls();

  if (!state.settings.apiKey) {
    openSettings();
  }
}

dom.newChatBtn.addEventListener("click", newConversation);
dom.settingsBtn.addEventListener("click", openSettings);
dom.cancelSettingsBtn.addEventListener("click", closeSettings);
dom.saveSettingsBtn.addEventListener("click", saveSettings);
dom.clearBtn.addEventListener("click", clearConversation);
dom.sidebarToggle.addEventListener("click", () => dom.sidebar.classList.toggle("open"));

dom.settingsModal.addEventListener("click", (event) => {
  if (event.target === dom.settingsModal) closeSettings();
});

dom.modelSelect.addEventListener("change", async () => {
  state.settings = await window.deepseekApp.saveSettings({
    ...state.settings,
    model: normalizeModel(dom.modelSelect.value),
  });
  updateControls();
});

dom.userInput.addEventListener("input", autoResize);
dom.userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey) {
    event.preventDefault();
    sendMessage();
  }
});

dom.sendBtn.addEventListener("click", () => {
  if (state.streaming) {
    stopStreaming();
    return;
  }
  sendMessage();
});

dom.conversationList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    deleteConversation(deleteButton.dataset.delete);
    return;
  }

  const item = event.target.closest("[data-id]");
  if (!item) return;

  state.currentId = item.dataset.id;
  renderConversationList();
  renderMessages();
  dom.sidebar.classList.remove("open");
});

dom.messagesContainer.addEventListener("click", (event) => {
  const suggestion = event.target.closest("[data-suggestion]");
  if (suggestion) {
    sendMessage(suggestion.dataset.suggestion);
    return;
  }

  const thinkingHeader = event.target.closest(".thinking-header");
  if (thinkingHeader) {
    thinkingHeader.parentElement.classList.toggle("open");
  }
});

window.deepseekApp.onChatChunk(appendStreamChunk);
window.deepseekApp.onChatDone(() => finishStreaming());
window.deepseekApp.onChatAborted(() => finishStreaming({ aborted: true }));
window.deepseekApp.onChatError((payload) => finishStreaming({ error: payload.message }));

init();
