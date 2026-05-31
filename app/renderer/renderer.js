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
  searching: false,
  cancelRequested: false,
  activeRequestId: null,
  activeConversationId: null,
  pendingAttachments: [],
  searchEnabled: false,
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
  attachBtn: document.getElementById("attachBtn"),
  searchToggleBtn: document.getElementById("searchToggleBtn"),
  attachmentTray: document.getElementById("attachmentTray"),
  toolbarStatus: document.getElementById("toolbarStatus"),
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
  element.textContent = value == null ? "" : String(value);
  return element.innerHTML;
}

function renderMarkdown(content) {
  if (window.marked) {
    return marked.parse(content || "");
  }
  return escapeHtml(content || "").replace(/\n/g, "<br>");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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

function setToolbarStatus(message, isError = false) {
  dom.toolbarStatus.textContent = message || "";
  dom.toolbarStatus.classList.toggle("error", isError);
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

  const fallback = firstUserMessage.attachments?.[0]?.name || "文件对话";
  const titleText = firstUserMessage.content || fallback;
  conversation.title = titleText.slice(0, 28) + (titleText.length > 28 ? "..." : "");
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

function renderAttachmentSummary(attachments = []) {
  if (!attachments.length) return "";

  return `
    <div class="attachment-list">
      ${attachments.map((attachment) => `
        <div class="attachment-card">
          <span class="attachment-icon">📄</span>
          <div>
            <strong>${escapeHtml(attachment.name)}</strong>
            <span>${escapeHtml(attachment.ext || "文件")} · ${formatBytes(attachment.size)}${attachment.truncated ? " · 已截断" : ""}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSources(sources = []) {
  if (!sources.length) return "";

  return `
    <div class="sources">
      <div class="sources-title">联网来源</div>
      ${sources.map((source, index) => `
        <a class="source-item" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
          <span>${index + 1}</span>
          <div>
            <strong>${escapeHtml(source.title)}</strong>
            <small>${escapeHtml(source.snippet || source.url)}</small>
          </div>
        </a>
      `).join("")}
    </div>
  `;
}

function renderMessages() {
  const conversation = currentConversation();

  if (!conversation || conversation.messages.length === 0) {
    dom.messagesContainer.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">🌸</div>
        <h1>DeepSeek 酱</h1>
        <p>可以聊天、识别文件，也可以开启联网搜索整合网页内容哦~</p>
        <div class="suggestions">
          <button class="suggestion" type="button" data-suggestion="帮我总结上传文件的重点">📝 总结文件重点</button>
          <button class="suggestion" type="button" data-suggestion="联网搜索 DeepSeek V4 的最新信息并总结">🌐 联网搜索最新信息</button>
          <button class="suggestion" type="button" data-suggestion="写一个 Python 排序函数">💻 写 Python 代码</button>
          <button class="suggestion" type="button" data-suggestion="帮我规划周末旅行">✈️ 规划周末旅行</button>
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
  const avatar = role === "user" ? "🧑" : "🌸";
  const streamingClass = message.streaming ? " streaming" : "";
  const reasoning = message.reasoning
    ? `<div class="thinking">
        <div class="thinking-header">推理过程</div>
        <div class="thinking-body">${renderMarkdown(message.reasoning)}</div>
      </div>`
    : "";
  const searchError = message.searchError
    ? `<div class="inline-warning">联网搜索失败：${escapeHtml(message.searchError)}，已继续普通回答。</div>`
    : "";

  return `
    <div class="message ${role}">
      <div class="avatar">${avatar}</div>
      <div class="bubble${streamingClass}">
        ${renderAttachmentSummary(message.attachments)}
        ${reasoning}
        ${message.content ? renderMarkdown(message.content) : ""}
        ${searchError}
        ${renderSources(message.sources)}
      </div>
    </div>
  `;
}

function renderPendingAttachments() {
  if (!state.pendingAttachments.length) {
    dom.attachmentTray.innerHTML = "";
    return;
  }

  dom.attachmentTray.innerHTML = state.pendingAttachments.map((attachment) => `
    <div class="attachment-chip">
      <span>📄</span>
      <strong>${escapeHtml(attachment.name)}</strong>
      <small>${formatBytes(attachment.size)}${attachment.truncated ? " · 已截断" : ""}</small>
      <button type="button" data-remove-attachment="${attachment.id}" title="移除">×</button>
    </div>
  `).join("");
}

function updateControls() {
  const hasApiKey = Boolean(state.settings.apiKey);
  dom.userInput.disabled = !hasApiKey;
  dom.sendBtn.disabled = !hasApiKey || (state.streaming && !state.activeRequestId);
  dom.attachBtn.disabled = !hasApiKey || state.streaming;
  dom.searchToggleBtn.disabled = !hasApiKey || state.streaming;
  dom.userInput.placeholder = hasApiKey ? "输入你的问题，可上传文件或开启联网搜索~" : "请先设置 API 密钥...";
  dom.modelSelect.value = normalizeModel(state.settings.model);
  dom.modelBadge.textContent = MODELS[normalizeModel(state.settings.model)];
  dom.searchToggleBtn.classList.toggle("active", state.searchEnabled);
  dom.searchToggleBtn.setAttribute("aria-pressed", String(state.searchEnabled));
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
  state.pendingAttachments = [];
  renderPendingAttachments();
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
  state.pendingAttachments = [];
  renderPendingAttachments();
  await persistConversations();
  renderConversationList();
  renderMessages();
}

async function selectFiles() {
  if (state.streaming) return;

  setToolbarStatus("正在识别文件...");
  dom.attachBtn.disabled = true;
  try {
    const result = await window.deepseekApp.selectAndExtractFiles();
    if (!result || result.canceled) {
      setToolbarStatus("");
      return;
    }

    const existingIds = new Set(state.pendingAttachments.map((file) => file.id));
    const nextFiles = [...state.pendingAttachments];
    for (const file of result.files || []) {
      if (!existingIds.has(file.id) && nextFiles.length < 5) {
        nextFiles.push(file);
      }
    }
    state.pendingAttachments = nextFiles.slice(0, 5);
    renderPendingAttachments();

    const message = [
      result.files?.length ? `已识别 ${result.files.length} 个文件。` : "",
      ...(result.errors || []),
    ].filter(Boolean).join(" ");
    setToolbarStatus(message, Boolean(result.errors?.length && !result.files?.length));
  } catch (error) {
    setToolbarStatus(error.message || "文件识别失败。", true);
  } finally {
    updateControls();
  }
}

function removePendingAttachment(id) {
  state.pendingAttachments = state.pendingAttachments.filter((attachment) => attachment.id !== id);
  renderPendingAttachments();
  setToolbarStatus("");
}

async function runSearch(content, attachments) {
  const fallback = attachments.length
    ? `分析文件：${attachments.map((attachment) => attachment.name).join("、")}`
    : "用户问题";
  const query = content || fallback;
  setToolbarStatus("正在联网搜索...");
  state.searching = true;
  updateControls();

  try {
    const response = await window.deepseekApp.searchWeb(query);
    if (!response?.ok) {
      return { results: [], error: response?.error || "联网搜索失败。" };
    }
    setToolbarStatus(response.results?.length ? `已找到 ${response.results.length} 条网页来源。` : "未找到相关网页，已继续普通回答。");
    return { results: response.results || [], error: "" };
  } catch (error) {
    return { results: [], error: error.message || "联网搜索失败。" };
  } finally {
    state.searching = false;
    updateControls();
  }
}

async function sendMessage(text) {
  const content = (text || dom.userInput.value).trim();
  const attachments = state.pendingAttachments.map((attachment) => ({ ...attachment }));
  if ((!content && attachments.length === 0) || state.streaming || !state.settings.apiKey) return;

  const conversation = currentConversation();
  if (!conversation) return;

  dom.userInput.value = "";
  autoResize();
  state.pendingAttachments = [];
  renderPendingAttachments();

  conversation.model = normalizeModel(state.settings.model);
  const userMessage = {
    role: "user",
    content: content || "请分析我上传的文件。",
    attachments,
  };
  conversation.messages.push(userMessage);
  const assistantMessage = {
    role: "assistant",
    content: "",
    reasoning: "",
    streaming: true,
    sources: [],
    searchError: "",
  };
  conversation.messages.push(assistantMessage);
  conversation.updatedAt = now();
  updateConversationTitle(conversation);

  state.streaming = true;
  state.cancelRequested = false;
  state.activeRequestId = `${conversation.id}-${Date.now()}`;
  state.activeConversationId = conversation.id;
  dom.sendIcon.textContent = "停止";
  dom.sendBtn.title = "停止";
  updateControls();

  await persistConversations();
  renderConversationList();
  renderMessages();

  let searchResults = [];
  if (state.searchEnabled) {
    const search = await runSearch(userMessage.content, attachments);
    searchResults = search.results;
    assistantMessage.sources = searchResults.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
    }));
    assistantMessage.searchError = search.error;
    await persistConversations();
    renderMessages();
  }

  if (state.cancelRequested) {
    await finishStreaming({ aborted: true });
    return;
  }

  const apiMessages = conversation.messages
    .filter((message) => (message.content || message.attachments?.length) && !message.streaming)
    .map((message) => ({
      role: message.role,
      content: message.content || "",
      attachments: message.attachments || [],
    }));

  window.deepseekApp.streamChat({
    requestId: state.activeRequestId,
    model: conversation.model,
    messages: apiMessages,
    attachments,
    searchResults,
  }).catch((error) => finishStreaming({ error: error.message || "请求失败" }));
}

async function stopStreaming() {
  if (state.searching && !state.activeRequestId) {
    state.cancelRequested = true;
    await finishStreaming({ aborted: true });
    return;
  }

  if (state.searching) {
    state.cancelRequested = true;
  }

  if (!state.activeRequestId) return;
  await window.deepseekApp.abortChat(state.activeRequestId);
}

async function finishStreaming({ aborted = false, error = "" } = {}) {
  const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
  const assistantMessage = conversation?.messages.findLast((message) => message.streaming);

  if (assistantMessage) {
    assistantMessage.streaming = false;
    if (aborted) assistantMessage.content += " [已停止]";
    if (error) assistantMessage.content = `**错误**：${error}`;
  }

  state.streaming = false;
  state.searching = false;
  state.cancelRequested = false;
  state.activeRequestId = null;
  state.activeConversationId = null;
  dom.sendIcon.textContent = "发送";
  dom.sendBtn.title = "发送";

  if (conversation) {
    conversation.updatedAt = now();
  }

  setToolbarStatus("");
  updateControls();
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

  if (state.currentId !== state.activeConversationId || currentConversation()?.id !== conversation.id) {
    return;
  }

  const streamingBubbles = dom.messagesContainer.querySelectorAll(".message.assistant .bubble.streaming");
  const bubble = streamingBubbles[streamingBubbles.length - 1];
  if (!bubble) {
    renderMessages();
    return;
  }

  const reasoningHtml = assistantMessage.reasoning
    ? `<div class="thinking">
        <div class="thinking-header">推理过程</div>
        <div class="thinking-body">${renderMarkdown(assistantMessage.reasoning)}</div>
      </div>`
    : "";
  bubble.innerHTML = reasoningHtml + renderMarkdown(assistantMessage.content);

  bubble.querySelectorAll("pre code").forEach((block) => {
    if (window.hljs) hljs.highlightElement(block);
  });

  scrollToBottom();
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
  renderPendingAttachments();
  updateControls();

  if (!state.settings.apiKey) {
    openSettings();
  }

  // 加载自定义背景
  const bg = await window.deepseekApp.getBackground();
  if (bg) {
    document.body.classList.add("has-bg");
    document.body.style.backgroundImage = `url('${bg}')`;
  }
}

dom.newChatBtn.addEventListener("click", newConversation);
dom.settingsBtn.addEventListener("click", openSettings);
dom.cancelSettingsBtn.addEventListener("click", closeSettings);
dom.saveSettingsBtn.addEventListener("click", saveSettings);
dom.clearBtn.addEventListener("click", clearConversation);
dom.attachBtn.addEventListener("click", selectFiles);
dom.searchToggleBtn.addEventListener("click", () => {
  state.searchEnabled = !state.searchEnabled;
  setToolbarStatus(state.searchEnabled ? "本次提问将联网搜索。" : "");
  updateControls();
});
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

dom.attachmentTray.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-attachment]");
  if (removeButton) {
    removePendingAttachment(removeButton.dataset.removeAttachment);
  }
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
    if (suggestion.dataset.suggestion.includes("联网搜索")) {
      state.searchEnabled = true;
      updateControls();
    }
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
