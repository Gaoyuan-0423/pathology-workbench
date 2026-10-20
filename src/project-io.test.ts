import { beforeAll, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createEmptyProject, type AnalysisResult, type RoiMetrics } from './core/types';
import { decodeJson, encodeJson } from './project-archive';
import { analysisSettings, emptySources, exportPathologyProject, importPathologyProject, pathologyCompleteness, type LocalProject, type ProjectView } from './project-io';

beforeAll(() => {
  if (!globalThis.ImageData) globalThis.ImageData = class {
    data: Uint8ClampedArray; width: number; height: number; colorSpace = 'srgb' as const;
    constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height; }
  } as unknown as typeof ImageData;
});
const view: ProjectView = { showOverlay: false, statsMetric: 'hScore', lastStainProfile: 'masson', modelName: null, modelRequested: false };
const metrics: RoiMetrics = { roiId: null, roiName: 'all', pixelCount: 4, positiveFraction: 0.5, positiveNuclei: 0, totalNuclei: 0, labelingIndex: null, integratedOpticalDensity: 14, meanOpticalDensity: 7, borderNuclei: 0, estimatedTotalCount: null, densityPerMm2: null, hScore: null };
function fixture(): LocalProject {
  const project: LocalProject = { ...createEmptyProject(), image: { name: 'sample.tif', sourceType: 'TIFF16', sourceWidth: 2, sourceHeight: 2, workingWidth: 2, workingHeight: 2, workingScale: 1, bitsPerSample: 16, note: '16-bit source / 8-bit working pixels' }, pixels: new ImageData(new Uint8ClampedArray([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]), 2, 2), rois: [{ id: 'r1', name: 'ROI 1', x: 0, y: 0, w: 2, h: 1 }], sources: emptySources() };
  project.sources!.main = new File(['original TIFF bytes'], 'sample.tif', { lastModified: 1760000000000 });
  project.sources!.control = new File(['control TIFF bytes'], 'control.tif');
  project.threshold = { ...project.threshold, mode: 'control', controlThreshold: 40, controlImageName: 'control.tif' };
  project.calibration = { mpp: 0.5 };
  project.stainOverrides = { h_dab: [[0.6, 0.7, 0.2], [0.2, 0.5, 0.8]] };
  project.samples = [{ id: 's1', name: 'sample 1', group: 'control', imageName: 'sample.tif', addedAt: Date.now(), metrics }];
  project.sources!.samples.s1 = { image: project.sources!.main, control: project.sources!.control, settings: analysisSettings(project), analysis: null, modelName: null };
  return project;
}
async function mutate(blob: Blob, change: (state: any) => void): Promise<Blob> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = decodeJson(strFromU8(entries['manifest.json'])); change(manifest);
  entries['manifest.json'] = strToU8(encodeJson(manifest));
  return new Blob([Uint8Array.from(zipSync(entries)).buffer]);
}
describe('Pathology project package', () => {
  it('round-trips exact working pixels, 16-bit originals, control, ROI, settings and sample contexts', async () => {
    const project = fixture(); const exported = await exportPathologyProject(project, view, null);
    expect(exported.completeness).toEqual([]);
    const restored = await importPathologyProject(exported.blob);
    expect(restored.project.pixels!.data).toEqual(project.pixels!.data);
    expect(restored.project.rois).toEqual(project.rois); expect(restored.project.samples).toEqual(project.samples);
    expect(restored.project.threshold).toEqual(project.threshold); expect(restored.project.stainOverrides).toEqual(project.stainOverrides);
    expect(restored.project.sources!.samples.s1.settings).toEqual(analysisSettings(project));
    expect(await restored.project.sources!.main!.text()).toBe('original TIFF bytes');
    expect(await restored.project.sources!.samples.s1.control!.text()).toBe('control TIFF bytes');
    expect(restored.view).toEqual(view);
  });
  it('truthfully marks missing original/sample history and local-only model weights', async () => {
    const project = fixture(); delete project.sources;
    const modelView = { ...view, modelName: 'nuclei.onnx', modelRequested: true };
    expect(pathologyCompleteness(project, modelView)).toHaveLength(5);
    const restored = await importPathologyProject((await exportPathologyProject(project, modelView, null)).blob);
    expect(restored.completeness).toHaveLength(5);
    expect(restored.project.sources!.main).toBeNull();
    expect(restored.project.pixels!.data).toEqual(project.pixels!.data);
  });
  it('preserves undefined IF Pearson coefficients as NaN', async () => {
    const project = fixture(); project.profileId = 'if_coloc';
    project.restoredAnalysis = { requestId: 1, overall: metrics, perRoi: [], thresholdUsed: 40, nuclearThresholdUsed: 40, backgroundLevel: 0,
      coloc: { channelA: 0, channelB: 1, pearsonAll: NaN, pearsonMasked: NaN, mandersM1: 0, mandersM2: 0, thresholdA: 40, thresholdB: 40, backgroundA: 0, backgroundB: 0 },
      qc: null, aiUsed: false, aiModelLoaded: null, warnings: [] };
    const restored = await importPathologyProject((await exportPathologyProject(project, view, null)).blob);
    expect(restored.project.restoredAnalysis?.coloc?.pearsonAll).toBeNaN();
  });
  it('restoring a second snapshot uses the recomputed result for its updated settings', async () => {
    const project = fixture();
    project.threshold = { ...project.threshold, mode: 'manual', manualValue: 10 };
    const firstAnalysis: AnalysisResult = {
      requestId: 1, overall: metrics, perRoi: [], thresholdUsed: 10, nuclearThresholdUsed: 40,
      backgroundLevel: 0, overlay: null, coloc: null, qc: null,
      aiUsed: false, aiModelLoaded: null, warnings: [],
    };
    const first = await importPathologyProject((await exportPathologyProject(project, view, firstAnalysis)).blob);
    expect(first.project.restoredAnalysis?.thresholdUsed).toBe(10);
    first.project.threshold = { ...first.project.threshold, manualValue: 20 };
    const recomputed: AnalysisResult = {
      ...firstAnalysis, requestId: 2, thresholdUsed: 20,
      overall: { ...metrics, positiveFraction: 0.25, integratedOpticalDensity: 7 },
    };
    const second = await importPathologyProject((await exportPathologyProject(first.project, view, recomputed)).blob);
    expect(second.project.threshold.manualValue).toBe(20);
    expect(second.project.restoredAnalysis).toMatchObject({
      requestId: 2, thresholdUsed: 20,
      overall: { positiveFraction: 0.25, integratedOpticalDensity: 7 },
    });
    // Re-exporting before another computation still preserves that latest snapshot.
    const third = await importPathologyProject((await exportPathologyProject(second.project, view, null)).blob);
    expect(third.project.restoredAnalysis).toEqual(second.project.restoredAnalysis);
  });
  it.each(['version', 'shape', 'pixels', 'roi', 'reference', 'digest', 'secret'])('rejects invalid %s before returning a project', async (kind) => {
    const blob = (await exportPathologyProject(fixture(), view, null)).blob;
    const corrupted = await mutate(blob, (m) => {
      if (kind === 'version') m.version = 99;
      if (kind === 'shape') m.state.project.threshold.mode = 'unsafe';
      if (kind === 'pixels') m.state.pixels.width = 4096;
      if (kind === 'roi') m.state.project.rois[0].w = -1;
      if (kind === 'reference') m.state.sources.main = 999;
      if (kind === 'digest') m.files[0].sha256 = 'bad';
      if (kind === 'secret') m.state.project.accountToken = 'not-allowed';
    });
    await expect(importPathologyProject(corrupted)).rejects.toThrow();
  });
});
