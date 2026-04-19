const axios = require('axios');

// ── Auth: tự động update refresh token sau mỗi lần dùng ─────────
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

  const { access_token, refresh_token, expires_in } = res.data.data;

  // Lưu refresh token mới vào GitHub Secret qua API
  if (refresh_token && process.env.GITHUB_TOKEN) {
    await updateGithubSecret(refresh_token);
  }

  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 60) * 1000;
  console.log('✅ Token OK:', access_token.slice(0, 15));
  return cachedToken;
}

async function updateGithubSecret(newRefreshToken) {
  try {
    // Lấy public key để encrypt secret
    const keyRes = await axios.get(
      `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/secrets/public-key`,
      { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' } }
    );
    const { key, key_id } = keyRes.data;

    // Encrypt bằng libsodium
    const sodium = require('libsodium-wrappers');
    await sodium.ready;
    const binkey  = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
    const binsec  = sodium.from_string(newRefreshToken);
    const encrypted = sodium.crypto_box_seal(binsec, binkey);
    const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

    // Update secret
    await axios.put(
      `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/secrets/LARK_REFRESH_TOKEN`,
      { encrypted_value: encryptedB64, key_id },
      { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' } }
    );
    console.log('🔄 Refresh token updated in GitHub Secrets');
  } catch (e) {
    console.warn('⚠️  Không update được refresh token:', e.message);
  }
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
    .map(c => ({ text: c.content || '', createdAt: new Date(parseInt(c.created_at) * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) }));
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  const { date, members = [] } = payload;

  console.log(`📅 Ngày: ${date}`);
  console.log(`👥 Thành viên: ${members.length}\n`);

  const report = [];

  for (const m of members) {
    console.log(`\n👤 ${m.member}`);
    const memberReport = { member: m.member, tasks: [] };

    for (const t of m.tasks) {
      console.log(`  🔍 Search: "${t.task.slice(0, 60)}"`);
      const matched = await searchTasks(t.task);

      if (!matched.length) {
        console.log(`  ⚠️  Không tìm thấy`);
        memberReport.tasks.push({ taskName: t.task, larkFound: false });
        continue;
      }

      const larkTask = matched[0];
      console.log(`  ✅ Match: "${larkTask.summary}"`);

      const detail   = await getTaskDetail(larkTask.guid);
      const comments = await getRecentComments(larkTask.guid);
      console.log(`  💬 Comments 24h: ${comments.length}`);

      memberReport.tasks.push({
        taskName: t.task, larkTitle: detail.title,
        status: detail.status, due: detail.due,
        description: detail.description, url: detail.url,
        comments, larkFound: true,
      });
    }
    report.push(memberReport);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error('❌ Lỗi:', err.response?.data || err.message);
  process.exit(1);
});
