const axios = require('axios');

let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const appId        = process.env.LARK_APP_ID;
  const appSecret    = process.env.LARK_APP_SECRET;
  const refreshToken = process.env.LARK_REFRESH_TOKEN;

  console.log('APP_ID exists:        ', !!appId);
  console.log('APP_SECRET exists:    ', !!appSecret);
  console.log('REFRESH_TOKEN exists: ', !!refreshToken);
  console.log('REFRESH_TOKEN prefix: ', refreshToken?.slice(0, 20));

  // Lark v1: refresh user access token
  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/refresh_access_token',
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

  console.log('Auth response code:', res.data.code);
  console.log('Auth response:', JSON.stringify(res.data));

  if (res.data.code !== 0) {
    throw new Error(`Lark auth error: ${JSON.stringify(res.data)}`);
  }

  const { access_token, expires_in } = res.data.data;
  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 60) * 1000;

  console.log('access_token prefix:', access_token?.slice(0, 20));
  return cachedToken;
}

module.exports = { getAccessToken };
