/**
 * The panel reflects the live MCP connection, never just remembered trust.
 *
 * Design rule (the chat is an outbox, not a conversation):
 * the agent software owns the turn. A message sent from here is delivered on
 * the agent's next tool call, and a message sent while the agent is idle sits
 * in the outbox until it acts. That is exactly what typing in the agent's own
 * chat box does, so the panel must behave the same way — and must never lock
 * itself waiting for an answer that may not come.
 *
 * Therefore the composer is only ever blocked by two things: not being
 * connected at all, and a message currently in flight (milliseconds). A
 * missing reply is a hint with a deadline, never a lock.
 */
export function panelState(snapshot = {}) {
  const client = (snapshot.clients || []).find((c) => c.paired && c.id === snapshot.connectedClientId);
  const connected = snapshot.status === 'connected' && !!client;
  const sending = !!snapshot.sending;
  const operating = !!snapshot.operating || !!snapshot.busy;
  const waiting = !!snapshot.pendingReplyAt;
  const stopRequested = !!snapshot.stopRequested;
  const mode = !connected ? 'offline' : operating ? 'operating' : sending || waiting ? 'replying' : 'ready';
  const label = { offline: '未连接', ready: '已连接', operating: '正在操作', replying: '等待回复' }[mode];
  const placeholder = stopRequested ? '已请求停止，未收到确认也可以继续…' : {
    offline: '连接 AI 后即可聊天',
    ready: '问它当前页面的事，或让它去做点什么…',
    operating: 'AI 正在操作浏览器，消息会排到它下一次操作后送达…',
    replying: 'AI 还没回复，你可以继续发送…',
  }[mode];
  return {
    client,
    connected,
    mode,
    label,
    placeholder,
    stopRequested,
    canStop: connected && (operating || waiting) && !stopRequested,
    // Stop is offered while the agent is driving the browser, or while a reply
    // is still owed — never merely because the user typed something.
    action: operating || stopRequested ? 'stop' : 'send',
    // The only real block: no connection, or this message is on the wire.
    locked: !connected || sending,
    hint: label,
  };
}
