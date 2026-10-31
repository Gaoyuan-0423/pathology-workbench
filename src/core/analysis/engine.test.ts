import { describe, it, expect } from 'vitest';
import { analyzeStainImage } from './engine';
import { DEFAULT_THRESHOLD, DEFAULT_SEGMENTATION } from '../types';

describe('optional spatial nucleus review export', () => {
  it('exports known synthetic mask centroids without changing measurements or default payload', () => {
    const width = 20, height = 12;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const mask = new Uint8Array(width * height);
    for (const [left, top] of [[3, 3], [12, 5]]) {
      for (let y = top; y < top + 3; y++) for (let x = left; x < left + 3; x++) {
        mask[y * width + x] = 1;
        data.set([95, 65, 40, 255], (y * width + x) * 4);
      }
    }
    const input = { pixels: { width, height, data }, aiMask: mask, rois: [], profileId: 'h_dab' as const,
      threshold: { ...DEFAULT_THRESHOLD }, segmentation: { ...DEFAULT_SEGMENTATION, minAreaPx: 1, maxAreaPx: 1000, minCircularity: 0 },
      calibration: { mpp: null }, stainOverride: null };
    const plain = analyzeStainImage(input), exported = analyzeStainImage({ ...input, includeNuclei: true });
    expect(plain).not.toHaveProperty('nuclei');
    expect(exported.nuclei?.map(n => [n.cx, n.cy])).toEqual([[4, 4], [13, 6]]);
    expect(exported.nuclei?.length).toBe(exported.overall.totalNuclei);
    expect(exported.nuclei?.filter(n => n.positive).length).toBe(exported.overall.positiveNuclei);
    const { nuclei, ...rest } = exported;
    expect(rest).toEqual(plain);
    expect(nuclei?.every(n => Number.isFinite(n.meanOd) && !n.touchesBorder)).toBe(true);
  });
});
