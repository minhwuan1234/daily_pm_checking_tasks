async function main() {
  const rawPayload = process.env.PAYLOAD;

  if (!rawPayload) {
    console.error('Không có PAYLOAD');
    process.exit(1);
  }

  const payload = JSON.parse(rawPayload);
  const { date, totalMembers, totalTasks, members } = payload;

  console.log(`Ngày: ${date}`);
  console.log(`Thành viên: ${totalMembers} | Tasks: ${totalTasks}`);
  console.log('─'.repeat(50));

  for (const m of members) {
    console.log(`\n${m.member} — ${m.taskCount} task`);
    console.log(m.tasksSummary);
  }
}

main().catch(err => {
  console.error('Lỗi:', err.message);
  process.exit(1);
});
