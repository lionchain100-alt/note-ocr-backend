# note-ocr-backend

Cloudflare Worker，支持 Google Cloud Vision 和 腾讯云 OCR 双引擎。

## 功能

- 接收 POST 请求，body 包含 base64 编码的图片
- 支持两种 OCR 引擎：
  - **Google Vision** (`DOCUMENT_TEXT_DETECTION`) - 适合印刷体
  - **腾讯云 OCR** (`GeneralHandwritingOCR`) - 适合手写体，带坐标排序
- 返回 Markdown 格式的识别结果 + 原始 API 响应

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API 密钥

**Google Vision (可选):**
```bash
wrangler secret put GOOGLE_API_KEY
```

**腾讯云 OCR (可选):**
```bash
wrangler secret put TENCENT_SECRET_ID
wrangler secret put TENCENT_SECRET_KEY
```

### 3. 本地开发

```bash
npm run dev
```

### 4. 部署

```bash
npm run deploy
```

## API 使用

**POST /**

### Google Vision (默认)

Request body:
```json
{
  "image": "<base64 encoded image string>"
}
```

### 腾讯云 OCR

Request body:
```json
{
  "image": "<base64 encoded image string>",
  "provider": "tencent"
}
```

### Response

```json
{
  "markdown": "# 识别结果\n\n按阅读顺序排列的文本...",
  "raw": { /* 原始 API 响应 */ }
}
```

## 腾讯云 OCR 坐标排序算法

腾讯云 OCR 返回的文字块是无序的，我们实现了空间重建算法：

1. **垂直分组**: 按 Y 坐标排序，Y 差值 < 25px 的块分到同一行
2. **水平排序**: 每行内按 X 坐标排序（从左到右）
3. **拼接**: 行内用双空格连接，行间用换行连接

这样可以将零散的文字块重建成自然的阅读顺序。

## 注意事项

- API 密钥通过 Wrangler secret 注入，不要硬编码
- 支持 CORS（`Access-Control-Allow-Origin: *`）
- 仅支持 POST 方法
- `provider` 参数可选，默认为 `google`
