const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const TASKLIST_GUID = 'eb4234bf-c611-4e74-9798-1c288f1f04e5';
const BASE          = 'https://open.larksuite.com/open-apis';
const TOKEN_FILE    = path.join(process.env.GITHUB_WORKSPACE || '.', '.lark_token');

let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  let refreshToken = process.env.LARK_REFRESH_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (saved.refresh_token) { refreshToken = saved.refresh_token; console.log('📂 Dùng refresh token từ file'); }
    } catch(e) {}
    console.log('Full access token:', access_token);
  }

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/refresh_access_token',
    { grant_type: 'refresh_token', refresh_token: refreshToken, app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET },
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));

  const { access_token, refresh_token, expires_in } = res.data.data;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token, updated_at: new Date().toISOString() }));

  const { execSync } = require('child_process');
  try {
    execSync('git config user.email "actions@github.com"');
    execSync('git config user.name "GitHub Actions"');
    execSync(`git add ${TOKEN_FILE}`);
    execSync('git commit -m "chore: rotate lark refresh token" --allow-empty');
    execSync('git push');
    console.log('🔄 Refresh token rotated & saved');
  } catch(e) { console.warn('⚠️ Git push failed:', e.message.slice(0,80)); }

  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 60) * 1000;
  console.log('✅ Token OK:', access_token.slice(0, 15));
  return cachedToken;
}

async function searchTaskInTasklist(keyword) {
  const token = await getAccessToken();
  let allTasks = [], pageToken = null;
  do {
    const params = { page_size: 100 };
    if (pageToken) params.page_token = pageToken;
    const res = await axios.get(`${BASE}/task/v2/tasklists/${TASKLIST_GUID}/tasks`, { headers: { Authorization: `Bearer ${token}` }, params });
    allTasks = allTasks.concat(res.data?.data?.items || []);
    pageToken = res.data?.data?.page_token;
  } while (pageToken);

  console.log(`  📋 Tasklist có ${allTasks.length} tasks`);
  const kw = keyword.toLowerCase().trim();
  return allTasks.filter(t => {
    const title = (t.summary || '').replace(/^\d+\.\s*[""]?/, '').toLowerCase().trim();
    return title.includes(kw) || kw.includes(title.slice(0, 30));
  });
}

async function getTaskDetail(taskGuid) {
  const token = await getAccessToken();
  const res = await axios.get(`${BASE}/task/v2/tasks/${taskGuid}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.data.code !== 0) { console.warn('⚠️ Detail error:', res.data.msg); return null; }

  const t = res.data?.data?.task;
  if (!t) return null;

  const ts = parseInt(t.due?.timestamp || 0);
  const ms = ts > 1e10 ? ts : ts * 1000;

  return {
    title:       t.summary,
    description: t.description || '',
    status:      t.completed_at && t.completed_at !== '0' ? 'completed' : 'in_progress',
    due:         ts ? new Date(ms).toLocaleDateString('vi-VN') : null,
    guid:        t.guid,
    task_id:     t.task_id,
    url:         `https://applink.larksuite.com/client/todo/detail?guid=${t.guid}`,
  };
}

async function getRecentComments(detail) {
  if (!detail) return [];
  const token = await getAccessToken();
  const since = Date.now() - 24 * 60 * 60 * 1000;

  // Thử tất cả endpoint có thể với user token
  const endpoints = [
    `${BASE}/task/v2/tasks/${detail.guid}/comments`,
    `${BASE}/task/v1/tasks/${(detail.task_id||'').replace(/^t/,'')}/comments`,
    `${BASE}/task/v1/tasks/${detail.task_id}/comments`,
  ].filter(e => !e.includes('undefined') && !e.includes('null'));

  for (const endpoint of endpoints) {
    try {
      const res = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        params:  { page_size: 100 },
      });
      console.log(`  💬 ${endpoint.split('/').slice(-3).join('/')} → code:${res.data.code} msg:${res.data.msg}`);

      if (res.data.code === 0) {
        const items = res.data?.data?.items || [];
        console.log(`  💬 Total comments: ${items.length}`);
        return items
          .filter(c => {
            const ts = parseInt(c.create_milli_time || c.created_at || 0);
            const ms = ts > 1e10 ? ts : ts * 1000;
            return ms >= since;
          })
          .map(c => {
            const ts = parseInt(c.create_milli_time || c.created_at || 0);
            const ms = ts > 1e10 ? ts : ts * 1000;
            return {
              text:      c.content || c.body?.content || '',
              createdAt: new Date(ms).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            };
          });
      }
    } catch(e) {
      console.warn(`  ⚠️ ${endpoint.split('/').slice(-3).join('/')} error:`, e.response?.status, e.response?.data?.msg || e.message);
    }
  }
  return [];
}

async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  const { date, members = [] } = payload;
  console.log(`📅 Ngày: ${date}\n👥 Thành viên: ${members.length}\n📋 Tasklist: ${TASKLIST_GUID}\n`);

  const report = [];
  for (const m of members) {
    console.log(`\n👤 ${m.member}`);
    const memberReport = { member: m.member, tasks: [] };

    for (const t of m.tasks) {
      console.log(`  🔍 Search: "${t.task.slice(0, 60)}"`);
      const matched = await searchTaskInTasklist(t.task);

      if (!matched.length) {
        console.log('  ⚠️ Không tìm thấy');
        memberReport.tasks.push({ taskName: t.task, larkFound: false });
        continue;
      }

      const larkTask = matched[0];
      console.log(`  ✅ Match: "${larkTask.summary}"`);

      const detail   = await getTaskDetail(larkTask.guid);
      const comments = await getRecentComments(detail);
      console.log(`  📅 Due: ${detail?.due} | 💬 Comments 24h: ${comments.length}`);

      memberReport.tasks.push({
        taskName:    t.task,
        larkTitle:   detail?.title,
        status:      detail?.status,
        due:         detail?.due,
        description: detail?.description,
        url:         detail?.url,
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

main().catch(err => { console.error('❌ Lỗi:', err.response?.data || err.message); process.exit(1); });
