const { sortTextDetections, toBlocks, DEFAULT_Y_THRESHOLD } = require('./sort-text-detections.ts');

const sample = [
  { DetectedText: '第三', Confidence: 97, ItemPolygon: { X: 10, Y: 60, Width: 40, Height: 20 } },
  { DetectedText: '第一', Confidence: 99, ItemPolygon: { X: 10, Y: 10, Width: 40, Height: 20 } },
  { DetectedText: '第二', Confidence: 98, ItemPolygon: { X: 80, Y: 12, Width: 40, Height: 20 } },
  { DetectedText: '第四', Confidence: 96, ItemPolygon: { X: 80, Y: 62, Width: 40, Height: 20 } },
];

const sorted = sortTextDetections(sample, DEFAULT_Y_THRESHOLD);
console.log('sorted:', sorted.map((x) => x.DetectedText).join(','));
const blocks = toBlocks(sample, DEFAULT_Y_THRESHOLD);
console.log('blocks:', JSON.stringify(blocks, null, 2));
