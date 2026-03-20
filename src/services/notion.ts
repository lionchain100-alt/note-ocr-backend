/**
 * src/services/notion.ts
 *
 * Parses Markdown → Notion Block objects, then creates a new child page
 * under the specified pageId via the Notion API.
 *
 * Supported Markdown:
 *   # H1  →  heading_1
 *   ## H2 →  heading_2
 *   ### H3→  heading_3
 *   - item / * item / 1. item  →  bulleted_list_item / numbered_list_item
 *   > quote  →  quote
 *   plain text  →  paragraph
 *   <mark class="low-confidence">word</mark>  →  orange highlight span
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ─── Notion block types (minimal subset) ─────────────────────────────────────

interface RichText {
  type: 'text';
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
  };
}

interface HeadingBlock {
  object: 'block';
  type: 'heading_1' | 'heading_2' | 'heading_3';
  heading_1?: { rich_text: RichText[] };
  heading_2?: { rich_text: RichText[] };
  heading_3?: { rich_text: RichText[] };
}

interface ParagraphBlock {
  object: 'block';
  type: 'paragraph';
  paragraph: { rich_text: RichText[] };
}

interface BulletedListBlock {
  object: 'block';
  type: 'bulleted_list_item';
  bulleted_list_item: { rich_text: RichText[] };
}

interface NumberedListBlock {
  object: 'block';
  type: 'numbered_list_item';
  numbered_list_item: { rich_text: RichText[] };
}

interface QuoteBlock {
  object: 'block';
  type: 'quote';
  quote: { rich_text: RichText[] };
}

type NotionBlock =
  | HeadingBlock
  | ParagraphBlock
  | BulletedListBlock
  | NumberedListBlock
  | QuoteBlock;

// ─── Error type ───────────────────────────────────────────────────────────────

export class NotionApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(`Notion API error [${status}] ${code}: ${message}`);
    this.name = 'NotionApiError';
  }
}

// ─── Rich text parser ─────────────────────────────────────────────────────────
// Handles <mark class="low-confidence">text</mark> → orange highlight

function parseRichText(raw: string): RichText[] {
  const parts: RichText[] = [];
  // Split on <mark ...>...</mark> tags
  const segments = raw.split(/(<mark[^>]*>.*?<\/mark>)/g);

  for (const seg of segments) {
    if (!seg) continue;

    const markMatch = seg.match(/^<mark[^>]*>(.*?)<\/mark>$/);
    if (markMatch) {
      parts.push({
        type: 'text',
        text: { content: markMatch[1], link: null },
        annotations: { color: 'orange' },
      });
    } else {
      // Plain text — split on **bold** and *italic* for basic formatting
      const inline = seg.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
      for (const chunk of inline) {
        if (!chunk) continue;
        const boldMatch   = chunk.match(/^\*\*(.+)\*\*$/);
        const italicMatch = chunk.match(/^\*(.+)\*$/);
        if (boldMatch) {
          parts.push({ type: 'text', text: { content: boldMatch[1], link: null }, annotations: { bold: true } });
        } else if (italicMatch) {
          parts.push({ type: 'text', text: { content: italicMatch[1], link: null }, annotations: { italic: true } });
        } else {
          parts.push({ type: 'text', text: { content: chunk, link: null } });
        }
      }
    }
  }

  return parts.length ? parts : [{ type: 'text', text: { content: '', link: null } }];
}

// ─── Markdown → Notion blocks ─────────────────────────────────────────────────

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const lines = markdown.split('\n');
  const blocks: NotionBlock[] = [];

  for (const raw of lines) {
    const line = raw; // preserve leading spaces for indent detection

    // Blank line → skip (Notion handles spacing automatically)
    if (!line.trim()) continue;

    // H1
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: parseRichText(h1[1]) } });
      continue;
    }

    // H2
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: parseRichText(h2[1]) } });
      continue;
    }

    // H3
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: parseRichText(h3[1]) } });
      continue;
    }

    // Blockquote / margin note
    const quote = line.match(/^>\s*(.+)$/);
    if (quote) {
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: parseRichText(quote[1]) } });
      continue;
    }

    // Numbered list: "1. " / "2) "
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: parseRichText(numbered[1]) } });
      continue;
    }

    // Bulleted list: "- " / "* " / "• "
    const bulleted = line.match(/^[-*•]\s+(.+)$/);
    if (bulleted) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseRichText(bulleted[1]) } });
      continue;
    }

    // Paragraph (default)
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseRichText(line.trim()) } });
  }

  return blocks;
}

// ─── Notion API call ──────────────────────────────────────────────────────────

interface SendToNotionOptions {
  title?: string;  // page title, defaults to "OCR Note"
}

export async function sendToNotion(
  token: string,
  pageId: string,
  markdown: string,
  options: SendToNotionOptions = {},
): Promise<{ url: string; id: string }> {
  const blocks = markdownToNotionBlocks(markdown);
  const title = options.title ?? 'OCR Note';

  // Notion limits: max 100 blocks per request
  const CHUNK_SIZE = 100;

  // Step 1: Create the page
  const createRes = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { page_id: pageId },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: title } }],
        },
      },
      // Send first chunk of blocks inline with page creation
      children: blocks.slice(0, CHUNK_SIZE),
    }),
  });

  await assertNotionOk(createRes);
  const page = await createRes.json() as { id: string; url: string };

  // Step 2: Append remaining blocks in chunks
  for (let i = CHUNK_SIZE; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    const appendRes = await fetch(`${NOTION_API}/blocks/${page.id}/children`, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ children: chunk }),
    });
    await assertNotionOk(appendRes);
  }

  return { id: page.id, url: page.url };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function notionHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  };
}

async function assertNotionOk(res: Response): Promise<void> {
  if (res.ok) return;

  let code = 'unknown_error';
  let message = res.statusText;

  try {
    const body = await res.json() as { code?: string; message?: string };
    code    = body.code    ?? code;
    message = body.message ?? message;
  } catch {
    // non-JSON error body, keep defaults
  }

  throw new NotionApiError(res.status, code, message);
}
