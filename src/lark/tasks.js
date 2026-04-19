const axios = require('axios');
const { getAccessToken } = require('./auth');

const BASE = 'https://open.larksuite.com/open-apis';

async function searchTasks(keyword) {
  const token = await getAccessToken();

  const res = await axios.get(`${BASE}/task/v2/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
    params:  { page_size: 50 },
  });

  const tasks = res.data?.data?.items || [];

  const matched = tasks.filter(t => {
    const title = (t.summary || '').replace(/^\d+\.\s*[""]?/, '').toLowerCase();
    return title.includes(keyword.toLowerCase());
  });

  return matched;
}

async function getTaskDetail(taskId) {
  const token = await getAccessToken();

  const res = await axios.get(`${BASE}/task/v2/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const t = res.data?.data?.task;
  if (!t) return null;

  return {
    id:          t.guid,
    title:       t.summary,
    description: t.description || '',
    status:      t.completed_at ? 'completed' : 'in_progress',
    due:         t.due?.timestamp
                   ? new Date(parseInt(t.due.timestamp) * 1000).toLocaleDateString('vi-VN')
                   : null,
    url: `https://applink.larksuite.com/client/todo/detail?guid=${t.guid}`,
  };
}

module.exports = { searchTasks, getTaskDetail };
