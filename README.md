# Cowork — Universal Browser Arm

> Let any terminal AI (Claude Code / Codex / Cursor) drive your browser.

Cowork is a Chrome extension that turns your browser into a universal automation endpoint. Any tool that can send HTTP requests can observe, click, type, navigate, and evaluate JavaScript on the current page — using your existing login sessions.

## How It Works

```
Terminal AI (Claude Code / Codex / Cursor / any script)
    ↕  MCP Tools / HTTP API (8 standardized tools)
Cowork Bridge (local Node.js, port 7789)
    ↕  WebSocket
Cowork Extension (Chrome MV3)
    ↕  DOM operations
Current browser page (logged in, with cookies)
```

## 8 Tools

| Tool | Purpose |
|------|---------|
| **observe** | Read page state + optional screenshot |
| **act** | Click / type / select / navigate / scroll |
| **wait** | Wait for selector / text / URL pattern |
| **eval** | Execute JavaScript in page context |
| **route** | Skill CRUD + replay |
| **report** | Update monitoring UI |
| **ping** | Health check |
| **project** | Project file operations |

## License

MIT
