# 开发工作流

## 日常循环

```bash
cd cowork_lite

# 1. 改代码（无构建步骤，纯 ES module，存盘即生效）
# 2. 跑协议测试（2-3 秒，不需要 Chrome）
npm test
# 3. chrome://extensions → 点本扩展的 ↻（重新加载已解压扩展）
# 4. 侧栏点开验证
```

**扩展没有打包/编译环节。** SW 和内容脚本改动后必须在 chrome://extensions
点刷新；侧栏/配对页刷新侧栏即可。

## 三种植入验证方式

### A. 协议测试（CI 级，全自动）
`npm test` —— `tests/protocol.test.mjs` 会 spawn 真的 MCP 子进程，再用一个
「模拟扩展」（Node fetch SSE + POST）把配对、工具调用、user_message 全链路跑完。
**不需要装插件、不需要 Chrome。** 改协议/桥接/配对逻辑后必须跑。

### B. 无浏览器链路验证
```bash
node bin/agentlimb.mjs mcp        # 起到 MCP + 桥接
node bin/agentlimb.mjs status     # 另一个终端探测
```
此时没有任何浏览器连接，`tools/call` 会在 20s 后报
`no browser extension connected` —— 这是预期，用来验证「没扩展时报错路径」。

### C. 真机验证（需要你亲自加载插件）
见下方「真机验证清单」。

## 真机验证清单

在 Chrome 加载 `cowork_lite`（开发者模式 → 加载已解压）后：

1. **未配对态**：点扩展图标 → 侧栏只有「复制连接提示词」大按钮和一句「侧栏与运行无关」的说明 → 点它 → 粘贴到
   任意文本编辑器，确认提示词含 `mcpServers` JSON 和 `~/.agentlimb/host/mcp-server.mjs`
   以及「替换 ~ 为绝对路径」的警告
2. **图标开关**：侧栏开着时再点一次扩展图标 → 侧栏关闭（开/关切换，Cmd/Ctrl+E 同效）
2. **配对**：另开终端 `node bin/agentlimb.mjs mcp` → 约 1 分钟内（或开关一次侧栏加速）
   自动弹出配对标签页 → 点「允许连接」→ 标签页自动关闭
3. **已配对态**：侧栏变成聊天窗，左上角有 `My Agent · 智能体` 芯片
4. **快捷操作**：聊天窗上方「截图 / 标签列表 / 读取页面」三个按钮直接出结果
   （截图渲染成图片气泡；读取页面输出 a11y 树文本）
5. **聊天送达**：输入框发一句话 → 出现「已送达 AI」→ 终端 stderr 可见
   `user message: …` 日志
6. **agent 侧工具调用**：用任意 MCP 客户端连上后调用 `ping`，应返回 pong
7. **断开**：侧栏点「断开」→ 侧栏回到未配对态
8. **重连自动**：再跑 `node bin/agentlimb.mjs mcp` → **不再弹配对页**，直接可用

## 调试技巧

- **SW 日志**：chrome://extensions → 本扩展「Service Worker」链接 → DevTools Console
- **侧栏日志**：侧栏右键 → 检查
- **内容脚本日志**：页面 F12 → Console（a11y-tree / indicator 的日志在这）
- **宿主日志**：MCP 进程的 stderr，同时以 `notifications/message` 推给 agent
- **协议抓包**：host 侧所有帧都有 log；扩展侧在 bridge-client.js 的
  `handleFrame` 里加 `console.log(JSON.stringify(frame))`
- **配对状态文件**：`~/.agentlimb/paired-clients.json` 可直接编辑/删除来重置配对
- **扩展侧配对存储**：DevTools → Application → Storage → Extension → local storage
  （key: `agentlimb.pairedClients`）

## 已知坑（踩过）

1. **相对导入层级**：`host/*.mjs` 导入 kernel 是 `../kernel/...`（一层），
   `bin/agentlimb.mjs` 也是 `../kernel/...`。安装到 `~/.agentlimb` 时**必须保持
   目录镜像**（install.sh 已处理），否则 ERR_MODULE_NOT_FOUND。
2. **`chrome.tabs.sendMessage` 必须显式 `{frameId: 0}`**：不传则多 iframe 页面
   响应来源不确定。
3. **测试里别提前 await `mcp.request('tools/call')`**：模拟扩展还没回
   tool_result 就 await 会死锁 20s 超时。正确姿势：先拿 promise，等 SSE 上出现
   tool_call 帧，回结果，再 await。
4. **manifest 有 `default_locale` 就必须有 `_locales/<lang>/messages.json`**，
   否则扩展加载失败。本版本 UI 硬编码中文，已移除 default_locale。
5. **CSP**：manifest 的 `extension_pages` 必须放行 `http://127.0.0.1:*`，
   否则 SW 的 fetch/EventSource 全被拦。
6. **MV3 SW 休眠**：SSE 断流后 SW 可能睡死，靠 0.4min alarm 唤醒重连；
   packed 扩展 Chrome 会把周期钳到 1 分钟。
7. **多浏览器 profile 同时连**：只有最后完成配对的是 active browser，
   工具调用只发给它。这是已知设计限制，不是 bug。

## 改代码的检查单

- [ ] 改工具 → 同步 `tools.js`（schema）+ `router.js`（实现）+ 文档
- [ ] 改协议 → 同步 `constants.js` WIRE + `bridge-client.js` + `bridge-server.mjs`
      + `docs/protocol.md` + `tests/protocol.test.mjs`
- [ ] 改用户可见文案 → 保持通用定位，**不出现第三方品牌名**（有测试断言）
- [ ] 跑 `npm test`
- [ ] 真机清单过一遍（至少 1/2/3/7）
