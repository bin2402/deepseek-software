# DeepSeek 本地客户端

一个基于 Electron 的 DeepSeek V4 本地桌面聊天客户端，支持本地保存设置和会话记录。

## 功能

- 只保留 `deepseek-v4-flash` 和 `deepseek-v4-pro` 模型
- 中文界面
- 本地会话列表、聊天窗口、设置弹窗
- 支持流式输出和停止生成
- 数据默认保存在程序同级 `data/` 文件夹

## 开发运行

```bash
cd app
npm install
npm start
```

## 打包

```bash
cd app
npm run build
```

打包后会在项目根目录生成便携版 `DeepSeek本地客户端.exe`。

## API Key 安全

请不要提交真实 API Key。运行程序后生成的 `data/` 目录已被 `.gitignore` 忽略。
