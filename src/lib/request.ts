export type OcrProvider = 'tencent';

export interface OcrRequestBody {
  image: string;
  provider?: string;
}

export interface ValidatedOcrRequest {
  image: string;
  provider: OcrProvider;
}

export interface OcrRequestError {
  status: number;
  error: 'INVALID_JSON' | 'INVALID_IMAGE' | 'UNSUPPORTED_PROVIDER';
  message: string;
}

const DATA_URI_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/;
const RAW_BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidImagePayload(image: string): boolean {
  const value = image.trim();
  if (!value) return false;
  if (DATA_URI_RE.test(value)) return true;
  return RAW_BASE64_RE.test(value);
}

export function validateOcrRequest(body: unknown): ValidatedOcrRequest {
  if (!body || typeof body !== 'object') {
    throw createRequestError(400, 'INVALID_JSON', 'request body must be a JSON object');
  }

  const { image, provider } = body as OcrRequestBody;

  if (!isNonEmptyString(image) || !isValidImagePayload(image)) {
    throw createRequestError(400, 'INVALID_IMAGE', 'image must be a non-empty base64 string or data URL');
  }

  const normalizedProvider = typeof provider === 'string' && provider.trim()
    ? provider.trim().toLowerCase()
    : 'tencent';

  if (normalizedProvider !== 'tencent') {
    throw createRequestError(400, 'UNSUPPORTED_PROVIDER', 'provider must be tencent in MVP');
  }

  return {
    image: image.trim(),
    provider: 'tencent',
  };
}

export function createRequestError(status: number, error: OcrRequestError['error'], message: string): OcrRequestError {
  return { status, error, message };
}

export function isRequestError(error: unknown): error is OcrRequestError {
  return !!error && typeof error === 'object' && 'status' in error && 'error' in error && 'message' in error;
}
