// Bỏ dotenv vì GitHub Actions inject env vars trực tiếp
const { getAccessToken } = require('./lark/auth');
const { searchTasks, getTaskDetail } = require('./lark/tasks');
const { getRecentComments } = require('./lark/comments');
const axios = require('axios');

async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  const { date, members = [] } = payload;

  console.log(`📅 Ngày: ${date}`);
  console.log(`👥 Số thành viên: ${members.length}\n`);

  // Test Lark token
  console.log('🔑 Lấy Lark access token...');
  const token = await getAccessToken();
  console.log('✅ Token OK');

  console.log('\n🔍 Test lấy tasks từ Lark...');
  const testRes = await axios.get(
    'https://open.larksuite.com/open-apis/task/v2/tasks',
    {
      headers: { Authorization: `Bearer ${token}` },
      params:  { page_size: 10 },
    }
  );
  const testItems = testRes.data?.data?.items || [];
  console.log(`📋 Lark trả về ${testItems.length} tasks`);

  if (testItems.length === 0) {
    console.log('⚠️  Không có task → cần user_access_token');
    return;
  }

  testItems.slice(0, 3).forEach(t => console.log(`  - ${t.summary}`));

  // Loop từng member
  const report = [];
  for (const m of members) {
    console.log(`\n👤 ${m.member}`);
    const memberReport = { member: m.member, tasks: [] };

    for (const t of m.tasks) {
      console.log(`  🔍 Search: "${t.task.slice(0, 50)}"`);
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
