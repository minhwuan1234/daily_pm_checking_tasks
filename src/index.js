const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const TASKLIST_GUID = 'eb4234bf-c611-4e74-9798-1c288f1f04e5';
const BASE          = 'https://open.larksuite.com/open-apis';
const TOKEN_FILE    = path.join(process.env.GITHUB_WORKSPACE || '.', '.lark_token');
const PM_EMAIL      = process.env.PM_EMAIL || 'minhwuan889@gmail.com';

let cachedToken     = null;
let tokenExpiry     = 0;
let tenantToken     = null;

// ── Auth ──────────────────────────────────────────────────────────
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  let refreshToken = process.env.LARK_REFRESH_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (saved.refresh_token) { refreshToken = saved.refresh_token; console.log('📂 Dùng refresh token từ file'); }
    } catch(e) {}
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
  } catch(e) { console.warn('⚠️ Git push failed:', e.message.slice(0, 80)); }

  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 60) * 1000;
  console.log('✅ User token OK:', access_token.slice(0, 15));
  return cachedToken;
}

async function getTenantToken() {
  if (tenantToken) return tenantToken;
  const res = await axios.post(
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET },
    { headers: { 'Content-Type': 'application/json' } }
  );
  tenantToken = res.data.tenant_access_token;
  return tenantToken;
}

// ── Lark Task helpers ─────────────────────────────────────────────
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

  const kw = keyword.toLowerCase().trim();
  return allTasks.filter(t => {
    const title = (t.summary || '').replace(/^\d+\.\s*[""]?/, '').toLowerCase().trim();
    return title.includes(kw) || kw.includes(title.slice(0, 30));
  });
}

async function getTaskDetail(taskGuid) {
  const token = await getAccessToken();
  const res = await axios.get(`${BASE}/task/v2/tasks/${taskGuid}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.data.code !== 0) return null;
  const t = res.data?.data?.task;
  if (!t) return null;
  const ts = parseInt(t.due?.timestamp || 0);
  const ms = ts > 1e10 ? ts : ts * 1000;
  return {
    title: t.summary, description: t.description || '',
    status: t.completed_at && t.completed_at !== '0' ? 'completed' : 'in_progress',
    due: ts ? new Date(ms).toLocaleDateString('vi-VN') : null,
    guid: t.guid,
    url: `https://applink.larksuite.com/client/todo/detail?guid=${t.guid}`,
  };
}

async function getRecentComments(detail) {
  if (!detail) return [];
  const token = await getAccessToken();
  const res = await axios.get(`${BASE}/task/v2/comments`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { resource_type: 'task', resource_id: detail.guid, page_size: 100 },
    timeout: 15000,
  });
  if (res.data.code !== 0) return [];
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return (res.data?.data?.items || [])
    .filter(c => { const ts = parseInt(c.created_at || 0); return (ts > 1e10 ? ts : ts * 1000) >= since; })
    .map(c => { const ts = parseInt(c.created_at || 0); return { text: c.content || '', createdAt: new Date(ts > 1e10 ? ts : ts * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) }; });
}

// ── OpenAI analysis ───────────────────────────────────────────────
async function analyzeTask(member, task, date) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const commentsText = task.comments?.length > 0
    ? task.comments.map(c => `  [${c.createdAt}] ${c.text}`).join('\n')
    : '  Không có activity trong 24h qua';

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Bạn là PM assistant. Chỉ trả về JSON thuần túy, không có text khác.',
        },
        {
          role: 'user',
          content: `Phân tích task:
Thành viên: ${member}
Task: ${task.larkTitle}
Status: ${task.status === 'completed' ? 'Hoàn thành' : 'Đang thực hiện'}
Deadline: ${task.due || 'Không có'}
Mô tả: ${task.description || 'Không có'}
Comments 24h:\n${commentsText}
Hôm nay: ${date}

JSON schema:
{
  "status_summary": "1 câu tóm tắt tình trạng",
  "risk_level": "low | medium | high",
  "risk_reason": "lý do risk",
  "next_action": "PM cần làm gì ngay",
  "assignee_action": "thành viên cần làm gì tiếp"
}`,
        },
      ],
    },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
  );

  try { return JSON.parse(res.data?.choices?.[0]?.message?.content || '{}'); }
  catch(e) { return null; }
}

// ── Lark: lấy open_id từ email ────────────────────────────────────
async function getOpenIdByEmail(email) {
  const token = await getTenantToken();

  // Đúng endpoint: POST với body chứa emails array
  const res = await axios.post(
    `${BASE}/contact/v3/users/batch_get_id?user_id_type=open_id`,
    { emails: [email] },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  console.log(`  👤 Lookup email ${email}:`, JSON.stringify(res.data).slice(0, 300));

  if (res.data.code !== 0) {
    console.error('  ❌ Lookup error:', res.data.msg);
    return null;
  }

  const userList = res.data?.data?.user_list || [];
  if (!userList.length) return null;
  const user = userList.find(u => u.user_id);
  return user?.user_id || null;
}

// ── Lark: format & gửi message ────────────────────────────────────
function buildRiskBadge(level) {
  const map = { low: '🟢 Thấp', medium: '🟡 Trung bình', high: '🔴 Cao' };
  return map[level] || '⚪ N/A';
}

function buildMessageText(report, date) {
  let lines = [];
  lines.push(`📋 *Báo cáo task hàng ngày - ${date}*`);
  lines.push(`👥 ${report.length} thành viên | ${report.reduce((s,m)=>s+m.tasks.length,0)} tasks\n`);

  for (const member of report) {
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`👤 *${member.member}*`);

    for (const t of member.tasks) {
      if (!t.larkFound) {
        lines.push(`  ⚠️ Task không tìm thấy: ${t.taskName}`);
        continue;
      }

      const ai = t.ai_analysis;
      lines.push(`\n  📌 *${t.larkTitle}*`);
      lines.push(`  Status: ${t.status === 'completed' ? '✅ Hoàn thành' : '🔄 Đang làm'}`);
      lines.push(`  Deadline: ${t.due || 'Không có'}`);
      if (t.recent_activity?.comment_count > 0) {
        lines.push(`  💬 ${t.recent_activity.comment_count} comment trong 24h`);
      }
      if (ai) {
        lines.push(`\n  📊 *Tình trạng:* ${ai.status_summary}`);
        lines.push(`  ⚡ *Risk:* ${buildRiskBadge(ai.risk_level)} — ${ai.risk_reason}`);
        lines.push(`  🎯 *PM action:* ${ai.next_action}`);
        lines.push(`  ✏️ *${member.member} cần:* ${ai.assignee_action}`);
      }
      if (t.url) lines.push(`  🔗 ${t.url}`);
    }
  }

  lines.push(`\n━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`⏰ Tự động tổng hợp lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);

  return lines.join('\n');
}

async function sendLarkMessage(openId, text) {
  const token = await getTenantToken();
  const res = await axios.post(
    `${BASE}/im/v1/messages?receive_id_type=open_id`,
    {
      receive_id: openId,
      msg_type:   'text',
      content:    JSON.stringify({ text }),
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  if (res.data.code !== 0) {
    console.error('❌ Gửi Lark message thất bại:', res.data.msg);
  } else {
    console.log('✅ Đã gửi message thành công!');
  }
  return res.data;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  const { date, members = [] } = payload;
  console.log(`📅 Ngày: ${date} | 👥 ${members.length} thành viên\n`);

  const report = [];

  // Bước 1: Lấy data từ Lark
  for (const m of members) {
    console.log(`\n👤 ${m.member}`);
    const memberReport = { member: m.member, tasks: [] };
    for (const t of m.tasks) {
      console.log(`  🔍 Search: "${t.task.slice(0, 60)}"`);
      const matched = await searchTaskInTasklist(t.task);
      if (!matched.length) { console.log('  ⚠️ Không tìm thấy'); memberReport.tasks.push({ taskName: t.task, larkFound: false }); continue; }

      const larkTask = matched[0];
      const detail   = await getTaskDetail(larkTask.guid);
      const comments = await getRecentComments(detail);
      console.log(`  ✅ "${larkTask.summary}" | Due: ${detail?.due} | 💬 ${comments.length}`);

      memberReport.tasks.push({
        taskName: t.task, larkTitle: detail?.title, status: detail?.status,
        due: detail?.due, description: detail?.description, url: detail?.url,
        comments, larkFound: true,
        recent_activity: { comment_count: comments.length, comments },
      });
    }
    report.push(memberReport);
  }

  // Bước 2: OpenAI phân tích
  console.log('\n🤖 Phân tích với OpenAI...');
  for (const member of report) {
    for (const task of member.tasks) {
      if (!task.larkFound) continue;
      console.log(`  📝 ${member.member} - ${task.larkTitle?.slice(0, 40)}`);
      task.ai_analysis = await analyzeTask(member.member, task, date);
    }
  }

  // Bước 3: Gửi message cho PM qua Lark
  console.log(`\n📨 Gửi báo cáo cho ${PM_EMAIL}...`);
  const openId = await getOpenIdByEmail(PM_EMAIL);
  if (!openId) {
    console.error(`❌ Không tìm được open_id cho email ${PM_EMAIL}`);
  } else {
    console.log(`  ✅ Open ID: ${openId}`);
    const messageText = buildMessageText(report, date);
    await sendLarkMessage(openId, messageText);
  }

  // Log final output
  console.log('\n' + '═'.repeat(60));
  console.log('📦 FINAL OUTPUT:');
  console.log(JSON.stringify({ date, report }, null, 2));
}

main().catch(err => {
  console.error('❌ Lỗi:', err.response?.data || err.message);
  process.exit(1);
});
