import { describe, expect, it } from 'vitest';
import { analysisIdentity, currentAnalysis, finishAnalysis, modelContentId, startAnalysis } from './analysis-validity.ts';
import { createEmptyProject, type AnalysisResult, type ProjectState } from './types.ts';

const ai = { modelRequested: false, modelId: null };
function fixture(): ProjectState {
  return { ...createEmptyProject(), pixels: { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData };
}
const result = { requestId: 1, aiUsed: false } as AnalysisResult;

describe('current analysis validity across all consumers', () => {
  it.each(['pixels', 'rois', 'profileId', 'threshold', 'segmentation', 'calibration', 'coloc', 'stainOverrides', 'image'])('invalidates %s before debounce starts', (field) => {
    const project = fixture();
    const original = analysisIdentity(project, ai);
    const run = finishAnalysis(startAnalysis(1, original), 1, result);
    const replacements = {
      pixels: { ...project.pixels! }, rois: [{ id: 'r', name: 'ROI', x: 0, y: 0, w: 1, h: 1 }],
      profileId: 'if_coloc', threshold: { ...project.threshold, manualValue: 90 },
      segmentation: { ...project.segmentation, minAreaPx: 22 }, calibration: { mpp: 0.5 },
      coloc: { ...project.coloc, channelA: 2 }, stainOverrides: { h_dab: [[1, 0, 0], [0, 1, 0]] },
      image: { name: 'changed' },
    };
    const changed = { ...project, [field]: replacements[field as keyof typeof replacements] } as ProjectState;
    expect(currentAnalysis(run, original)).toBe(result);
    expect(currentAnalysis(run, analysisIdentity(changed, ai))).toBeNull();
  });

  it('copies settings values and ignores sample-library-only edits', () => {
    const project = fixture();
    const run = finishAnalysis(startAnalysis(1, analysisIdentity(project, ai)), 1, result);
    expect(currentAnalysis(run, analysisIdentity({ ...project, samples: [...project.samples] }, ai))).toBe(result);
    project.threshold = { ...project.threshold };
    expect(currentAnalysis(run, analysisIdentity(project, ai))).toBe(result);
    project.threshold.manualValue += 1;
    expect(currentAnalysis(run, analysisIdentity(project, ai))).toBeNull();
  });

  it('ignores old successes and old failures after successive changes, including a return to the original settings', () => {
    const first = analysisIdentity(fixture(), ai);
    const latest = startAnalysis(3, first);
    expect(finishAnalysis(latest, 1, result)).toBe(latest);
    expect(finishAnalysis(latest, 2, new Error('old failure'))).toBe(latest);
    expect(currentAnalysis(latest, first)).toBeNull();
    const failed = finishAnalysis(latest, 3, new Error('current failure'));
    expect(currentAnalysis(failed, first)).toBeNull();
    expect(finishAnalysis(failed, 3, result)).toBe(failed);
    const retry = finishAnalysis(startAnalysis(4, first), 4, result);
    expect(currentAnalysis(retry, first)).toBe(result);
  });

  it('distinguishes same-name model content and AI toggles, and rejects mismatched AI results', async () => {
    const modelA = await modelContentId(new Uint8Array([1, 2, 3]).buffer);
    const modelB = await modelContentId(new Uint8Array([1, 2, 4]).buffer);
    expect(modelA).not.toBe(modelB);
    expect(await modelContentId(new Uint8Array([1, 2, 3]).buffer)).toBe(modelA);
    const project = fixture();
    const identity = analysisIdentity(project, { modelRequested: true, modelId: modelA });
    const aiResult = { ...result, aiUsed: true, aiModelId: modelA };
    const run = finishAnalysis(startAnalysis(1, identity), 1, aiResult);
    expect(currentAnalysis(run, identity)).toBe(aiResult);
    expect(currentAnalysis(run, analysisIdentity(project, { modelRequested: false, modelId: modelA }))).toBeNull();
    expect(currentAnalysis(run, analysisIdentity(project, { modelRequested: true, modelId: modelB }))).toBeNull();
    expect(finishAnalysis(startAnalysis(2, identity), 2, { ...aiResult, aiModelId: modelB })?.status).toBe('failed');
  });
});
