const axios = require('axios');
const { getAccessToken } = require('./auth');

const BASE = 'https://open.larksuite.com/open-apis';

async function getRecentComments(taskId) {
  const token = await getAccessToken();

  const res = await axios.get(`${BASE}/task/v2/tasks/${taskId}/comments`, {
    headers: { Authorization: `Bearer ${token}` },
    params:  { page_size: 100 },
  });

  const comments = res.data?.data?.items || [];
  const since = Date.now() - 24 * 60 * 60 * 1000;

  return comments
    .filter(c => parseInt(c.created_at) * 1000 >= since)
    .map(c => ({
      author:    c.creator?.id || 'unknown',
      text:      extractText(c.content),
      createdAt: new Date(parseInt(c.created_at) * 1000)
                   .toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function extractText(content) {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    return parsed
      .map(block => (block.body?.elements || [])
        .map(el => el.text_run?.content || '')
        .join('')
      )
      .join('\n')
      .trim();
  } catch {
    return String(content).trim();
  }
}

module.exports = { getRecentComments };
