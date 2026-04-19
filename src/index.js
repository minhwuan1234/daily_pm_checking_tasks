const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const TASKLIST_GUID = 'eb4234bf-c611-4e74-9798-1c288f1f04e5';
const BASE          = 'https://open.larksuite.com/open-apis';
const TOKEN_FILE    = path.join(process.env.GITHUB_WORKSPACE || '.', '.lark_token');

// ── Auth ──────────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  let refreshToken = process.env.LARK_REFRESH_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (saved.refresh_token) {
        refreshToken = saved.refresh_token;
        console.log('📂 Dùng refresh token từ file');
      }
    } catch(e) {}
  }

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/refresh_access_token',
    {
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      app_id:        process.env.LARK_APP_ID,
      app_secret:    process.env.LARK_APP_SECRET,
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));

  const { access_token, refresh_token, expires_in } = res.data.data;

  fs.writeFileSync(TOKEN_FILE, JSON.stringify({
    refresh_token,
    updated_at: new Date().toISOString(),
  }));
  await commitTokenFile();

  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 60) * 1000;
  console.log('✅ Token OK:', access_token.slice(0, 15));
  return cachedToken;
}

async function commitTokenFile() {
  const { execSync } = require('child_process');
  try {
    execSync('git config user.email "actions@github.com"');
    execSync('git config user.name "GitHub Actions"');
    execSync(`git add ${TOKEN_FILE}`);
    execSync('git commit -m "chore: rotate lark refresh token" --allow-empty');
    execSync('git push');
    console.log('🔄 Refresh token rotated & saved');
  } catch (e) {
    console.warn('⚠️  Git push failed:', e.message.slice(0, 100));
  }
}

// ── Lark API ──────────────────────────────────────────────────────
async function searchTaskInTasklist(keyword) {
  const token = await getAccessToken();
  let allTasks = [];
  let pageToken = null;

  do {
    const params = { page_size: 100 };
    if (pageToken) params.page_token = pageToken;
    const res = await axios.get(
      `${BASE}/task/v2/tasklists/${TASKLIST_GUID}/tasks`,
      { headers: { Authorization: `Bearer ${token}` }, params }
    );
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

async function getTaskDetail(taskId) {
  const token = await getAccessToken();
  const res = await axios.get(`${BASE}/task/v2/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('  📄 Detail raw:', JSON.stringify(res.data).slice(0, 300));

  if (res.data.code !== 0) {
    console.warn('  ⚠️  Detail error:', res.data.msg);
    return null;
  }

  const t = res.data?.data?.task;
  if (!t) return null;
  return {
    title:       t.summary,
    description: t.description || '',
    status:      t.completed_at ? 'completed' : 'in_progress',
    due:         t.due?.timestamp
                   ? new Date(parseInt(t.due.timestamp) * 1000).toLocaleDateString('vi-VN')
                   : null,
    url: `https://applink.larksuite.com/client/todo/detail?guid=${taskId}`,
  };
}

async function getRecentComments(taskId) {
  return []; // TODO: fix comments API later
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  const { date, members = [] } = payload;

  console.log(`📅 Ngày: ${date}`);
  console.log(`👥 Thành viên: ${members.length}`);
  console.log(`📋 Tasklist: ${TASKLIST_GUID}\n`);

  const report = [];

  for (const m of members) {
    console.log(`\n👤 ${m.member}`);
    const memberReport = { member: m.member, tasks: [] };

    for (const t of m.tasks) {
      console.log(`  🔍 Search: "${t.task.slice(0, 60)}"`);
      const matched = await searchTaskInTasklist(t.task);

      if (!matched.length) {
        console.log(`  ⚠️  Không tìm thấy`);
        memberReport.tasks.push({ taskName: t.task, larkFound: false });
        continue;
      }

      const larkTask = matched[0];
      const taskId   = larkTask.guid || larkTask.id || larkTask.task_id;
      console.log(`  ✅ Match: "${larkTask.summary}" (${taskId})`);

      const detail   = await getTaskDetail(taskId);
      const comments = await getRecentComments(taskId);
      console.log(`  💬 Comments 24h: ${comments.length}`);

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

main().catch(err => {
  console.error('❌ Lỗi:', err.response?.data || err.message);
  process.exit(1);
});
