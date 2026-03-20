/**
 * processOcrToMarkdown
 *
 * Converts Google Vision API fullTextAnnotation JSON into formatted Markdown.
 *
 * Strategy:
 * 1. Extract all words + bounding boxes from the response
 * 2. Cluster words into lines using vertical proximity (DBSCAN-like)
 * 3. Classify each line: Heading / List Item / Paragraph
 * 4. Render Markdown
 */

interface Vertex {
  x: number;
  y: number;
}

interface BoundingPoly {
  vertices: Vertex[];
}

interface Word {
  symbols: Array<{ text: string }>;
  boundingBox: BoundingPoly;
}

interface Paragraph {
  words: Word[];
}

interface Block {
  paragraphs: Paragraph[];
}

interface Page {
  blocks: Block[];
}

interface FullTextAnnotation {
  pages: Page[];
}

interface VisionResponse {
  responses: Array<{
    fullTextAnnotation?: FullTextAnnotation;
  }>;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface WordToken {
  text: string;
  left: number;   // min x
  right: number;  // max x
  top: number;    // min y
  bottom: number; // max y
  height: number; // bottom - top
  midY: number;   // vertical center
}

interface Line {
  words: WordToken[];
  top: number;
  bottom: number;
  height: number;  // average word height
  left: number;    // leftmost x
  text: string;
}

// ─── Step 1: Extract words ────────────────────────────────────────────────────

function extractWords(data: VisionResponse): WordToken[] {
  const tokens: WordToken[] = [];

  const pages = data.responses?.[0]?.fullTextAnnotation?.pages ?? [];

  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const verts = word.boundingBox?.vertices ?? [];
          if (verts.length < 4) continue;

          const xs = verts.map((v) => v.x ?? 0);
          const ys = verts.map((v) => v.y ?? 0);

          const left = Math.min(...xs);
          const right = Math.max(...xs);
          const top = Math.min(...ys);
          const bottom = Math.max(...ys);
          const height = bottom - top;
          const midY = (top + bottom) / 2;

          const text = word.symbols.map((s) => s.text).join('');

          tokens.push({ text, left, right, top, bottom, height, midY });
        }
      }
    }
  }

  // Sort top-to-bottom, left-to-right
  tokens.sort((a, b) => a.midY - b.midY || a.left - b.left);

  return tokens;
}

// ─── Step 2: Cluster into lines (DBSCAN-like vertical grouping) ───────────────

function clusterIntoLines(words: WordToken[]): Line[] {
  if (words.length === 0) return [];

  const lines: WordToken[][] = [];
  let currentLine: WordToken[] = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const prev = currentLine[currentLine.length - 1];
    const curr = words[i];

    // Gap threshold: use the taller word's height as the epsilon
    const epsilon = Math.max(prev.height, curr.height) * 0.6;
    const verticalGap = Math.abs(curr.midY - prev.midY);

    if (verticalGap <= epsilon) {
      currentLine.push(curr);
    } else {
      lines.push(currentLine);
      currentLine = [curr];
    }
  }
  lines.push(currentLine);

  // Build Line objects
  return lines.map((wordGroup) => {
    // Sort left-to-right within each line
    wordGroup.sort((a, b) => a.left - b.left);

    const top = Math.min(...wordGroup.map((w) => w.top));
    const bottom = Math.max(...wordGroup.map((w) => w.bottom));
    const avgHeight = wordGroup.reduce((s, w) => s + w.height, 0) / wordGroup.length;
    const left = wordGroup[0].left;

    // Join words; add space unless next word starts with punctuation
    let text = wordGroup[0].text;
    for (let i = 1; i < wordGroup.length; i++) {
      const next = wordGroup[i].text;
      const needsSpace = !/^[.,!?;:'")\]}-]/.test(next);
      text += (needsSpace ? ' ' : '') + next;
    }

    return { words: wordGroup, top, bottom, height: avgHeight, left, text };
  });
}

// ─── Step 3: Classify lines ───────────────────────────────────────────────────

type LineType = 'heading1' | 'heading2' | 'list' | 'paragraph';

interface ClassifiedLine {
  type: LineType;
  text: string;
  indent: number; // list indent level (0 = top-level)
}

function classifyLines(lines: Line[]): ClassifiedLine[] {
  if (lines.length === 0) return [];

  // Compute median line height to detect headings
  const heights = lines.map((l) => l.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)];

  // Compute leftmost x across all lines (page margin)
  const pageLeft = Math.min(...lines.map((l) => l.left));

  return lines.map((line): ClassifiedLine => {
    const { text, height, left } = line;
    const trimmed = text.trim();

    // Heading detection: significantly taller than median
    if (height > medianHeight * 1.6) {
      return { type: 'heading1', text: trimmed, indent: 0 };
    }
    if (height > medianHeight * 1.25) {
      return { type: 'heading2', text: trimmed, indent: 0 };
    }

    // List item detection: starts with bullet/dash/number OR indented
    const listPrefixRe = /^[-•*·▪▸>]\s+|^\d+[.)]\s+/;
    const xOffset = left - pageLeft;
    const isIndented = xOffset > medianHeight * 1.5; // indented by ~1.5 char widths
    const hasListPrefix = listPrefixRe.test(trimmed);

    if (hasListPrefix || isIndented) {
      // Normalize prefix to '-'
      const cleanText = trimmed.replace(listPrefixRe, '');
      const indentLevel = Math.floor(xOffset / (medianHeight * 3)); // rough indent level
      return { type: 'list', text: cleanText, indent: indentLevel };
    }

    return { type: 'paragraph', text: trimmed, indent: 0 };
  });
}

// ─── Step 4: Render Markdown ──────────────────────────────────────────────────

function renderMarkdown(classified: ClassifiedLine[]): string {
  const parts: string[] = [];
  let prevType: LineType | null = null;

  for (const line of classified) {
    if (!line.text) continue;

    const { type, text, indent } = line;
    const indentStr = '  '.repeat(indent);

    switch (type) {
      case 'heading1':
        if (prevType !== null) parts.push('');
        parts.push(`# ${text}`);
        parts.push('');
        break;

      case 'heading2':
        if (prevType !== null) parts.push('');
        parts.push(`## ${text}`);
        parts.push('');
        break;

      case 'list':
        parts.push(`${indentStr}- ${text}`);
        break;

      case 'paragraph':
        // Merge consecutive paragraph lines into one block
        if (prevType === 'paragraph') {
          // Append to last paragraph with a space
          const last = parts[parts.length - 1];
          parts[parts.length - 1] = last + ' ' + text;
        } else {
          if (prevType !== null) parts.push('');
          parts.push(text);
        }
        break;
    }

    prevType = type;
  }

  return parts.join('\n').trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function processOcrToMarkdown(data: VisionResponse): string {
  const words = extractWords(data);
  if (words.length === 0) return '';

  const lines = clusterIntoLines(words);
  const classified = classifyLines(lines);
  return renderMarkdown(classified);
}
