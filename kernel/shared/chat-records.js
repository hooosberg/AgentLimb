/** Small, bounded transcript records shown in the sidebar. */
export const CHAT_RECORD_LIMIT = 20;

export function sanitizeChatRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const from = ['user', 'agent', 'system'].includes(record.from) ? record.from : null;
  if (!from || typeof record.text !== 'string') return null;
  const clean = {
    from,
    text: record.text,
    at: typeof record.at === 'string' ? record.at : '',
  };
  if (record.page && typeof record.page === 'object') {
    clean.page = {
      title: typeof record.page.title === 'string' ? record.page.title : '',
      url: typeof record.page.url === 'string' ? record.page.url : '',
      restricted: Boolean(record.page.restricted),
    };
  }
  return clean;
}

export function sanitizeChatRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map(sanitizeChatRecord).filter(Boolean).slice(-CHAT_RECORD_LIMIT);
}
