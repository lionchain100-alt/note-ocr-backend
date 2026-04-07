const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { tencentOcr } = require('./src/services/tencentOcr');
const { validateOcrRequest, isRequestError } = require('./src/lib/request');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.post('/ocr', async (req, res) => {
  try {
    const { image } = validateOcrRequest(req.body);

    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;

    if (!secretId || !secretKey) {
      return res.status(500).json({
        error: 'OCR_REQUEST_FAILED',
        message: 'Tencent credentials not configured',
      });
    }

    const result = await tencentOcr(image, {
      secretId,
      secretKey,
      region: 'ap-beijing',
    });

    return res.json(result);
  } catch (error) {
    console.error('OCR Error:', error);

    if (isRequestError(error)) {
      return res.status(error.status).json({
        error: error.error,
        message: error.message,
      });
    }

    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown OCR processing error',
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, HOST, () => {
  console.log(`OCR Service running on http://${HOST}:${PORT}`);
});
