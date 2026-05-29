const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

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

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
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
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
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
