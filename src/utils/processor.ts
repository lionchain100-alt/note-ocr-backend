/**
 * processOcrToMarkdown v3
 *
 * Clustering rules:
 * - Two words A→B are in the same cluster if:
 *   1. |midY_A - midY_B| < 0.5 * height_A  (vertical proximity)
 *   2. horizontal gap (B.left - A.right) < 2.5 * medianCharWidth  (horizontal proximity)
 * - Clusters sorted top-to-bottom, words within sorted left-to-right
 * - Isolated clusters (far right) → Markdown blockquote `> `
 * - Low-confidence words → <mark class="low-confidence">
 */

// ─── Vision API types ─────────────────────────────────────────────────────────

interface NormalizedVertex {
  x: number;
  y: number;
}

interface Symbol {
  text: string;
  confidence?: number;
}

interface Word {
  symbols: Symbol[];
  boundingBox?: { normalizedVertices?: NormalizedVertex[] };
  confidence?: number;
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

export interface VisionResponse {
  responses: Array<{
    fullTextAnnotation?: FullTextAnnotation;
  }>;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface WordToken {
  text: string;       // rendered (may include <mark>)
  rawText: string;    // plain text for detection
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  midY: number;
  charWidth: number;  // average char width = (right - left) / charCount
  confidence: number;
}

interface Cluster {
  words: WordToken[];
  top: number;        // min top of all words
  left: number;       // min left
  right: number;      // max right
  avgHeight: number;
  text: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOW_CONFIDENCE_THRESHOLD = 0.7;
// A cluster is a "marginal note" if its left edge is beyond this fraction of page width
const MARGIN_NOTE_LEFT_THRESHOLD = 0.65;

// ─── Step 1: Extract words ────────────────────────────────────────────────────

function extractWords(data: VisionResponse): WordToken[] {
  const tokens: WordToken[] = [];
  const pages = data.responses?.[0]?.fullTextAnnotation?.pages ?? [];

  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const verts = word.boundingBox?.normalizedVertices ?? [];
          if (verts.length < 4) continue;

          const xs = verts.map((v) => v.x ?? 0);
          const ys = verts.map((v) => v.y ?? 0);

          const left   = Math.min(...xs);
          const right  = Math.max(...xs);
          const top    = Math.min(...ys);
          const bottom = Math.max(...ys);
          const height = bottom - top;
          const midY   = (top + bottom) / 2;

          const rawText = word.symbols.map((s) => s.text).join('');
          const charCount = rawText.length || 1;
          const charWidth = (right - left) / charCount;

          const confidence =
            word.confidence ??
            word.symbols.reduce((s, sym) => s + (sym.confidence ?? 1), 0) / (word.symbols.length || 1);

          const text =
            confidence < LOW_CONFIDENCE_THRESHOLD
              ? `<mark class="low-confidence">${rawText}</mark>`
              : rawText;

          tokens.push({ text, rawText, left, right, top, bottom, height, midY, charWidth, confidence });
        }
      }
    }
  }

  return tokens;
}

// ─── Step 2: Compute median char width ───────────────────────────────────────

function medianCharWidth(words: WordToken[]): number {
  if (words.length === 0) return 0.01;
  const widths = [...words].map((w) => w.charWidth).sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)];
}

// ─── Step 3: DBSCAN-style clustering with dual constraints ───────────────────
//
// We do a single left-to-right, top-to-bottom sweep.
// Word B joins the current cluster if it satisfies BOTH:
//   (1) vertical:   |midY_B - midY_lastInCluster| < 0.5 * height_lastInCluster
//   (2) horizontal: gap (B.left - lastInCluster.right) < 2.5 * medCharWidth
//
// If either constraint fails → start a new cluster.

function clusterWords(words: WordToken[], medCharWidth: number): Cluster[] {
  if (words.length === 0) return [];

  // Sort top-to-bottom first, then left-to-right
  const sorted = [...words].sort((a, b) => a.midY - b.midY || a.left - b.left);

  const rawClusters: WordToken[][] = [];
  let current: WordToken[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1];
    const curr = sorted[i];

    const vertOk = Math.abs(curr.midY - prev.midY) < 0.5 * prev.height;
    const hGap   = curr.left - prev.right;
    const horizOk = hGap < 2.5 * medCharWidth;

    if (vertOk && horizOk) {
      current.push(curr);
    } else {
      rawClusters.push(current);
      current = [curr];
    }
  }
  rawClusters.push(current);

  // Build Cluster objects
  const clusters: Cluster[] = rawClusters.map((group) => {
    // Sort left-to-right within cluster
    group.sort((a, b) => a.left - b.left);

    const top      = Math.min(...group.map((w) => w.top));
    const left     = Math.min(...group.map((w) => w.left));
    const right    = Math.max(...group.map((w) => w.right));
    const avgHeight = group.reduce((s, w) => s + w.height, 0) / group.length;

    // Join words; skip space before punctuation
    let text = group[0].text;
    for (let i = 1; i < group.length; i++) {
      const nextRaw = group[i].rawText;
      const needsSpace = !/^[.,!?;:'")\]}-]/.test(nextRaw);
      text += (needsSpace ? ' ' : '') + group[i].text;
    }

    return { words: group, top, left, right, avgHeight, text };
  });

  // Step 4: Sort clusters top-to-bottom by their top coordinate
  clusters.sort((a, b) => a.top - b.top);

  return clusters;
}

// ─── Step 5: Classify + render Markdown ──────────────────────────────────────

type LineType = 'heading' | 'list' | 'paragraph' | 'margin';

function classifyCluster(cluster: Cluster, medianHeight: number): LineType {
  // Marginal note: cluster starts far to the right
  if (cluster.left > MARGIN_NOTE_LEFT_THRESHOLD) return 'margin';

  const raw = cluster.words.map((w) => w.rawText).join(' ').trim();

  // Heading: significantly taller than median
  if (cluster.avgHeight > medianHeight * 1.4) return 'heading';

  // List item
  if (/^[-*•·▪▸>]\s|^\d+[.)]\s/.test(raw)) return 'list';

  return 'paragraph';
}

function renderMarkdown(clusters: Cluster[]): string {
  if (clusters.length === 0) return '';

  // Median cluster height
  const sorted = [...clusters].sort((a, b) => a.avgHeight - b.avgHeight);
  const medianHeight = sorted[Math.floor(sorted.length / 2)].avgHeight;

  const parts: string[] = [];
  let prevType: LineType | null = null;

  for (const cluster of clusters) {
    const trimmed = cluster.text.trim();
    if (!trimmed) continue;

    const type = classifyCluster(cluster, medianHeight);

    switch (type) {
      case 'heading': {
        if (prevType !== null) parts.push('');
        parts.push(`## ${trimmed}`);
        parts.push('');
        break;
      }

      case 'list': {
        const body = trimmed.replace(/^[-*•·▪▸>]\s+|^\d+[.)]\s+/, '');
        parts.push(`- ${body}`);
        break;
      }

      case 'margin': {
        // Blockquote for marginal notes
        if (prevType !== 'margin') parts.push('');
        parts.push(`> ${trimmed}`);
        break;
      }

      case 'paragraph': {
        if (prevType === 'paragraph') {
          parts[parts.length - 1] += ' ' + trimmed;
        } else {
          if (prevType !== null) parts.push('');
          parts.push(trimmed);
        }
        break;
      }
    }

    prevType = type;
  }

  return parts.join('\n').trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function processOcrToMarkdown(data: VisionResponse): string {
  const words = extractWords(data);
  if (words.length === 0) return '';

  const mcw = medianCharWidth(words);
  const clusters = clusterWords(words, mcw);
  return renderMarkdown(clusters);
}
