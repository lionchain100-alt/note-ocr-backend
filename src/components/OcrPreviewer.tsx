'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NormalizedVertex { x: number; y: number }
interface Symbol { text: string; confidence?: number }
interface Word {
  symbols: Symbol[];
  boundingBox?: { normalizedVertices?: NormalizedVertex[] };
  confidence?: number;
}
interface Paragraph { words: Word[] }
interface Block { paragraphs: Paragraph[] }
interface Page { blocks: Block[] }

export interface VisionJson {
  responses: Array<{
    fullTextAnnotation?: { pages: Page[] };
  }>;
}

type WordStatus = 'default' | 'active' | 'verified';

interface WordOverlay {
  id: string;
  text: string;
  confidence: number;
  left: number;   // % of image width
  top: number;
  width: number;
  height: number;
  lineId: string; // which markdown line this word belongs to
}

interface MarkdownLine {
  id: string;
  text: string;       // rendered markdown text (with data-ocr-id attr)
  wordIds: string[];  // overlay ids in this line
}

interface OcrPreviewerProps {
  image_url: string;
  google_vision_json: VisionJson;
}

// ─── Data extraction ──────────────────────────────────────────────────────────

interface ExtractResult {
  overlays: WordOverlay[];
  lines: MarkdownLine[];
}

function extractData(json: VisionJson): ExtractResult {
  const overlays: WordOverlay[] = [];
  const pages = json.responses?.[0]?.fullTextAnnotation?.pages ?? [];

  // Collect all words with ids
  let wordIdx = 0;
  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const verts = word.boundingBox?.normalizedVertices ?? [];
          if (verts.length < 4) continue;

          const xs = verts.map((v) => v.x ?? 0);
          const ys = verts.map((v) => v.y ?? 0);

          const left   = Math.min(...xs) * 100;
          const top    = Math.min(...ys) * 100;
          const width  = (Math.max(...xs) - Math.min(...xs)) * 100;
          const height = (Math.max(...ys) - Math.min(...ys)) * 100;
          const midY   = top + height / 2;

          const rawText = word.symbols.map((s) => s.text).join('');
          const confidence =
            word.confidence ??
            word.symbols.reduce((s, sym) => s + (sym.confidence ?? 1), 0) /
              (word.symbols.length || 1);

          overlays.push({
            id: `w${wordIdx++}`,
            text: rawText,
            confidence,
            left, top, width, height,
            lineId: '',   // filled below
          });
        }
      }
    }
  }

  // Cluster overlays into lines by vertical proximity
  overlays.sort((a, b) => a.top - b.top || a.left - b.left);

  const lineGroups: WordOverlay[][] = [];
  let current: WordOverlay[] = [];

  for (const word of overlays) {
    if (current.length === 0) { current.push(word); continue; }
    const prev = current[current.length - 1];
    const prevMidY = prev.top + prev.height / 2;
    const currMidY = word.top + word.height / 2;
    if (Math.abs(currMidY - prevMidY) < prev.height * 0.5) {
      current.push(word);
    } else {
      lineGroups.push(current);
      current = [word];
    }
  }
  if (current.length) lineGroups.push(current);

  // Build MarkdownLine objects
  const lines: MarkdownLine[] = lineGroups.map((group, li) => {
    const lineId = `line${li}`;
    group.sort((a, b) => a.left - b.left);
    group.forEach((w) => { w.lineId = lineId; });

    const text = group.map((w) => w.text).join(' ');
    return {
      id: lineId,
      text,
      wordIds: group.map((w) => w.id),
    };
  });

  return { overlays, lines };
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function overlayColor(confidence: number, status: WordStatus): string {
  if (status === 'active')   return 'rgba(59, 130, 246, 0.45)';   // blue pulse
  if (status === 'verified') return 'rgba(59, 130, 246, 0.25)';   // blue calm
  if (confidence >= 0.9)     return 'rgba(34, 197, 94, 0.25)';    // green
  if (confidence >= 0.7)     return 'rgba(234, 179, 8, 0.25)';    // yellow
  return 'rgba(239, 68, 68, 0.35)';                                // red
}

function overlayBorder(confidence: number, status: WordStatus): string {
  if (status === 'active')   return '2px solid rgba(59, 130, 246, 0.9)';
  if (status === 'verified') return '1px solid rgba(59, 130, 246, 0.5)';
  if (confidence >= 0.9)     return '1px solid rgba(34, 197, 94, 0.5)';
  if (confidence >= 0.7)     return '1px solid rgba(234, 179, 8, 0.5)';
  return '1px solid rgba(239, 68, 68, 0.7)';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OcrPreviewer({ image_url, google_vision_json }: OcrPreviewerProps) {
  const { overlays, lines } = extractData(google_vision_json);

  // Markdown editor content (one entry per line)
  const [editorLines, setEditorLines] = useState<string[]>(lines.map((l) => l.text));

  // Which lineId is currently active (clicked in editor)
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  // Which lineIds have been manually edited → "verified"
  const [verifiedLines, setVerifiedLines] = useState<Set<string>>(new Set());

  // Tooltip
  const [tooltip, setTooltip] = useState<{ word: WordOverlay; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Map lineId → word status
  function wordStatus(word: WordOverlay): WordStatus {
    if (word.lineId === activeLineId) return 'active';
    if (verifiedLines.has(word.lineId)) return 'verified';
    return 'default';
  }

  // Editor line change
  const handleLineChange = useCallback((idx: number, value: string) => {
    setEditorLines((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
    // Mark as verified
    const lineId = lines[idx]?.id;
    if (lineId) {
      setVerifiedLines((prev) => new Set(prev).add(lineId));
    }
  }, [lines]);

  // Click on editor line → activate corresponding image region
  const handleLineFocus = useCallback((idx: number) => {
    setActiveLineId(lines[idx]?.id ?? null);
  }, [lines]);

  const handleLineBlur = useCallback(() => {
    setActiveLineId(null);
  }, []);

  // Scroll active line's bounding box into view (image side)
  useEffect(() => {
    if (!activeLineId || !containerRef.current) return;
    const firstWord = overlays.find((w) => w.lineId === activeLineId);
    if (!firstWord) return;
    // Scroll image container so the active region is visible
    const container = containerRef.current;
    const containerH = container.clientHeight;
    const targetY = (firstWord.top / 100) * container.scrollHeight;
    container.scrollTo({ top: targetY - containerH / 3, behavior: 'smooth' });
  }, [activeLineId, overlays]);

  return (
    <div style={{ display: 'flex', gap: 0, height: '80vh', fontFamily: 'system-ui, sans-serif', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>

      {/* ── Left pane: Image + overlays ── */}
      <div style={{ flex: 1, overflow: 'auto', background: '#f8fafc', borderRight: '1px solid #e2e8f0' }}>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, padding: '8px 12px', background: '#fff', borderBottom: '1px solid #e2e8f0', fontSize: 11, color: '#64748b' }}>
          <LegendDot color="rgba(34,197,94,0.4)"  border="rgba(34,197,94,0.6)"  label="≥90%" />
          <LegendDot color="rgba(234,179,8,0.4)"  border="rgba(234,179,8,0.6)"  label="70–90%" />
          <LegendDot color="rgba(239,68,68,0.4)"  border="rgba(239,68,68,0.7)"  label="<70%" />
          <LegendDot color="rgba(59,130,246,0.35)" border="rgba(59,130,246,0.7)" label="Active / Verified" />
        </div>

        {/* Image container */}
        <div ref={containerRef} style={{ position: 'relative', display: 'inline-block', lineHeight: 0, minWidth: '100%' }}>
          <img
            src={image_url}
            alt="OCR source"
            style={{ display: 'block', width: '100%', height: 'auto' }}
            draggable={false}
          />

          {overlays.map((word) => {
            const status = wordStatus(word);
            return (
              <div
                key={word.id}
                onMouseEnter={(e) => {
                  const rect = containerRef.current!.getBoundingClientRect();
                  setTooltip({ word, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseMove={(e) => {
                  const rect = containerRef.current!.getBoundingClientRect();
                  setTooltip({ word, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => setTooltip(null)}
                style={{
                  position: 'absolute',
                  left:   `${word.left}%`,
                  top:    `${word.top}%`,
                  width:  `${word.width}%`,
                  height: `${word.height}%`,
                  backgroundColor: overlayColor(word.confidence, status),
                  border: overlayBorder(word.confidence, status),
                  borderRadius: 2,
                  cursor: 'crosshair',
                  boxSizing: 'border-box',
                  transition: 'background-color 0.2s, border 0.2s',
                  animation: status === 'active' ? 'pulse 1s ease-in-out infinite' : 'none',
                }}
              />
            );
          })}

          {/* Tooltip */}
          {tooltip && (
            <div style={{
              position: 'absolute',
              left: tooltip.x + 14,
              top:  tooltip.y + 14,
              background: 'rgba(15,23,42,0.92)',
              color: '#f8fafc',
              padding: '6px 10px',
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.5,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 50,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}>
              <div style={{ fontWeight: 700 }}>{tooltip.word.text}</div>
              <div style={{ color: tooltip.word.confidence >= 0.9 ? '#86efac' : tooltip.word.confidence >= 0.7 ? '#fde047' : '#fca5a5' }}>
                Confidence: {(tooltip.word.confidence * 100).toFixed(1)}%
              </div>
              <div style={{ color: '#94a3b8', fontSize: 10 }}>
                {verifiedLines.has(tooltip.word.lineId) ? '✓ Manually verified' : 'Unverified'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right pane: Markdown editor ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
          <span>Markdown Editor</span>
          <span>{verifiedLines.size} / {lines.length} lines verified</span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {lines.map((line, idx) => {
            const isActive   = activeLineId === line.id;
            const isVerified = verifiedLines.has(line.id);
            return (
              <div
                key={line.id}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  borderLeft: isActive
                    ? '3px solid #3b82f6'
                    : isVerified
                    ? '3px solid rgba(59,130,246,0.35)'
                    : '3px solid transparent',
                  background: isActive ? 'rgba(59,130,246,0.05)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                {/* Line number */}
                <div style={{ width: 36, textAlign: 'right', paddingRight: 8, paddingTop: 6, fontSize: 11, color: '#94a3b8', userSelect: 'none', flexShrink: 0 }}>
                  {idx + 1}
                </div>

                {/* Editable line */}
                <input
                  type="text"
                  value={editorLines[idx] ?? ''}
                  data-ocr-id={line.id}
                  onFocus={() => handleLineFocus(idx)}
                  onBlur={handleLineBlur}
                  onChange={(e) => handleLineChange(idx, e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    padding: '4px 8px',
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    background: 'transparent',
                    color: '#1e293b',
                  }}
                />

                {/* Verified badge */}
                {isVerified && (
                  <div style={{ paddingRight: 8, paddingTop: 6, fontSize: 11, color: '#3b82f6', flexShrink: 0 }}>✓</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Export button */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid #e2e8f0' }}>
          <button
            onClick={() => {
              const md = editorLines.join('\n');
              navigator.clipboard.writeText(md);
            }}
            style={{
              width: '100%',
              padding: '8px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Copy Markdown
          </button>
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function LegendDot({ color, border, label }: { color: string; border: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 12, height: 12, background: color, border: `1px solid ${border}`, borderRadius: 2 }} />
      <span>{label}</span>
    </div>
  );
}
