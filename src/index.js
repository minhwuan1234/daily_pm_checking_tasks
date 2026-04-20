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
  console.log('✅ Token OK:', access_token.slice(0, 15));
  return cachedToken;
}

async function searchTaskInTasklist(keyword) {
  const token = await getAccessToken();
  let allTasks = [], pageToken = null;
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
    url:         `https://applink.larksuite.com/client/todo/detail?guid=${t.guid}`,
  };
}

async function getRecentComments(detail) {
  if (!detail) return [];
  const token = await getAccessToken();
  const res = await axios.get(`${BASE}/task/v2/comments`, {
    headers: { Authorization: `Bearer ${token}` },
    params:  { resource_type: 'task', resource_id: detail.guid, page_size: 100 },
    timeout: 15000,
  });
  if (res.data.code !== 0) return [];

  const since = Date.now() - 24 * 60 * 60 * 1000;
  return (res.data?.data?.items || [])
    .filter(c => {
      const ts = parseInt(c.created_at || 0);
      return (ts > 1e10 ? ts : ts * 1000) >= since;
    })
    .map(c => {
      const ts = parseInt(c.created_at || 0);
      return {
        text:      c.content || '',
        createdAt: new Date(ts > 1e10 ? ts : ts * 1000)
                     .toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      };
    });
}

// ── OpenAI phân tích từng task ────────────────────────────────────
async function analyzeTask(member, task, date) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.warn('⚠️ Không có OPENAI_API_KEY'); return null; }

  const commentsText = task.comments?.length > 0
    ? task.comments.map(c => `  [${c.createdAt}] ${c.text}`).join('\n')
    : '  Không có activity trong 24h qua';

  const systemPrompt = `Bạn là PM assistant. Nhiệm vụ: phân tích task và trả về JSON thuần túy.
Quy tắc bắt buộc:
- Chỉ trả về JSON, không có text nào khác
- Không dùng markdown code block
- Đúng format schema được yêu cầu`;

  const userPrompt = `Phân tích task sau:

Thành viên: ${member}
Tên task: ${task.larkTitle}
Trạng thái: ${task.status === 'completed' ? 'Hoàn thành' : 'Đang thực hiện'}
Deadline: ${task.due || 'Không có'}
Mô tả: ${task.description || 'Không có'}
Comments 24h:
${commentsText}
Ngày hôm nay: ${date}

Trả về JSON với schema sau:
{
  "status_summary": "string - 1 câu tóm tắt tình trạng task",
  "risk_level": "low | medium | high",
  "risk_reason": "string - lý do đánh giá risk",
  "next_action": "string - PM cần làm gì ngay hôm nay",
  "assignee_action": "string - thành viên cần làm gì tiếp theo"
}`;

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model:       'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' }, // đảm bảo luôn trả JSON
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
    }
  );

  const text = res.data?.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(text);
  } catch(e) {
    console.warn('⚠️ Parse AI response failed:', text.slice(0, 100));
    return null;
  }
}

// ── Format output chuẩn ───────────────────────────────────────────
function buildFinalOutput(report, date) {
  return {
    date,
    generated_at:  new Date().toISOString(),
    total_members: report.length,
    total_tasks:   report.reduce((s, m) => s + m.tasks.length, 0),
    members: report.map(m => ({
      member: m.member,
      tasks:  m.tasks.map(t => ({
        task_info: {
          name:        t.larkTitle || t.taskName,
          status:      t.status || 'unknown',
          due:         t.due || null,
          description: t.description || '',
          url:         t.url || null,
          lark_found:  t.larkFound,
        },
        recent_activity: {
          comment_count: t.comments?.length || 0,
          comments:      t.comments || [],
        },
        ai_analysis: t.ai_analysis || null,
      })),
    })),
  };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  const { date, members = [] } = payload;

  console.log(`📅 Ngày: ${date}`);
  console.log(`👥 Thành viên: ${members.length}`);
  console.log(`📋 Tasklist: ${TASKLIST_GUID}\n`);

  const report = [];

  // Bước 1: Lấy data từ Lark
  for (const m of members) {
    console.log(`\n👤 ${m.member}`);
    const memberReport = { member: m.member, tasks: [] };

    for (const t of m.tasks) {
      console.log(`  🔍 Search: "${t.task.slice(0, 60)}"`);
      const matched = await searchTaskInTasklist(t.task);

      if (!matched.length) {
        console.log('  ⚠️ Không tìm thấy trên Lark');
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

  // Bước 2: OpenAI phân tích từng task
  console.log('\n🤖 Đang phân tích với OpenAI...');
  for (const member of report) {
    for (const task of member.tasks) {
      if (!task.larkFound) continue;
      console.log(`  📝 ${member.member} - ${task.larkTitle?.slice(0, 40)}`);
      task.ai_analysis = await analyzeTask(member.member, task, date);
    }
  }

  // Bước 3: Output chuẩn
  const finalOutput = buildFinalOutput(report, date);
  console.log('\n' + '═'.repeat(60));
  console.log('📦 FINAL OUTPUT:');
  console.log(JSON.stringify(finalOutput, null, 2));
}

main().catch(err => {
  console.error('❌ Lỗi:', err.response?.data || err.message);
  process.exit(1);
});
