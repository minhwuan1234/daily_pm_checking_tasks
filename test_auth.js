// File test độc lập - không depend vào bất kỳ file nào khác
// Chạy trực tiếp để verify token
const https = require('https');

const APP_ID       = process.env.LARK_APP_ID;
const APP_SECRET   = process.env.LARK_APP_SECRET;
const REFRESH_TOKEN = process.env.LARK_REFRESH_TOKEN;

console.log('=== ENV CHECK ===');
console.log('APP_ID:        ', APP_ID ? APP_ID.slice(0,15)+'...' : 'MISSING');
console.log('APP_SECRET:    ', APP_SECRET ? APP_SECRET.slice(0,10)+'...' : 'MISSING');
console.log('REFRESH_TOKEN: ', REFRESH_TOKEN ? REFRESH_TOKEN.slice(0,15)+'...' : 'MISSING');
console.log('');

if (!REFRESH_TOKEN) {
  console.error('REFRESH_TOKEN missing - check GitHub Secrets');
  process.exit(1);
}

// Step 1: Thử refresh user token
console.log('=== STEP 1: Refresh user access token ===');
const body1 = JSON.stringify({
  grant_type:    'refresh_token',
  refresh_token: REFRESH_TOKEN,
  app_id:        APP_ID,
  app_secret:    APP_SECRET,
});

const req1 = https.request({
  hostname: 'open.larksuite.com',
  path:     '/open-apis/authen/v1/refresh_access_token',
  method:   'POST',
  headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body1) },
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Raw response:', data);
    const json = JSON.parse(data);
    console.log('Code:', json.code);

    if (json.code !== 0) {
      console.error('FAILED - refresh token invalid, chạy lại authorize.cjs');
      // Step 2: Thử tenant token thay thế
      console.log('\n=== STEP 2: Thử tenant token ===');
      const body2 = JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET });
      const req2 = https.request({
        hostname: 'open.larksuite.com',
        path:     '/open-apis/auth/v3/tenant_access_token/internal',
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body2) },
      }, res2 => {
        let d = '';
        res2.on('data', c => d += c);
        res2.on('end', () => {
          const j = JSON.parse(d);
          console.log('Tenant token code:', j.code);
          console.log('Tenant token prefix:', j.tenant_access_token?.slice(0,15));

          // Step 3: Test gọi task API với tenant token
          console.log('\n=== STEP 3: Test task API với tenant token ===');
          const tToken = j.tenant_access_token;
          const req3 = https.request({
            hostname: 'open.larksuite.com',
            path:     '/open-apis/task/v2/tasks?page_size=5',
            method:   'GET',
            headers:  { 'Authorization': `Bearer ${tToken}` },
          }, res3 => {
            let d3 = '';
            res3.on('data', c => d3 += c);
            res3.on('end', () => {
              const j3 = JSON.parse(d3);
              console.log('Task API code:', j3.code);
              console.log('Task API msg:', j3.msg);
              console.log('Tasks found:', j3.data?.items?.length ?? 0);
              if (j3.data?.items?.length > 0) {
                j3.data.items.slice(0,3).forEach(t => console.log(' -', t.summary));
              }
            });
          });
          req3.end();
        });
      });
      req2.write(body2);
      req2.end();
      return;
    }

    const userToken = json.data?.access_token;
    console.log('User token prefix:', userToken?.slice(0,15));

    // Test task API với user token
    console.log('\n=== STEP 2: Test task API với user token ===');
    const req2 = https.request({
      hostname: 'open.larksuite.com',
      path:     '/open-apis/task/v2/tasks?page_size=5',
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${userToken}` },
    }, res2 => {
      let d = '';
      res2.on('data', c => d += c);
      res2.on('end', () => {
        const j = JSON.parse(d);
        console.log('Task API code:', j.code);
        console.log('Task API msg:', j.msg);
        console.log('Tasks found:', j.data?.items?.length ?? 0);
        if (j.data?.items?.length > 0) {
          j.data.items.slice(0,3).forEach(t => console.log(' -', t.summary));
        }
      });
    });
    req2.end();
  });
});
req1.write(body1);
req1.end();
