import { describe, expect, it } from 'vitest';
import { analyzeColocImage } from './engine.ts';
import { computeColocalization, computeColocalizationRegions } from './colocalize.ts';
import { DEFAULT_COLOC, type ColocConfig, type Roi } from '../types.ts';

function pixels(a: number[], b: number[], width = a.length) {
  const data = new Uint8ClampedArray(a.length * 4);
  for (let i = 0; i < a.length; i++) data.set([a[i], b[i], 0, 255], i * 4);
  return { data, width, height: a.length / width };
}
const manual: ColocConfig = { ...DEFAULT_COLOC, thresholdMode: 'manual', manualA: 5, manualB: 5, backgroundPercentile: 0 };
const roi = (id: string, x: number, y: number, w: number, h: number): Roi => ({ id, name: id, x, y, w, h });
const a = [0, 0, 10, 10, 20, 20, 0, 0];
const b = [0, 0, 10, 10, 0, 0, 20, 20];

describe('dedicated IF region results', () => {
  it('reports whole-image values, counts and numerators without staining metric labels', () => {
    const { ifAnalysis, coloc } = computeColocalizationRegions(pixels(a, b), manual);
    const whole = ifAnalysis.overall;
    expect(ifAnalysis).toMatchObject({ schemaVersion: 'wisplab.if-colocalization/v1', normalizationScope: 'whole_image', imageWidth: 8, imageHeight: 1, perRoi: [] });
    expect(whole).toMatchObject({ roiId: null, rect: { x: 0, y: 0, w: 8, h: 1 }, pixelCount: 8,
      positivePixelsA: 4, positivePixelsB: 4, unionPixels: 6, intersectionPixels: 2,
      sumA: 60, sumB: 60, sumAInBPositive: 20, sumBInAPositive: 20, undefinedReasons: [] });
    expect(whole.pearsonAll).toBeCloseTo(-250 / 550, 12);
    expect(whole.pearsonMasked).toBe(-1);
    expect(whole.mandersM1).toBeCloseTo(1 / 3, 12);
    expect(whole.mandersM2).toBeCloseTo(1 / 3, 12);
    for (const key of ['pearsonAll', 'pearsonMasked', 'mandersM1', 'mandersM2'] as const) expect(whole[key]).toBe(coloc[key]);
    expect('positiveFraction' in whole).toBe(false);
  });

  it('measures ROI Pearson on all ROI pixels and the within-ROI union mask', () => {
    const result = analyzeColocImage(pixels(a, b), manual, [roi('middle', 2, 0, 4, 1)]).ifAnalysis.perRoi[0];
    expect(result).toMatchObject({ roiId: 'middle', pixelCount: 4, positivePixelsA: 4, positivePixelsB: 2,
      unionPixels: 4, intersectionPixels: 2, sumA: 60, sumB: 20 });
    expect(result.pearsonAll).toBe(-1);
    expect(result.pearsonMasked).toBe(-1);
    expect(result.mandersM1).toBeCloseTo(1 / 3, 12);
    expect(result.mandersM2).toBe(1);
  });

  it('uses strict threshold comparisons and whole-region Manders denominators', () => {
    const result = analyzeColocImage(pixels([0, 5, 6, 2], [7, 5, 6, 8]), manual).ifAnalysis.overall;
    expect(result).toMatchObject({ positivePixelsA: 1, positivePixelsB: 3, unionPixels: 3, intersectionPixels: 1,
      sumA: 13, sumB: 26, sumAInBPositive: 8, sumBInAPositive: 6 });
    expect(result.mandersM1).toBeCloseTo(8 / 13, 12);
    expect(result.mandersM2).toBeCloseTo(6 / 26, 12);
  });

  it('holds whole-image automatic backgrounds and thresholds fixed for every ROI', () => {
    const input = pixels([0, 0, 5, 5, 50, 60, 70, 80], [0, 0, 10, 10, 40, 50, 60, 70]);
    const config: ColocConfig = { ...manual, thresholdMode: 'auto', backgroundPercentile: 25 };
    const result = analyzeColocImage(input, config, [roi('bright', 4, 0, 4, 1)]).ifAnalysis;
    const bright = result.perRoi[0];
    for (const key of ['backgroundA', 'backgroundB', 'thresholdA', 'thresholdB'] as const) expect(bright[key]).toBe(result.overall[key]);
    expect(bright.sumA).toBe(260);
    expect(bright.sumB).toBe(220);
    expect(bright.unionPixels).toBe(4);
    // Re-estimating preprocessing from the crop changes its background and sum.
    const wronglyReprocessed = computeColocalizationRegions(pixels([50, 60, 70, 80], [40, 50, 60, 70]), config).ifAnalysis.overall;
    expect(wronglyReprocessed.backgroundA).toBe(50);
    expect(wronglyReprocessed.sumA).toBe(60);
    expect(bright.backgroundA).not.toBe(wronglyReprocessed.backgroundA);
  });

  it('preserves the legacy whole-image result and exact overlay while adding ROIs', () => {
    const input = pixels(a, b);
    const without = analyzeColocImage(input, manual);
    const withRois = analyzeColocImage(input, manual, [roi('region', 1, 0, 6, 1)]);
    expect(withRois.coloc).toEqual(computeColocalization(input, manual));
    expect(withRois.coloc).toEqual(without.coloc);
    expect(withRois.ifAnalysis.overall).toEqual(without.ifAnalysis.overall);
    expect(withRois.overlayRgba).toEqual(new Uint8ClampedArray([
      0, 0, 0, 0, 0, 0, 0, 0,
      235, 230, 255, 150, 235, 230, 255, 150,
      236, 72, 153, 120, 236, 72, 153, 120,
      74, 222, 128, 120, 74, 222, 128, 120,
    ]));
    expect(withRois.overlayRgba).toEqual(without.overlayRgba);
  });

  it('keeps distinct overlapping ROIs as separate descriptive measurements', () => {
    const result = analyzeColocImage(pixels(a, b), manual, [roi('one', 2, 0, 4, 1), roi('two', 2, 0, 4, 1)]).ifAnalysis;
    expect(result.perRoi).toHaveLength(2);
    expect(result.perRoi.map((r) => r.roiId)).toEqual(['one', 'two']);
    expect(result.perRoi[0].mandersM1).toBe(result.perRoi[1].mandersM1);
    expect('nBio' in result).toBe(false);
  });
});

describe('undefined IF metrics and rectangle boundaries', () => {
  it('uses null and explicit reasons for zero-signal metrics while keeping legacy NaN/zero values', () => {
    const output = analyzeColocImage(pixels([0, 0, 0], [0, 0, 0]), manual);
    const result = output.ifAnalysis.overall;
    expect(result.pearsonAll).toBeNull(); expect(result.pearsonMasked).toBeNull();
    expect(result.mandersM1).toBeNull(); expect(result.mandersM2).toBeNull();
    expect(result.undefinedReasons).toEqual(['pearson_all_zero_variance', 'pearson_masked_insufficient_pixels', 'manders_m1_zero_denominator', 'manders_m2_zero_denominator']);
    expect(Number.isNaN(output.coloc.pearsonAll)).toBe(true);
    expect(output.coloc.mandersM1).toBe(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('distinguishes an empty positive mask from a valid zero Manders fraction', () => {
    const result = analyzeColocImage(pixels([1, 2, 3], [3, 2, 1]), { ...manual, manualA: 200, manualB: 200 }).ifAnalysis.overall;
    expect(result.pearsonAll).toBe(-1);
    expect(result.pearsonMasked).toBeNull();
    expect(result.unionPixels).toBe(0);
    expect(result.mandersM1).toBe(0);
    expect(result.mandersM2).toBe(0);
    expect(result.undefinedReasons).toEqual(['pearson_masked_insufficient_pixels']);
  });

  it('reports insufficient pixels for a one-pixel region instead of zero correlation', () => {
    const result = analyzeColocImage(pixels(a, b), manual, [roi('single', 2, 0, 1, 1)]).ifAnalysis.perRoi[0];
    expect(result.pixelCount).toBe(1);
    expect(result.pearsonAll).toBeNull(); expect(result.pearsonMasked).toBeNull();
    expect(result.mandersM1).toBe(1); expect(result.mandersM2).toBe(1);
    expect(result.undefinedReasons).toEqual(['pearson_all_insufficient_pixels', 'pearson_masked_insufficient_pixels']);
  });

  it('rounds each rectangle component then clips a true half-open intersection', () => {
    const input = pixels(Array.from({ length: 12 }, (_, i) => i), Array.from({ length: 12 }, (_, i) => 12 - i), 4);
    const result = analyzeColocImage(input, manual, [roi('clipped', -1.4, 0.6, 3.4, 1.6)]).ifAnalysis.perRoi[0];
    expect(result.rect).toEqual({ x: 0, y: 1, w: 2, h: 2 });
    expect(result.pixelCount).toBe(4);
    expect(result.sumA).toBe(4 + 5 + 8 + 9);
  });

  it('returns an empty region for an out-of-image or subpixel-rounded rectangle', () => {
    const result = analyzeColocImage(pixels(a, b), manual, [roi('outside', 10, 0, 2, 1), roi('tiny', 1, 0, 0.2, 1)]).ifAnalysis;
    for (const region of result.perRoi) {
      expect(region.pixelCount).toBe(0);
      expect(region.rect.w).toBe(0);
      expect(region.positivePixelsA).toBe(0); expect(region.unionPixels).toBe(0);
      expect(region.pearsonAll).toBeNull(); expect(region.mandersM1).toBeNull();
      expect(region.undefinedReasons).toEqual(['pearson_all_insufficient_pixels', 'pearson_masked_insufficient_pixels', 'manders_m1_zero_denominator', 'manders_m2_zero_denominator']);
    }
  });

  it.each([roi('zero', 0, 0, 0, 1), roi('negative', 0, 0, -1, 1), roi('nonfinite', NaN, 0, 1, 1), roi('unsafe', Number.MAX_SAFE_INTEGER, 0, 2, 1)])('rejects invalid ROI geometry $id', (invalid) => {
    expect(() => analyzeColocImage(pixels(a, b), manual, [invalid])).toThrow(/IF ROI/);
  });

  it('rejects empty or duplicate ROI IDs instead of silently merging them', () => {
    expect(() => analyzeColocImage(pixels(a, b), manual, [roi('', 0, 0, 1, 1)])).toThrow(/ID/);
    expect(() => analyzeColocImage(pixels(a, b), manual, [roi('same', 0, 0, 1, 1), roi('same', 2, 0, 1, 1)])).toThrow(/ID/);
  });
});
