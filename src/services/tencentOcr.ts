/**
 * Tencent Cloud OCR Service
 * 
 * Uses GeneralHandwritingOCR for handwritten text recognition
 * with spatial text reconstruction (coordinate-based sorting).
 */

// Tencent Cloud SDK uses signature-based auth, not simple API key
// We'll use their HTTP API directly for Cloudflare Worker compatibility

interface TencentOcrConfig {
  secretId: string;
  secretKey: string;
  region?: string;
}

interface ItemPolygon {
  X: number;
  Y: number;
  Width: number;
  Height: number;
}

interface TextDetection {
  DetectedText: string;
  Confidence: number;
  ItemPolygon: ItemPolygon;
}

interface TencentOcrResponse {
  TextDetections?: TextDetection[];
  Language?: string;
  RequestId?: string;
}

/**
 * Strip Base64 data URI prefix if present
 */
function stripBase64Prefix(base64String: string): string {
  if (!base64String) return '';
  const matches = base64String.match(/^data:image\/\w+;base64,(.+)$/);
  return matches ? matches[1] : base64String;
}

/**
 * Generate Tencent Cloud API signature
 * Uses TC3-HMAC-SHA256 signature method
 */
async function generateSignature(
  secretId: string,
  secretKey: string,
  service: string,
  host: string,
  action: string,
  version: string,
  timestamp: number,
  payload: string
): Promise<{ authorization: string; date: string }> {
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];
  
  // Step 1: Create canonical request
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  
  const payloadHash = await sha256(payload);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  
  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // Step 2: Create string to sign
  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = await sha256(canonicalRequest);
  const stringToSign = [
    algorithm,
    timestamp.toString(),
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  // Step 3: Calculate signature
  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);

  // Step 4: Create authorization header
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, date };
}

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  return crypto.subtle.sign('HMAC', cryptoKey, messageData);
}

async function hmacSha256Hex(key: ArrayBuffer, message: string): Promise<string> {
  const signature = await hmacSha256(key, message);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Spatial Text Reconstruction Algorithm
 * 
 * Sorts OCR text blocks by their spatial coordinates to reconstruct
 * the original reading order (top-to-bottom, left-to-right).
 */
function reconstructTextLayout(
  textDetections: TextDetection[],
  yThreshold: number = 25
): string {
  if (!textDetections || textDetections.length === 0) {
    return '';
  }

  // Step 1: Sort all blocks by Y coordinate (top to bottom)
  const sortedByY = [...textDetections].sort((a, b) => {
    const yA = a.ItemPolygon?.Y || 0;
    const yB = b.ItemPolygon?.Y || 0;
    return yA - yB;
  });

  // Step 2: Group blocks into rows based on Y coordinate proximity
  const rows: TextDetection[][] = [];
  let currentRow: TextDetection[] = [sortedByY[0]];
  let currentRowY = sortedByY[0].ItemPolygon?.Y || 0;

  for (let i = 1; i < sortedByY.length; i++) {
    const block = sortedByY[i];
    const blockY = block.ItemPolygon?.Y || 0;

    // If Y difference is within threshold, same row
    if (Math.abs(blockY - currentRowY) < yThreshold) {
      currentRow.push(block);
    } else {
      // Start new row
      rows.push(currentRow);
      currentRow = [block];
      currentRowY = blockY;
    }
  }
  // Don't forget the last row
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  // Step 3: Within each row, sort by X coordinate (left to right)
  const sortedRows = rows.map((row) => {
    return row.sort((a, b) => {
      const xA = a.ItemPolygon?.X || 0;
      const xB = b.ItemPolygon?.X || 0;
      return xA - xB;
    });
  });

  // Step 4: Concatenate blocks within rows (two spaces), rows with newlines
  const reconstructedText = sortedRows
    .map((row) =>
      row
        .map((block) => block.DetectedText || '')
        .join('  ')
    )
    .join('\n');

  return reconstructedText;
}

/**
 * Call Tencent Cloud GeneralHandwritingOCR API
 */
export async function tencentOcr(
  imageBase64: string,
  config: TencentOcrConfig
): Promise<{ text: string; raw: TencentOcrResponse }> {
  const cleanBase64 = stripBase64Prefix(imageBase64);
  
  const host = 'ocr.tencentcloudapi.com';
  const service = 'ocr';
  const action = 'GeneralHandwritingOCR';
  const version = '2018-11-19';
  const timestamp = Math.floor(Date.now() / 1000);
  const region = config.region || 'ap-beijing';

  const payload = JSON.stringify({
    ImageBase64: cleanBase64,
  });

  const { authorization } = await generateSignature(
    config.secretId,
    config.secretKey,
    service,
    host,
    action,
    version,
    timestamp,
    payload
  );

  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': timestamp.toString(),
      'X-TC-Region': region,
      'Authorization': authorization,
    },
    body: payload,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tencent OCR API error: ${response.status} ${errorText}`);
  }

  const result = await response.json() as {
    Response: TencentOcrResponse & { Error?: { Code: string; Message: string } };
  };

  if (result.Response.Error) {
    throw new Error(
      `Tencent OCR error: ${result.Response.Error.Code} - ${result.Response.Error.Message}`
    );
  }

  const textDetections = result.Response.TextDetections || [];
  const reconstructedText = reconstructTextLayout(textDetections);

  return {
    text: reconstructedText,
    raw: result.Response,
  };
}
