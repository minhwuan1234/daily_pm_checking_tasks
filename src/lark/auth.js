const axios = require('axios');

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const refreshToken = process.env.LARK_REFRESH_TOKEN;
  const appId        = process.env.LARK_APP_ID;
  const appSecret    = process.env.LARK_APP_SECRET;

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/oidc_refresh_access_token',
    {
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    },
    {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${appId}:${appSecret}`).toString('base64'),
      },
    }
  );

  if (res.data.code !== 0) {
    throw new Error(`Lark refresh token error: ${JSON.stringify(res.data)}`);
  }

  const { access_token, expires_in, refresh_token } = res.data.data;

  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 60) * 1000;

  if (refresh_token) {
    console.log('🔄 New refresh token:', refresh_token.slice(0, 20) + '...');
  }

  return cachedToken;
}

module.exports = { getAccessToken };
