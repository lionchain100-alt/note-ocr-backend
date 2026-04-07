export interface OcrBlock {
  type: 'line';
  text: string;
  bbox: [number, number, number, number];
  confidence: number;
}

export interface OcrSuccessResponse {
  text: string;
  markdown: string;
  blocks: OcrBlock[];
  raw: unknown;
}

export function blocksToText(blocks: OcrBlock[]): string {
  return blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n');
}

export function blocksToMarkdown(blocks: OcrBlock[]): string {
  const lines = blocks
    .map((block) => block.text.trim())
    .filter(Boolean);

  const parts: string[] = [];
  let previousWasList = false;

  for (const line of lines) {
    const isList = /^([-*•]|\d+[.)])\s+/.test(line);

    if (isList) {
      if (!previousWasList && parts.length > 0) {
        parts.push('');
      }
      parts.push(line.replace(/^([-*•]|\d+[.)])\s+/, '- '));
      previousWasList = true;
      continue;
    }

    if (previousWasList && parts.length > 0) {
      parts.push('');
    }

    parts.push(line);
    previousWasList = false;
  }

  return parts.join('\n').trim();
}

export function buildOcrSuccessResponse(args: {
  blocks: OcrBlock[];
  raw: unknown;
}): OcrSuccessResponse {
  const text = blocksToText(args.blocks);
  const markdown = blocksToMarkdown(args.blocks);

  return {
    text,
    markdown,
    blocks: args.blocks,
    raw: args.raw,
  };
}
