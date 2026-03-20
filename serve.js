// serve.js — local dev server for PWA testing
// Usage: node serve.js
// Then open: http://localhost:3000

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const axios  = require('axios');
require('dotenv').config();

const PORT   = 3000;
const PUBLIC = path.join(__dirname, 'public');

// ── 腾讯云密钥（从 .env 读取）────────────────────────────────────────────────
const SECRET_ID  = process.env.TENCENT_SECRET_ID;
const SECRET_KEY = process.env.TENCENT_SECRET_KEY;

if (!SECRET_ID || !SECRET_KEY) {
  console.error('❌ 错误：请在 .env 文件中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');
  process.exit(1);
}

// ── Usage counter ─────────────────────────────────────────────────────────────
const USAGE_FILE  = path.join(__dirname, 'usage.json');
const USAGE_LIMIT = 950;

let currentUsage = 0;
try {
  const raw = fs.readFileSync(USAGE_FILE, 'utf8');
  currentUsage = JSON.parse(raw).count || 0;
} catch (e) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify({ count: 0 }), 'utf8');
}
console.log(`[usage] current count: ${currentUsage}`);

// ── 腾讯云 OCR 请求（TC3-HMAC-SHA256）────────────────────────────────────────
async function tencentOcrRequest(imageBase64) {
  const service   = 'ocr';
  const host      = 'ocr.tencentcloudapi.com';
  const region    = 'ap-guangzhou';
  const action    = 'GeneralHandwritingOCR';
  const version   = '2018-11-19';
  const algorithm = 'TC3-HMAC-SHA256';
  const timestamp = Math.floor(Date.now() / 1000);
  const date      = new Date(timestamp * 1000).toISOString().slice(0, 10); // YYYY-MM-DD

  // 增强日志：验证 Base64 长度
  console.log(`[tencentOcr] Base64 length: ${imageBase64.length}`);
  console.log(`[tencentOcr] Base64 preview (first 50 chars): ${imageBase64.substring(0, 50)}`);
  console.log(`[tencentOcr] Base64 preview (last 20 chars): ${imageBase64.slice(-20)}`);

  // 检查是否包含 data URL 前缀（容错）
  if (imageBase64.startsWith('data:')) {
    console.warn('[tencentOcr] WARNING: Base64 contains data URL prefix, should be removed by frontend');
  }

  const payload = JSON.stringify({ ImageBase64: imageBase64 });
  console.log(`[tencentOcr] Payload preview (first 100 chars): ${payload.substring(0, 100)}...`);

  // Step 1: Canonical Request
  const hashedPayload    = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders    = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  // Step 2: String to Sign
  const credentialScope  = `${date}/${service}/tc3_request`;
  const hashedCanonical  = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign     = [algorithm, timestamp, credentialScope, hashedCanonical].join('\n');

  // Step 3: Derived signing key
  const hmac = (key, msg, enc) => crypto.createHmac('sha256', key).update(msg).digest(enc);
  const secretDate    = hmac(`TC3${SECRET_KEY}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature     = hmac(secretSigning, stringToSign, 'hex');

  // Step 4: Authorization header
  const authorization = `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await axios.post(`https://${host}`, payload, {
    headers: {
      'Content-Type':      'application/json',
      'Host':              host,
      'X-TC-Action':       action,
      'X-TC-Version':      version,
      'X-TC-Timestamp':    String(timestamp),
      'X-TC-Region':       region,
      'Authorization':     authorization,
    },
    timeout: 30000,
  });

  // 增强日志：打印完整返回
  console.log('[tencentOcr] Tencent response:', JSON.stringify(response.data, null, 2));

  return response.data;
}

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const server = http.createServer((req, res) => {
  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ── POST /api/ocr ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/ocr') {
    // ── 熔断检查 ───────────────────────────────────────────────────────────
    if (currentUsage >= USAGE_LIMIT) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: '服务器繁忙，请稍后再试' }));
    }
    // 先计数再处理，宁可错杀不可超支
    currentUsage += 1;
    fs.writeFileSync(USAGE_FILE, JSON.stringify({ count: currentUsage }), 'utf8');

    const MAX_BYTES = 10 * 1024 * 1024; // 10MB
    const chunks = [];
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: '文件太大，请先压缩后再上传！' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      try {
        const body  = JSON.parse(Buffer.concat(chunks).toString());
        const image = body.image || '';
        if (!image) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ error: '缺少 image 字段' }));
        }

        console.log(`[/api/ocr] calling tencent OCR, base64 length: ${image.length}`);
        const result = await tencentOcrRequest(image);

        const detections = result?.Response?.TextDetections || [];
        const text = detections.map(d => d.DetectedText).join('\n');

        // 如果识别结果为空，返回完整原始数据便于调试
        if (!text && detections.length === 0) {
          console.log('[/api/ocr] Empty detection result, returning raw response');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({
            status: 'success',
            text: '',
            rawResponse: result,
            debug: {
              base64Length: image.length,
              base64Prefix: image.substring(0, 50),
              hasDataUrlPrefix: image.startsWith('data:'),
            }
          }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'success', text }));
      } catch (e) {
        console.error('[/api/ocr] OCR error:', e.message);
        const status = e.response ? 500 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: e.message || 'OCR 调用失败' }));
      }
    });

    req.on('error', (err) => {
      console.error('[/api/ocr] error:', err.message);
    });

    return;
  }

  // ── Static file serving ───────────────────────────────────────────────────
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC, urlPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for unknown routes
      fs.readFile(path.join(PUBLIC, 'index.html'), (err2, fallback) => {
        if (err2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, {
          'Content-Type': 'text/html',
          // Required for SW to work on localhost
          'Service-Worker-Allowed': '/',
        });
        res.end(fallback);
      });
      return;
    }

    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mime,
      // SW scope header
      ...(ext === '.js' && urlPath.includes('sw') ? { 'Service-Worker-Allowed': '/' } : {}),
      // Basic cache headers
      'Cache-Control': urlPath === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ PWA dev server running at http://localhost:${PORT}`);
  console.log(`   Open Chrome → http://localhost:${PORT}`);
  console.log(`   DevTools → Application → Service Workers to verify SW\n`);
});
