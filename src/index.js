const axios = require('axios');

// ── Auth ─────────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/refresh_access_token',
    {
      grant_type:    'refresh_token',
      refresh_token: process.env.LARK_REFRESH_TOKEN,
      app_id:        process.env.LARK_APP_ID,
      app_secret:    process.env.LARK_APP_SECRET,
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));
  cachedToken = res.data.data.access_token;
  tokenExpiry = Date.now() + (res.data.data.expires_in - 60) * 1000;
  return cachedToken;
}

// ── Lark API helpers ─────────────────────────────────────────────
const BASE = 'https://open.larksuite.com/open-apis';

async function searchTasks(keyword) {
  const token = await getAccessToken();
  const res = await axios.get(`${BASE}/task/v2/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
    params:  { page_size: 50 },
  });
  const tasks = res.data?.data?.items || [];
  return tasks.filter(t => {
    const title = (t.summary || '').replace(/^\d+\.\s*[""]?/, '').toLowerCase();
    return title.includes(keyword.toLowerCase());
  });
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
      text:      c.content || '',
      createdAt: new Date(parseInt(c.created_at) * 1000)
                   .toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    }));
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  const { date, members = [] } = payload;

  console.log(`📅 Ngày: ${date}`);
  console.log(`👥 Thành viên: ${members.length}\n`);

  const token = await getAccessToken();
  console.log('✅ Token OK:', token.slice(0, 15));

  const report = [];

  for (const m of members) {
    console.log(`\n👤 ${m.member}`);
    const memberReport = { member: m.member, tasks: [] };

    for (const t of m.tasks) {
      console.log(`  🔍 Search: "${t.task.slice(0, 60)}"`);
      const matched = await searchTasks(t.task);

      if (!matched.length) {
        console.log(`  ⚠️  Không tìm thấy trên Lark`);
        memberReport.tasks.push({ taskName: t.task, larkFound: false });
        continue;
      }

      const larkTask = matched[0];
      console.log(`  ✅ Match: "${larkTask.summary}"`);

      const detail   = await getTaskDetail(larkTask.guid);
      const comments = await getRecentComments(larkTask.guid);
      console.log(`  💬 Comments 24h: ${comments.length}`);

      memberReport.tasks.push({
        taskName:    t.task,
        larkTitle:   detail.title,
        status:      detail.status,
        due:         detail.due,
        description: detail.description,
        url:         detail.url,
        comments,
        larkFound:   true,
      });
    }
    report.push(memberReport);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📋 REPORT:');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error('❌ Lỗi:', err.response?.data || err.message);
  process.exit(1);
});
