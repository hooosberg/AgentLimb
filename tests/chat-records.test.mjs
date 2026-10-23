import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_RECORD_LIMIT, sanitizeChatRecord, sanitizeChatRecords } from '../kernel/shared/chat-records.js';

test('chat records retain only visible transcript fields and a page summary', () => {
  assert.deepEqual(sanitizeChatRecord({
    from: 'user', text: 'hello', at: 'now', body: 'private body', screenshots: ['x'],
    page: { title: 'Example', url: 'https://example.test', restricted: true, body: 'ignored' },
  }), {
    from: 'user', text: 'hello', at: 'now',
    page: { title: 'Example', url: 'https://example.test', restricted: true },
  });
});

test('legacy activity and invalid records are dropped, with only the newest 20 retained', () => {
  const records = Array.from({ length: CHAT_RECORD_LIMIT + 3 }, (_, i) => ({
    from: i === 2 ? 'activity' : 'agent', text: String(i), at: String(i),
  }));
  const result = sanitizeChatRecords(records);
  assert.equal(result.length, CHAT_RECORD_LIMIT);
  assert.equal(result[0].text, '3');
  assert.equal(result.at(-1).text, String(CHAT_RECORD_LIMIT + 2));
  assert.deepEqual(sanitizeChatRecords([null, { from: 'system', text: 'ok' }]), [
    { from: 'system', text: 'ok', at: '' },
  ]);
});
