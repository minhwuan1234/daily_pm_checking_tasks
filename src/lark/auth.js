const axios = require('axios');

let cachedToken = null;
let tokenExpiry = 0;

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

  console.log('Auth response code:', res.data.code);
  console.log('Access token prefix:', res.data.data?.access_token?.slice(0, 10));

  if (res.data.code !== 0) {
    throw new Error(JSON.stringify(res.data));
  }

  cachedToken = res.data.data.access_token;
  tokenExpiry = Date.now() + (res.data.data.expires_in - 60) * 1000;
  return cachedToken;
}

module.exports = { getAccessToken };
