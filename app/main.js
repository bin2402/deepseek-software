const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const cheerio = require("cheerio");
const DDG = require("duck-duck-scrape");

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_TEXT = 20000;
const MAX_TOTAL_ATTACHMENT_TEXT = 60000;
const SEARCH_RESULT_LIMIT = 5;
const SEARCH_TIMEOUT_MS = 10000;
const FETCH_TIMEOUT_MS = 6000;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".csv",
  ".html",
  ".htm",
  ".css",
  ".xml",
  ".yaml",
  ".yml",
  ".log",
  ".ini",
  ".conf",
  ".sql",
  ".bat",
  ".ps1",
  ".sh",
]);

function getBaseDir() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, "..");
  }

  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
}

const baseDir = getBaseDir();
const dataDir = path.join(baseDir, "data");
const settingsPath = path.join(dataDir, "settings.json");
const conversationsPath = path.join(dataDir, "conversations.json");
const controllers = new Map();

const defaultSettings = {
  apiKey: "",
  apiBase: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
};

const defaultConversations = {
  conversations: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function writeJson(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath, fallback) {
  ensureDataDir();

  if (!fs.existsSync(filePath)) {
    writeJson(filePath, fallback);
    return clone(fallback);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    const backupPath = `${filePath}.${Date.now()}.bak`;
    fs.copyFileSync(filePath, backupPath);
    writeJson(filePath, fallback);
    return clone(fallback);
  }
}

function normalizeModel(model) {
  return ["deepseek-v4-flash", "deepseek-v4-pro"].includes(model)
    ? model
    : defaultSettings.model;
}

function sanitizeSettings(settings) {
  return {
    apiKey: typeof settings?.apiKey === "string" ? settings.apiKey : "",
    apiBase: typeof settings?.apiBase === "string" && settings.apiBase.trim()
      ? settings.apiBase.trim().replace(/\/$/, "")
      : defaultSettings.apiBase,
    model: normalizeModel(settings?.model),
  };
}

function truncateText(text, maxLength) {
  const cleanText = String(text || "").replace(/\r\n/g, "\n").trim();
  if (cleanText.length <= maxLength) {
    return { text: cleanText, truncated: false };
  }

  return {
    text: `${cleanText.slice(0, maxLength)}\n\n[内容过长，已截断]`,
    truncated: true,
  };
}

function decodeHtml(value) {
  return cheerio.load(`<span>${value || ""}</span>`)("span").text();
}

function sanitizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const text = String(attachment.text || "").trim();
  if (!text) return null;

  return {
    id: String(attachment.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name: path.basename(String(attachment.name || "未命名文件")),
    ext: String(attachment.ext || "").toLowerCase(),
    size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
    text,
    extractedAt: attachment.extractedAt || new Date().toISOString(),
    truncated: Boolean(attachment.truncated),
  };
}

function sanitizeSearchResult(result) {
  if (!result || typeof result !== "object") return null;
  const url = String(result.url || "").trim();
  const title = String(result.title || "").trim();
  if (!url || !title) return null;

  return {
    title,
    url,
    snippet: String(result.snippet || "").trim(),
    content: String(result.content || "").trim(),
  };
}

function buildAttachmentContext(attachments) {
  const safeAttachments = (Array.isArray(attachments) ? attachments : [])
    .map(sanitizeAttachment)
    .filter(Boolean);
  if (safeAttachments.length === 0) return "";

  let usedLength = 0;
  const blocks = [];

  for (const attachment of safeAttachments.slice(0, MAX_FILES)) {
    const remaining = MAX_TOTAL_ATTACHMENT_TEXT - usedLength;
    if (remaining <= 0) break;

    const { text, truncated } = truncateText(attachment.text, Math.min(MAX_FILE_TEXT, remaining));
    usedLength += text.length;
    blocks.push([
      `文件名：${attachment.name}`,
      `类型：${attachment.ext || "未知"}`,
      `大小：${formatBytes(attachment.size)}`,
      `状态：${attachment.truncated || truncated ? "内容过长，已截断" : "完整提取"}`,
      "内容：",
      text,
    ].join("\n"));
  }

  return [
    "以下是用户上传文件中提取出的文字内容。请结合这些内容回答用户问题；如果文件内容不足以判断，请明确说明。",
    blocks.join("\n\n---\n\n"),
  ].join("\n\n");
}

function buildUserContentWithAttachments(content, attachments) {
  const attachmentContext = buildAttachmentContext(attachments);
  return [String(content || ""), attachmentContext].filter(Boolean).join("\n\n---\n\n");
}

function buildSearchContext(searchResults) {
  const safeResults = (Array.isArray(searchResults) ? searchResults : [])
    .map(sanitizeSearchResult)
    .filter(Boolean)
    .slice(0, SEARCH_RESULT_LIMIT);
  if (safeResults.length === 0) return "";

  const blocks = safeResults.map((result, index) => [
    `[${index + 1}] ${result.title}`,
    `链接：${result.url}`,
    `摘要：${result.snippet || "无"}`,
    `网页片段：${truncateText(result.content || result.snippet || "", 1600).text}`,
  ].join("\n"));

  return [
    "以下是本次联网搜索得到的网页资料。请优先基于这些资料整合回答；引用搜索信息时，在回答末尾保留对应来源编号或链接。",
    blocks.join("\n\n---\n\n"),
  ].join("\n\n");
}

function buildMessagesWithContext(messages, attachments, searchResults) {
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => ["user", "assistant", "system"].includes(message?.role))
    .map((message) => {
      const messageAttachments = Array.isArray(message.attachments) ? message.attachments : [];
      return {
        role: message.role,
        content: message.role === "user"
          ? buildUserContentWithAttachments(message.content, messageAttachments)
          : String(message.content || ""),
      };
    });

  const lastUserIndex = safeMessages.map((message) => message.role).lastIndexOf("user");
  if (lastUserIndex < 0) return safeMessages;

  const lastOriginalMessage = Array.isArray(messages) ? messages[lastUserIndex] : null;
  const hasLastMessageAttachments = Array.isArray(lastOriginalMessage?.attachments)
    && lastOriginalMessage.attachments.length > 0;
  const sections = [
    safeMessages[lastUserIndex].content,
    hasLastMessageAttachments ? "" : buildAttachmentContext(attachments),
    buildSearchContext(searchResults),
  ].filter(Boolean);

  safeMessages[lastUserIndex] = {
    role: "user",
    content: sections.join("\n\n---\n\n"),
  };

  return safeMessages;
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

function createWindow() {
  const window = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    title: "DeepSeek 本地客户端",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

async function extractPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || "";
}

async function extractTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

async function extractFile(filePath) {
  const stats = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);

  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`${name} 超过 10MB，暂不支持上传。`);
  }

  if (ext === ".doc") {
    throw new Error(`${name} 是旧版 Word 格式，请转换为 .docx 后上传。`);
  }

  let rawText = "";
  if (ext === ".pdf") {
    rawText = await extractPdf(filePath);
    if (!rawText.trim()) {
      throw new Error(`${name} 未提取到文字，可能是扫描件，暂不支持识别图片文字。`);
    }
  } else if (ext === ".docx") {
    rawText = await extractDocx(filePath);
  } else if (TEXT_EXTENSIONS.has(ext)) {
    rawText = await extractTextFile(filePath);
  } else {
    throw new Error(`${name} 的格式暂不支持。`);
  }

  const { text, truncated } = truncateText(rawText, MAX_FILE_TEXT);
  if (!text) {
    throw new Error(`${name} 未提取到可用文字。`);
  }

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    ext,
    size: stats.size,
    text,
    truncated,
    extractedAt: new Date().toISOString(),
  };
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 DeepSeekLocalClient/1.0",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) return "";

    const html = await response.text();
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, aside, noscript, svg").remove();
    const text = $("article").text() || $("main").text() || $("body").text();
    return truncateText(text.replace(/\s+/g, " "), 2200).text;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function searchWeb(query) {
  const keyword = String(query || "").trim();
  if (!keyword) return [];

  let results = [];
  try {
    const response = await withTimeout(
      DDG.search(keyword, { safeSearch: DDG.SafeSearchType.MODERATE }),
      SEARCH_TIMEOUT_MS,
      "DuckDuckGo 搜索超时。",
    );
    results = (response.results || [])
      .filter((item) => item?.title && item?.url)
      .map((item) => ({
        title: decodeHtml(item.title),
        url: item.url,
        snippet: decodeHtml(item.description || item.snippet || ""),
      }));
  } catch {
    results = await searchBing(keyword);
  }

  return Promise.all(results.slice(0, SEARCH_RESULT_LIMIT).map(async (item) => {
    return {
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      content: await fetchPageText(item.url) || item.snippet,
    };
  }));
}

async function searchBing(keyword) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(keyword)}`;
  const response = await withTimeout(fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 DeepSeekLocalClient/1.0",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    },
  }), SEARCH_TIMEOUT_MS, "联网搜索超时，请稍后再试。");

  if (!response.ok) {
    throw new Error(`联网搜索失败：HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const results = [];

  $("li.b_algo").each((_index, element) => {
    const link = $(element).find("h2 a").first();
    const href = link.attr("href");
    const title = link.text().trim();
    const snippet = $(element).find(".b_caption p, p").first().text().trim();
    if (!href || !title) return;

    results.push({
      title: decodeHtml(title),
      url: href,
      snippet: decodeHtml(snippet),
    });
  });

  return results;
}

app.whenReady().then(() => {
  ensureDataDir();
  readJson(settingsPath, defaultSettings);
  readJson(conversationsPath, defaultConversations);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("app:get-data-dir", () => dataDir);

ipcMain.handle("settings:get", () => {
  const settings = sanitizeSettings(readJson(settingsPath, defaultSettings));
  writeJson(settingsPath, settings);
  return settings;
});

ipcMain.handle("settings:save", (_event, settings) => {
  const safeSettings = sanitizeSettings(settings);
  writeJson(settingsPath, safeSettings);
  return safeSettings;
});

ipcMain.handle("conversations:get", () => {
  const data = readJson(conversationsPath, defaultConversations);
  if (!Array.isArray(data.conversations)) {
    writeJson(conversationsPath, defaultConversations);
    return clone(defaultConversations);
  }
  return data;
});

ipcMain.handle("conversations:save", (_event, data) => {
  const safeData = {
    conversations: Array.isArray(data?.conversations) ? data.conversations : [],
  };
  writeJson(conversationsPath, safeData);
  return safeData;
});

ipcMain.handle("files:select-and-extract", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择要识别的文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "支持的文件",
        extensions: [
          "docx",
          "pdf",
          "txt",
          "md",
          "markdown",
          "py",
          "js",
          "jsx",
          "ts",
          "tsx",
          "json",
          "csv",
          "html",
          "htm",
          "css",
          "xml",
          "yaml",
          "yml",
          "log",
          "ini",
          "conf",
          "sql",
          "bat",
          "ps1",
          "sh",
        ],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });

  if (result.canceled) {
    return { canceled: true, files: [], errors: [] };
  }

  const selectedPaths = result.filePaths.slice(0, MAX_FILES);
  const files = [];
  const errors = [];

  for (const filePath of selectedPaths) {
    try {
      files.push(await extractFile(filePath));
    } catch (error) {
      errors.push(error.message || `${path.basename(filePath)} 解析失败。`);
    }
  }

  if (result.filePaths.length > MAX_FILES) {
    errors.push(`一次最多上传 ${MAX_FILES} 个文件，已忽略多余文件。`);
  }

  return { canceled: false, files, errors };
});

ipcMain.handle("search:web", async (_event, query) => {
  try {
    return {
      ok: true,
      results: await searchWeb(query),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      results: [],
      error: error.message || "联网搜索失败。",
    };
  }
});

ipcMain.handle("chat:abort", (_event, requestId) => {
  const controller = controllers.get(requestId);
  if (controller) {
    controller.abort();
    controllers.delete(requestId);
  }
  return { ok: true };
});

ipcMain.handle("chat:stream", async (event, payload) => {
  const requestId = payload?.requestId;
  const messages = buildMessagesWithContext(
    payload?.messages,
    payload?.attachments,
    payload?.searchResults,
  );
  const chosenModel = normalizeModel(payload?.model);

  if (!requestId) {
    throw new Error("缺少请求编号");
  }

  const settings = sanitizeSettings(readJson(settingsPath, defaultSettings));
  if (!settings.apiKey) {
    throw new Error("请先设置 DeepSeek API 密钥");
  }

  const controller = new AbortController();
  controllers.set(requestId, controller);

  try {
    const response = await fetch(`${settings.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: chosenModel,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json();
        message = errorBody?.error?.message || message;
      } catch {
        // 保留 HTTP 状态信息。
      }
      throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta || {};
          event.sender.send("chat:chunk", {
            requestId,
            content: delta.content || "",
            reasoning: delta.reasoning_content || "",
          });
        } catch {
          // 忽略异常片段，继续读取流。
        }
      }
    }

    event.sender.send("chat:done", { requestId });
    return { ok: true };
  } catch (error) {
    if (error.name === "AbortError") {
      event.sender.send("chat:aborted", { requestId });
      return { ok: false, aborted: true };
    }

    const message = error.message || "请求失败";
    event.sender.send("chat:error", { requestId, message });
    return { ok: false, message };
  } finally {
    controllers.delete(requestId);
  }
});
