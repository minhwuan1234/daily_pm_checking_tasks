const axios = require('axios');

let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/refresh_access_token',
    {
      app_id:        process.env.LARK_APP_ID,
      app_secret:    process.env.LARK_APP_SECRET,
      grant_type:    'refresh_token',
      refresh_token: process.env.LARK_REFRESH_TOKEN,
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  console.log('Lark refresh response:', JSON.stringify(res.data));

  if (res.data.code !== 0) {
    throw new Error(`Lark auth error: ${JSON.stringify(res.data)}`);
  }

  const { access_token, expires_in } = res.data.data;
  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 60) * 1000;
  return cachedToken;
}

module.exports = { getAccessToken };
