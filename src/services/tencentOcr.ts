/**
 * Tencent Cloud OCR Service
 *
 * Uses GeneralHandwritingOCR for handwritten text recognition
 * with spatial text reconstruction (coordinate-based sorting).
 */

import { buildOcrSuccessResponse, type OcrSuccessResponse } from '../lib/ocr-response';
import { toBlocks } from '../lib/sort-text-detections';

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

function stripBase64Prefix(base64String: string): string {
  if (!base64String) return '';
  const matches = base64String.match(/^data:image\/\w+;base64,(.+)$/);
  return matches ? matches[1] : base64String;
}

async function generateSignature(
  secretId: string,
  secretKey: string,
  service: string,
  host: string,
  action: string,
  version: string,
  timestamp: number,
  payload: string,
): Promise<{ authorization: string; date: string }> {
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];
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

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = await sha256(canonicalRequest);
  const stringToSign = [algorithm, timestamp.toString(), credentialScope, hashedCanonicalRequest].join('\n');

  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, date };
}

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, messageData);
}

async function hmacSha256Hex(key: ArrayBuffer, message: string): Promise<string> {
  const signature = await hmacSha256(key, message);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function tencentOcr(
  imageBase64: string,
  config: TencentOcrConfig,
): Promise<OcrSuccessResponse> {
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
    payload,
  );

  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': timestamp.toString(),
      'X-TC-Region': region,
      Authorization: authorization,
    },
    body: payload,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tencent OCR API error: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as {
    Response: TencentOcrResponse & { Error?: { Code: string; Message: string } };
  };

  if (result.Response.Error) {
    throw new Error(`Tencent OCR error: ${result.Response.Error.Code} - ${result.Response.Error.Message}`);
  }

  const blocks = toBlocks(result.Response.TextDetections || []);
  return buildOcrSuccessResponse({
    blocks,
    raw: result.Response,
  });
}
