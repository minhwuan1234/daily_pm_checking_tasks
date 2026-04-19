const axios = require('axios');

async function main() {
  const payload = JSON.parse(process.env.PAYLOAD || '{}');
  console.log('date:', payload.date);
  console.log('members:', payload.members?.length);
  console.log('APP_ID:', process.env.LARK_APP_ID?.slice(0,10));
  console.log('REFRESH_TOKEN:', process.env.LARK_REFRESH_TOKEN?.slice(0,15));

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/refresh_access_token',
    {
      grant_type: 'refresh_token',
      refresh_token: process.env.LARK_REFRESH_TOKEN,
      app_id: process.env.LARK_APP_ID,
      app_secret: process.env.LARK_APP_SECRET,
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  console.log('Auth code:', res.data.code);
  console.log('Auth response:', JSON.stringify(res.data));
}

main().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });
