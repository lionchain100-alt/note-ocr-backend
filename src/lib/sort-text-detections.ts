import type { OcrBlock } from './ocr-response';

export interface ItemPolygon {
  X: number;
  Y: number;
  Width: number;
  Height: number;
}

export interface TextDetection {
  DetectedText: string;
  Confidence: number;
  ItemPolygon: ItemPolygon;
}

export const DEFAULT_Y_THRESHOLD = 25;

export function sortTextDetections(textDetections: TextDetection[], yThreshold = DEFAULT_Y_THRESHOLD): TextDetection[] {
  if (!textDetections?.length) return [];

  const sortedByY = [...textDetections].sort((a, b) => {
    const yA = a.ItemPolygon?.Y || 0;
    const yB = b.ItemPolygon?.Y || 0;
    return yA - yB;
  });

  const rows: TextDetection[][] = [];
  let currentRow: TextDetection[] = [sortedByY[0]];
  let currentRowY = sortedByY[0].ItemPolygon?.Y || 0;

  for (let i = 1; i < sortedByY.length; i += 1) {
    const block = sortedByY[i];
    const blockY = block.ItemPolygon?.Y || 0;

    if (Math.abs(blockY - currentRowY) < yThreshold) {
      currentRow.push(block);
    } else {
      rows.push(currentRow);
      currentRow = [block];
      currentRowY = blockY;
    }
  }

  if (currentRow.length > 0) rows.push(currentRow);

  return rows.flatMap((row) => row.sort((a, b) => (a.ItemPolygon?.X || 0) - (b.ItemPolygon?.X || 0)));
}

export function toBlocks(textDetections: TextDetection[], yThreshold = DEFAULT_Y_THRESHOLD): OcrBlock[] {
  return sortTextDetections(textDetections, yThreshold)
    .filter((item) => item.DetectedText?.trim())
    .map((item) => ({
      type: 'line' as const,
      text: item.DetectedText.trim(),
      bbox: [
        item.ItemPolygon?.X || 0,
        item.ItemPolygon?.Y || 0,
        item.ItemPolygon?.Width || 0,
        item.ItemPolygon?.Height || 0,
      ],
      confidence: Number(item.Confidence || 0),
    }));
}
