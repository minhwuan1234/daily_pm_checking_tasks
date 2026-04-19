async function main() {
  const payload = JSON.parse(process.env.PAYLOAD);
  const { date, totalMembers, totalTasks, members } = payload;

  console.log(`Ngày: ${date}`);
  console.log(`Thành viên: ${totalMembers} | Tasks: ${totalTasks}`);

  for (const m of members) {
    console.log(`\n${m.member} — ${m.taskCount} task`);
    console.log(m.tasksSummary);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
