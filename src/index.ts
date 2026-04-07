import { tencentOcr } from './services/tencentOcr';
import { validateOcrRequest, isRequestError } from './lib/request';

export interface Env {
  TENCENT_SECRET_ID: string;
  TENCENT_SECRET_KEY: string;
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed' }, 405);
    }

    try {
      const body = await request.json();
      const { image } = validateOcrRequest(body);

      if (!env.TENCENT_SECRET_ID || !env.TENCENT_SECRET_KEY) {
        return jsonResponse({
          error: 'OCR_REQUEST_FAILED',
          message: 'Tencent credentials not configured',
        }, 500);
      }

      const result = await tencentOcr(image, {
        secretId: env.TENCENT_SECRET_ID,
        secretKey: env.TENCENT_SECRET_KEY,
        region: 'ap-beijing',
      });

      return jsonResponse(result);
    } catch (error: unknown) {
      console.error('OCR Error:', error);

      if (isRequestError(error)) {
        return jsonResponse({
          error: error.error,
          message: error.message,
        }, error.status);
      }

      if (error instanceof SyntaxError) {
        return jsonResponse({
          error: 'INVALID_JSON',
          message: 'request body must be valid JSON',
        }, 400);
      }

      return jsonResponse({
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown OCR processing error',
      }, 500);
    }
  },
};
