import { array, integer, nullable, number, object, oneOf, string } from './project-archive';
import type { IfAnalysisResult, IfRegionResult, IfUndefinedReason } from './core/types';

const bounded = (min: number, max: number) => (value: unknown) => number(value) && (value as number) >= min && (value as number) <= max;
const nonnegative = bounded(0, Number.MAX_VALUE);
const reasonCheck = oneOf('pearson_all_insufficient_pixels', 'pearson_all_zero_variance', 'pearson_masked_insufficient_pixels', 'pearson_masked_zero_variance', 'manders_m1_zero_denominator', 'manders_m2_zero_denominator');
const rectCheck = object({ x: integer(0, 4096), y: integer(0, 4096), w: integer(0, 4096), h: integer(0, 4096) });
const regionShape = object({ roiId: nullable(string), roiName: string, rect: rectCheck, pixelCount: integer(),
  positivePixelsA: integer(), positivePixelsB: integer(), unionPixels: integer(), intersectionPixels: integer(),
  channelA: oneOf(0, 1, 2), channelB: oneOf(0, 1, 2), thresholdA: integer(0, 255), thresholdB: integer(0, 255), backgroundA: integer(0, 255), backgroundB: integer(0, 255),
  pearsonAll: nullable(bounded(-1.0000000001, 1.0000000001)), pearsonMasked: nullable(bounded(-1.0000000001, 1.0000000001)),
  mandersM1: nullable(bounded(0, 1)), mandersM2: nullable(bounded(0, 1)),
  sumA: nonnegative, sumB: nonnegative, sumAInBPositive: nonnegative, sumBInAPositive: nonnegative, undefinedReasons: array(reasonCheck, 6) });
function regionCheck(value: unknown): boolean {
  if (!regionShape(value)) return false;
  const r = value as IfRegionResult;
  if (r.pixelCount !== r.rect.w * r.rect.h || r.unionPixels > r.pixelCount || r.positivePixelsA > r.unionPixels || r.positivePixelsB > r.unionPixels
    || r.intersectionPixels > Math.min(r.positivePixelsA, r.positivePixelsB) || r.unionPixels !== r.positivePixelsA + r.positivePixelsB - r.intersectionPixels
    || r.sumAInBPositive > r.sumA || r.sumBInAPositive > r.sumB || r.sumA > 255 * r.pixelCount || r.sumB > 255 * r.pixelCount) return false;
  const expected: IfUndefinedReason[] = [];
  if (r.pixelCount < 2 && r.pearsonAll !== null || r.unionPixels < 2 && r.pearsonMasked !== null) return false;
  if (r.pearsonAll === null) expected.push(r.pixelCount < 2 ? 'pearson_all_insufficient_pixels' : 'pearson_all_zero_variance');
  if (r.pearsonMasked === null) expected.push(r.unionPixels < 2 ? 'pearson_masked_insufficient_pixels' : 'pearson_masked_zero_variance');
  for (const [sum, numerator, coefficient, reason] of [[r.sumA, r.sumAInBPositive, r.mandersM1, 'manders_m1_zero_denominator'], [r.sumB, r.sumBInAPositive, r.mandersM2, 'manders_m2_zero_denominator']] as const) {
    if (sum === 0) { if (coefficient !== null) return false; expected.push(reason); }
    else if (coefficient === null || Math.abs(coefficient - numerator / sum) > 1e-12) return false;
  }
  return new Set(r.undefinedReasons).size === expected.length && r.undefinedReasons.length === expected.length && expected.every((reason) => r.undefinedReasons.includes(reason));
}
const analysisShape = object({ schemaVersion: oneOf('wisplab.if-colocalization/v1'), normalizationScope: oneOf('whole_image'), imageWidth: integer(1, 4096), imageHeight: integer(1, 4096), overall: regionCheck, perRoi: array(regionCheck, 10000) });
export function ifAnalysisCheck(value: unknown): boolean {
  if (!analysisShape(value)) return false;
  const a = value as IfAnalysisResult;
  if (a.overall.roiId !== null || a.overall.rect.x !== 0 || a.overall.rect.y !== 0 || a.overall.rect.w !== a.imageWidth || a.overall.rect.h !== a.imageHeight) return false;
  const ids = new Set<string>();
  for (const r of a.perRoi) {
    if (!r.roiId?.trim() || ids.has(r.roiId) || r.rect.x + r.rect.w > a.imageWidth || r.rect.y + r.rect.h > a.imageHeight) return false;
    ids.add(r.roiId);
    if (['channelA', 'channelB', 'thresholdA', 'thresholdB', 'backgroundA', 'backgroundB'].some((key) => r[key as keyof IfRegionResult] !== a.overall[key as keyof IfRegionResult])) return false;
  }
  return true;
}
