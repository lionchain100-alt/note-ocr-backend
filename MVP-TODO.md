# note-ocr-backend MVP 开发清单 v1

> 规则：后续开发严格按本清单推进。每完成一个目标，必须更新本文件状态，不额外扩展范围。

---

## 项目目标

围绕以下主线交付 MVP：

- 手写笔记识别
- 手机端、网页端都能调用
- 支持上传图片、拍照后上传图片识别
- 识别结果尽量保持原手写笔记排版
- 输出 `text + markdown + blocks + raw`

---

## 状态说明

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成
- `[-]` 不纳入 MVP

---

## P0-1 统一 `POST /ocr` 请求协议
**目标：** 固定请求结构，保证前后端对接稳定。

**要求：**
- [x] 明确请求体 schema
- [x] `image` 为必填
- [x] `provider` 默认为 `tencent`
- [x] 支持 Base64 图片输入
- [x] 明确非法参数校验

**交付物：**
- 请求协议文档
- 服务端参数校验逻辑

**当前状态：** [x]
**完成时间：** 2026-03-24
**备注：**
- 新增 `src/lib/request.ts`，统一请求校验逻辑
- 已统一 `server.js` / `server-express.ts` / `src/index.ts` 的默认 provider 为 `tencent`
- 已实现 `image` 必填、Base64/data URL 校验、非法 provider 拦截
- 已验证 `npm run type-check` 通过
- 已用 Node 验证合法请求与非法请求分支

---

## P0-2 统一 `POST /ocr` 响应协议
**目标：** 固定返回结构，避免前端反复适配。

**要求：**
- [x] 成功响应统一为 `text + markdown + blocks + raw`
- [x] 字段结构固定
- [x] 不因 provider 不同而改变字段形态

**交付物：**
- 响应协议文档
- 服务端统一返回逻辑

**当前状态：** [x]
**完成时间：** 2026-03-24
**备注：**
- 新增 `src/lib/ocr-response.ts`，统一成功响应结构
- 已改 `src/services/tencentOcr.ts`，直接输出 `text + markdown + blocks + raw`
- 已改 `server.js`，接入统一成功响应
- 已验证 `npm run type-check` 通过
- 已用 Node 验证统一响应样例输出

---

## P0-3 `blocks` 输出落地
**目标：** 为“排版接近原笔记”提供结构化基础。

**要求：**
- [x] 定义 `blocks` schema
- [x] 每条有效识别文本有对应 block
- [x] block 顺序与阅读顺序一致
- [x] 保留 `bbox`

**交付物：**
- blocks schema
- 服务端 blocks 输出实现

**当前状态：** [x]
**完成时间：** 2026-03-24
**备注：**
- `blocks` schema 已锁定为 `type + text + bbox + confidence`
- 已由 `src/services/tencentOcr.ts` 输出 blocks，并按 Y/X 顺序排序
- 已确认 `server-express.ts` / `src/index.ts` 主路径直接返回统一 result
- 已验证主路径包含 `tencentOcr(image)` 与统一返回逻辑
- 已验证 `npm run type-check` 通过

---

## P0-4 坐标排序算法收口
**目标：** 让排序逻辑可验收、可调参、输出稳定。

**要求：**
- [x] 明确排序输入输出
- [x] 固定基础阈值策略
- [x] 对至少 3 类样例验证稳定性
- [x] 输出顺序稳定一致

**交付物：**
- 排序规则说明
- 排序实现调整
- 最小验证样例记录

**当前状态：** [x]
**完成时间：** 2026-03-24
**备注：**
- 新增 `src/lib/sort-text-detections.ts`，导出 `sortTextDetections` / `toBlocks` / `DEFAULT_Y_THRESHOLD`
- 已从 `src/services/tencentOcr.ts` 抽离排序与 blocks 转换逻辑
- 固定基础阈值策略：`DEFAULT_Y_THRESHOLD = 25`
- 已用最小样例验证输出顺序：`第一,第二,第三,第四`
- 已验证 blocks 顺序与 bbox 输出正确
- 已验证 `npm run type-check` 通过

---

## P0-5 Markdown 输出规范落地
**目标：** 让 `markdown` 真正体现笔记结构，而不是纯文本拼接。

**要求：**
- [x] 保留换行
- [x] 支持基础段落结构
- [x] 支持简单列表候选
- [x] 与原笔记结构尽量一致

**交付物：**
- Markdown 输出规则说明
- 服务端 markdown 输出实现

**当前状态：** [x]
**完成时间：** 2026-03-24
**备注：**
- 已改 `src/lib/ocr-response.ts` 的 `blocksToMarkdown`
- 当前规则支持逐行输出、列表归一化（`*` / `•` / `数字.` → `- `）、段落与列表间空行
- 已用 Node 验证 markdown 输出样例
- 已验证 `npm run type-check` 通过

---

## P0-6 统一错误返回规范
**目标：** 错误路径稳定，便于前端处理。

**要求：**
- [x] 统一错误响应格式
- [x] 至少支持以下错误码：
  - `INVALID_IMAGE`
  - `UNSUPPORTED_PROVIDER`
  - `OCR_REQUEST_FAILED`
  - `INTERNAL_ERROR`
- [x] 合理 HTTP 状态码

**交付物：**
- 错误码文档
- 服务端统一错误处理

**当前状态：** [x]
**完成时间：** 2026-03-24
**备注：**
- 已确认请求校验层统一产出：`INVALID_JSON` / `INVALID_IMAGE` / `UNSUPPORTED_PROVIDER`
- 已确认服务层统一产出：`OCR_REQUEST_FAILED` / `INTERNAL_ERROR`
- 已确认 `server.js` / `server-express.ts` / `src/index.ts` 都保留统一错误结构 `{ error, message }`
- 已确认 Worker 对非法 JSON 返回 400，其他错误路径返回统一错误体
- 已用 Node 检查关键错误码分布

---

## P0-7 手机端 / 网页端输入联调
**目标：** 验证同一个后端接口能被不同前端形态稳定调用。

**要求：**
- [ ] 网页上传图片可识别
- [ ] 手机上传图片可识别
- [ ] 手机拍照后上传可识别
- [ ] 网页摄像头拍照后上传可识别

**交付物：**
- 联调验证记录
- 输入兼容问题修复

**当前状态：** [~]
**完成时间：**
**备注：**
- 下一步进入联调准备，需要真实手写样例图

---

## P0-8 Express 部署稳定化
**目标：** MVP 阶段只保证 Express 主路径稳定。

**要求：**
- [ ] `/health` 可用
- [ ] `/ocr` 稳定
- [ ] 基础日志可查看
- [ ] 服务异常不直接崩溃

**交付物：**
- Express 稳定运行版本
- 最小部署说明

**当前状态：** [ ]
**完成时间：**
**备注：**

---

## P0-9 安全阻断项处理
**目标：** 解决上线前必须处理的安全问题。

**要求：**
- [ ] 轮换腾讯云密钥
- [ ] 清理 `.env` 泄露风险
- [ ] 确认仓库中不再暴露有效密钥

**交付物：**
- 新密钥配置完成
- 安全整改记录

**当前状态：** [ ]
**完成时间：**
**备注：**

---

## P1（MVP 之后，不提前做）

- [-] Google Vision 正式接入
- [-] Cloudflare Worker 作为主部署路径
- [-] Notion 集成
- [-] 批量处理
- [-] Redis 缓存
- [-] 用户认证
- [-] 使用统计
- [-] 图片增强 / 旋转 / 裁剪

---

## 开发顺序

1. P0-1 请求协议
2. P0-2 响应协议
3. P0-3 blocks 输出
4. P0-4 坐标排序算法收口
5. P0-5 Markdown 输出
6. P0-6 错误返回规范
7. P0-7 多端联调
8. P0-8 Express 稳定化
9. P0-9 安全整改

---

## 更新模板

每完成一个目标后，按以下格式更新对应条目：

```md
**当前状态：** [x]
**完成时间：** 2026-03-24
**备注：**
- 完成了什么
- 改了哪些文件
- 验证结果是什么
```

如果任务进行中：

```md
**当前状态：** [~]
**完成时间：**
**备注：**
- 当前做到哪一步
- 卡点是什么
```

---

## 当前总进度

- P0 已完成：6 / 9
- P0 进行中：1 / 9
- P0 未开始：2 / 9

## 当前结论

P0-1、P0-2、P0-3、P0-4、P0-5、P0-6 已完成，P0-7 正在实现中。后续默认按本清单逐项实现，每完成一项立刻更新本文件。
