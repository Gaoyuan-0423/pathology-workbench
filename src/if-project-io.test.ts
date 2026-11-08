import { beforeAll, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { analyzeColocImage } from './core/analysis/engine';
import { analysisIdentity, finishAnalysis, startAnalysis } from './core/analysis-validity';
import { sourceContentId } from './core/source-identity';
import { ifSampleStatistics } from './core/if-statistics';
import { createEmptyProject, type AnalysisResult } from './core/types';
import { decodeJson, encodeJson } from './project-archive';
import { analysisSettings, emptySources, exportPathologyProject, importPathologyProject, savedAnalysis, type LocalProject, type ProjectView } from './project-io';

beforeAll(() => {
  if (!globalThis.ImageData) globalThis.ImageData = class {
    data: Uint8ClampedArray; width: number; height: number; colorSpace = 'srgb' as const;
    constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height; }
  } as unknown as typeof ImageData;
});
const view: ProjectView = { showOverlay: true, statsMetric: 'positiveFraction', lastStainProfile: 'h_eosin', modelName: null, modelRequested: false };
async function fixture() {
  const project: LocalProject = { ...createEmptyProject(), profileId: 'if_coloc',
    pixels: new ImageData(new Uint8ClampedArray([10,20,0,255,20,40,0,255,30,60,0,255,40,80,0,255, 0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255]), 4, 2),
    image: { name: 'synthetic.png', sourceType: 'PNG', sourceWidth: 4, sourceHeight: 2, workingWidth: 4, workingHeight: 2, workingScale: 1, bitsPerSample: 8 },
    coloc: { channelA: 0, channelB: 1, thresholdMode: 'manual', manualA: 15, manualB: 30, backgroundPercentile: 0 },
    rois: [{ id: 'signal', name: '区域甲', x: 0, y: 0, w: 4, h: 1 }, { id: 'empty-signal', name: '区域乙', x: 0, y: 1, w: 4, h: 1 }], sources: emptySources() };
  // The byte attachment tests archive identity. Pixel recomputation uses the exact RGBA fixture.
  const file = new File(['fixed synthetic source attachment'], 'synthetic.png', { type: 'image/png' });
  project.sources!.main = file;
  const engine = analyzeColocImage(project.pixels!, project.coloc, project.rois);
  const result: AnalysisResult = { requestId: 1, overall: engine.overall, perRoi: [], coloc: engine.coloc, ifAnalysis: engine.ifAnalysis,
    thresholdUsed: engine.coloc.thresholdA, nuclearThresholdUsed: engine.coloc.thresholdB, backgroundLevel: engine.coloc.backgroundA,
    overlay: null, qc: null, aiUsed: false, aiModelLoaded: null, warnings: engine.warnings };
  project.ifSamples = [{ id: 'if-1', name: '保存样本', group: '对照甲', imageName: file.name, addedAt: 1, sourceId: await sourceContentId(file), profileId: 'if_coloc', image: project.image!, config: { ...project.coloc }, analysis: engine.ifAnalysis }];
  project.sources!.samples['if-1'] = { image: file, control: null, settings: structuredClone(analysisSettings(project)), analysis: savedAnalysis(result), modelName: null };
  const run = finishAnalysis(startAnalysis(1, analysisIdentity(project, view)), 1, result);
  return { project, run, result };
}
async function mutate(blob: Blob, change: (state: any) => void) {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = decodeJson(strFromU8(entries['manifest.json'])); change(manifest);
  entries['manifest.json'] = strToU8(encodeJson(manifest));
  return new Blob([Uint8Array.from(zipSync(entries)).buffer]);
}
describe('IF project measurement records', () => {
  it('preserves IF design, selected ROI identities and exclusions without inventing legacy confirmation', async () => {
    const { project } = await fixture();
    project.ifExperimentalDesign = { kind: 'independent', confirmed: true, controlGroup: '对照甲', aggregation: 'equal_sections',
      metric: 'pearsonMasked', regionMode: 'equal_rois', assignments: [{ sampleId: 'if-1', sourceId: project.ifSamples![0].sourceId,
        unitId: '动物甲', sectionId: '切片甲', fieldId: '视野甲', group: '对照甲', roiIds: ['signal'] }] };
    const before = ifSampleStatistics(project.ifSamples!, project.ifExperimentalDesign);
    const restored = await importPathologyProject((await exportPathologyProject(project, view, null)).blob);
    expect(restored.project.ifExperimentalDesign).toEqual(project.ifExperimentalDesign);
    expect(ifSampleStatistics(restored.project.ifSamples!, restored.project.ifExperimentalDesign)).toEqual(before);
    expect(before.inference).toBe(false); // One declared unit does not make group inference eligible.
    project.ifSamples![0].excludedFromStatistics = true;
    project.ifExperimentalDesign.confirmed = false;
    const excluded = await importPathologyProject((await exportPathologyProject(project, view, null)).blob);
    expect(excluded.project.ifSamples![0].excludedFromStatistics).toBe(true);
    expect(excluded.project.ifExperimentalDesign?.confirmed).toBe(false);
    delete project.ifExperimentalDesign;
    const legacy = await importPathologyProject((await exportPathologyProject(project, view, null)).blob);
    expect(legacy.project.ifExperimentalDesign).toBeUndefined();
  });
  it.each(['metric', 'regionMode', 'roiIds', 'confirmed', 'excluded'])('rejects malformed IF design %s without dropping it', async (kind) => {
    const { project } = await fixture();
    project.ifExperimentalDesign = { kind: 'independent', confirmed: false, controlGroup: '对照甲', aggregation: 'equal_sections',
      metric: 'pearsonMasked', regionMode: 'whole_image', assignments: [{ sampleId: 'if-1', sourceId: project.ifSamples![0].sourceId,
        unitId: 'u', sectionId: 's', fieldId: 'f', group: '对照甲', roiIds: [] }] };
    const packed = await exportPathologyProject(project, view, null);
    const bad = await mutate(packed.blob, (m) => {
      const d = m.state.project.ifExperimentalDesign;
      if (kind === 'metric') d.metric = 'positiveFraction';
      if (kind === 'regionMode') d.regionMode = 'pooled_pixels';
      if (kind === 'roiIds') d.assignments[0].roiIds = [null];
      if (kind === 'confirmed') d.confirmed = 'yes';
      if (kind === 'excluded') m.state.project.ifSamples[0].excludedFromStatistics = 'false';
    });
    await expect(importPathologyProject(bad)).rejects.toThrow();
  });
  it('retains syntactically valid conflicting declarations as invalid rather than granting inference', async () => {
    const { project } = await fixture();
    project.ifExperimentalDesign = { kind: 'independent', confirmed: true, controlGroup: '对照甲', aggregation: 'equal_sections',
      metric: 'pearsonMasked', regionMode: 'equal_rois', assignments: [{ sampleId: 'if-1', sourceId: project.ifSamples![0].sourceId,
        unitId: 'u', sectionId: 's', fieldId: 'f', group: '对照甲', roiIds: ['missing-roi'] }] };
    const restored = await importPathologyProject((await exportPathologyProject(project, view, null)).blob);
    const stats = ifSampleStatistics(restored.project.ifSamples!, restored.project.ifExperimentalDesign);
    expect(stats.aggregation.designStatus).toBe('invalid');
    expect(stats.inference).toBe(false);
    expect(stats.report.omnibusParametric).toBeNull();
    expect(restored.project.ifExperimentalDesign?.assignments[0].roiIds).toEqual(['missing-roi']);
  });
  it('round-trips source/config/ROI/null semantics and recomputes identical canonical results', async () => {
    const { project, run, result } = await fixture();
    const packed = await exportPathologyProject(project, view, run);
    expect(packed.completeness).toEqual([]);
    const restored = await importPathologyProject(packed.blob);
    expect(restored.project.ifSamples).toEqual(project.ifSamples);
    expect(restored.project.restoredAnalysis?.ifAnalysis).toEqual(result.ifAnalysis);
    expect(restored.project.restoredAnalysis?.ifAnalysis?.perRoi[1].mandersM1).toBeNull();
    expect(await restored.project.sources!.samples['if-1'].image!.text()).toBe('fixed synthetic source attachment');
    const recomputed = analyzeColocImage(restored.project.pixels!, restored.project.coloc, restored.project.rois);
    expect(recomputed.ifAnalysis).toEqual(result.ifAnalysis);
    // Imported current-result history is not re-exported as a fresh analysis.
    const again = await importPathologyProject((await exportPathologyProject(restored.project, view, null)).blob);
    expect(again.project.restoredAnalysis).toBeNull();
    expect(again.project.ifSamples).toEqual(project.ifSamples);
    expect(again.project.samples).toEqual([]);
  });
  it.each(['counts', 'scope', 'null-reason', 'threshold', 'source-id', 'source-config', 'manual-result', 'background-range', 'roi-geometry', 'duplicate-id', 'coefficient', 'source-result'])('rejects inconsistent %s in archived IF records', async (kind) => {
    const { project, run } = await fixture();
    const packed = await exportPathologyProject(project, view, run);
    const bad = await mutate(packed.blob, (m) => {
      const sample = m.state.project.ifSamples[0];
      const roi = sample.analysis.perRoi[0];
      if (kind === 'counts') roi.pixelCount += 1;
      if (kind === 'scope') sample.analysis.normalizationScope = 'per_roi';
      if (kind === 'null-reason') sample.analysis.perRoi[1].undefinedReasons = [];
      if (kind === 'threshold') roi.thresholdA += 1;
      if (kind === 'source-id') sample.sourceId = 'sha256:wrong';
      if (kind === 'source-config') m.state.sources.samples['if-1'].settings.coloc.manualA = 123;
      if (kind === 'manual-result') sample.config.manualA = m.state.sources.samples['if-1'].settings.coloc.manualA = 123;
      if (kind === 'background-range') sample.config.backgroundPercentile = m.state.sources.samples['if-1'].settings.coloc.backgroundPercentile = -1;
      if (kind === 'roi-geometry') m.state.sources.samples['if-1'].settings.rois[0].y = 1;
      if (kind === 'duplicate-id') sample.analysis.perRoi.push(roi);
      if (kind === 'coefficient') roi.mandersM1 = 0;
      if (kind === 'source-result') m.state.sources.samples['if-1'].analysis.ifAnalysis.perRoi[0].pearsonAll = 0.5;
    });
    await expect(importPathologyProject(bad)).rejects.toThrow();
  });
  it('round-trips clipped and outside IF requests using the same geometry rule as the engine', async () => {
    const { project } = await fixture();
    project.rois = [{ id: 'clipped', name: 'clipped', x: -1, y: -1, w: 3, h: 2 }, { id: 'outside', name: 'outside', x: 20, y: 0, w: 2, h: 1 }];
    const expected = analyzeColocImage(project.pixels!, project.coloc, project.rois).ifAnalysis;
    const restored = await importPathologyProject((await exportPathologyProject(project, view, null)).blob);
    expect(restored.project.rois).toEqual(project.rois);
    expect(analyzeColocImage(restored.project.pixels!, restored.project.coloc, restored.project.rois).ifAnalysis).toEqual(expected);
    expect(expected.perRoi[1].pixelCount).toBe(0);
    project.rois[1].id = 'clipped';
    await expect(exportPathologyProject(project, view, null)).rejects.toThrow();
  });
  it('preserves a descriptive record with missing source attachments and reports the gap', async () => {
    const { project } = await fixture();
    project.sources = emptySources();
    const restored = await importPathologyProject((await exportPathologyProject(project, view, null)).blob);
    expect(restored.project.ifSamples).toEqual(project.ifSamples);
    expect(restored.completeness.some((gap) => gap.includes('Missing sample source'))).toBe(true);
    expect(restored.completeness.some((gap) => gap.includes('Missing historical sample settings'))).toBe(true);
  });
});
