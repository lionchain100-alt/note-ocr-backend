import { processOcrToMarkdown } from './processOcrToMarkdown';
import { tencentOcr } from './services/tencentOcr';

export interface Env {
  GOOGLE_API_KEY: string;
  TENCENT_SECRET_ID: string;
  TENCENT_SECRET_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let body: { 
      image: string; 
      provider?: 'google' | 'tencent';
    };
    
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON body', { status: 400 });
    }

    if (!body.image) {
      return new Response('Missing "image" field (base64 encoded)', { status: 400 });
    }

    const provider = body.provider || 'google';

    try {
      let markdown = '';
      let raw: any;

      if (provider === 'tencent') {
        // Tencent Cloud OCR
        if (!env.TENCENT_SECRET_ID || !env.TENCENT_SECRET_KEY) {
          return new Response(
            JSON.stringify({ error: 'Tencent credentials not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const result = await tencentOcr(body.image, {
          secretId: env.TENCENT_SECRET_ID,
          secretKey: env.TENCENT_SECRET_KEY,
          region: 'ap-beijing',
        });

        markdown = result.text;
        raw = result.raw;
      } else {
        // Google Cloud Vision OCR (default)
        if (!env.GOOGLE_API_KEY) {
          return new Response(
            JSON.stringify({ error: 'Google API key not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_API_KEY}`;

        const visionPayload = {
          requests: [
            {
              image: {
                content: body.image,
              },
              features: [
                {
                  type: 'DOCUMENT_TEXT_DETECTION',
                },
              ],
            },
          ],
        };

        const visionResponse = await fetch(visionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(visionPayload),
        });

        raw = await visionResponse.json();

        if (visionResponse.ok) {
          markdown = processOcrToMarkdown(raw as any);
        }
      }

      return new Response(JSON.stringify({ markdown, raw }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error: any) {
      console.error('OCR Error:', error);
      return new Response(
        JSON.stringify({
          error: 'OCR processing failed',
          message: error.message,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  },
};
