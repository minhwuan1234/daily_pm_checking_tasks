const axios = require('axios');

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id:     process.env.LARK_APP_ID,
      app_secret: process.env.LARK_APP_SECRET,
    }
  );

  cachedToken = res.data.tenant_access_token;
  tokenExpiry = Date.now() + (res.data.expire - 60) * 1000;
  return cachedToken;
}

module.exports = { getAccessToken };
