import type { AnalysisResult, IfSampleRecord, MetricKey, ProjectState, StainProfileId } from './core/types';
import { ifAnalysisCheck } from './if-project-validation';
import { clippedIfRoi } from './core/analysis/colocalize';
import { analysisIdentity, currentAnalysis, type AnalysisRun } from './core/analysis-validity';
import { sourceContentId } from './core/source-identity';
import { array, bool, integer, invalid, nullable, number, numeric, object, oneOf, packProject, record, string, unpackProject } from './project-archive';

export type AnalysisSettings = Pick<ProjectState, 'profileId' | 'threshold' | 'segmentation' | 'calibration' | 'coloc' | 'stainOverrides' | 'rois'>;
export type SavedAnalysis = Omit<AnalysisResult, 'overlay'>;
export interface SampleSource { image: File | null; control: File | null; settings: AnalysisSettings; analysis: SavedAnalysis | null; modelName: string | null }
export interface PathologySources { main: File | null; control: File | null; samples: Record<string, SampleSource> }
export interface LocalProject extends ProjectState { sources?: PathologySources; restoredAnalysis?: SavedAnalysis | null; restoredView?: ProjectView }
export interface ProjectView { showOverlay: boolean; statsMetric: MetricKey; lastStainProfile: StainProfileId; modelName: string | null; modelRequested: boolean; modelId?: string | null }
export const emptySources = (): PathologySources => ({ main: null, control: null, samples: {} });
export function analysisSettings(project: ProjectState): AnalysisSettings {
  const { profileId, threshold, segmentation, calibration, coloc, stainOverrides, rois } = project;
  return { profileId, threshold, segmentation, calibration, coloc, stainOverrides, rois };
}
export function savedAnalysis(analysis: AnalysisResult | null): SavedAnalysis | null {
  if (!analysis) return null;
  const { overlay: _overlay, ...data } = analysis;
  return data;
}

const profile = oneOf('h_dab', 'h_eosin', 'masson', 'if_coloc');
const threshold = object({ mode: oneOf('auto', 'manual', 'control'), method: oneOf('otsu', 'triangle', 'mean_sd', 'kapur'), manualValue: number, backgroundPercentile: number, controlFalsePositiveRate: number, controlThreshold: nullable(number), controlImageName: nullable(string) });
const segmentation = object({ minAreaPx: number, maxAreaPx: number, minCircularity: number });
const calibration = object({ mpp: nullable(number) });
const coloc = object({ channelA: oneOf(0, 1, 2), channelB: oneOf(0, 1, 2), thresholdMode: oneOf('auto', 'manual'), manualA: number, manualB: number, backgroundPercentile: number });
const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(number);
const pair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(vec);
const overrides = object({}, { h_dab: pair, h_eosin: pair, masson: pair, if_coloc: pair });
const roi = object({ id: string, name: string, x: number, y: number, w: number, h: number });
const settingsFields = { profileId: profile, threshold, segmentation, calibration, coloc, stainOverrides: overrides, rois: array(roi, 10000) };
const settingsCheck = object(settingsFields);
const metrics = object({ roiId: nullable(string), roiName: string, pixelCount: integer(), positiveFraction: number, positiveNuclei: integer(), totalNuclei: integer(), labelingIndex: nullable(number), integratedOpticalDensity: number, meanOpticalDensity: nullable(number), borderNuclei: integer(), estimatedTotalCount: nullable(number), densityPerMm2: nullable(number), hScore: nullable(number) });
const analysisCheck = object({ requestId: integer(), overall: metrics, perRoi: array(metrics, 10000), thresholdUsed: number, nuclearThresholdUsed: number, backgroundLevel: number,
  coloc: nullable(object({ channelA: number, channelB: number, pearsonAll: numeric, pearsonMasked: numeric, mandersM1: number, mandersM2: number, thresholdA: number, thresholdB: number, backgroundA: number, backgroundB: number })),
  qc: nullable(object({ tissueFraction: number, saturatedFraction: number, otsuSeparation: number, rejectedByArea: integer(), rejectedByCircularity: integer(), borderFraction: number })), aiUsed: bool, aiModelLoaded: nullable(string), warnings: array(string) }, { aiModelId: nullable(string), aiRequested: bool, aiRequestedModelId: nullable(string), ifAnalysis: nullable(ifAnalysisCheck) });
const imageCheck = object({ name: string, sourceType: oneOf('PNG', 'JPEG', 'TIFF', 'TIFF16'), sourceWidth: integer(1), sourceHeight: integer(1), workingWidth: integer(1, 4096), workingHeight: integer(1, 4096), workingScale: number, bitsPerSample: oneOf(8, 16) }, { note: string });
const ifSampleShape = object({ id: string, name: string, group: string, imageName: string, addedAt: number, sourceId: string, profileId: oneOf('if_coloc'), image: imageCheck, config: coloc, analysis: ifAnalysisCheck }, { excludedFromStatistics: bool });
const ifSampleCheck = (value: unknown): boolean => {
  if (!ifSampleShape(value)) return false;
  const sample = value as IfSampleRecord;
  if (sample.config.backgroundPercentile < 0 || sample.config.backgroundPercentile > 100) return false;
  if (sample.config.thresholdMode === 'manual' &&
    (Math.min(255, Math.max(0, Math.round(sample.config.manualA))) !== sample.analysis.overall.thresholdA ||
     Math.min(255, Math.max(0, Math.round(sample.config.manualB))) !== sample.analysis.overall.thresholdB)) return false;
  return Boolean(sample.id.trim() && sample.sourceId.trim()) && sample.image.workingWidth === sample.analysis.imageWidth && sample.image.workingHeight === sample.analysis.imageHeight
    && sample.config.channelA === sample.analysis.overall.channelA && sample.config.channelB === sample.analysis.overall.channelB;
};
const experimentalDesignCheck = object({ kind: oneOf('independent', 'paired', 'repeated'), confirmed: bool, controlGroup: string,
  aggregation: oneOf('equal_sections'), assignments: array(object({ sampleId: string, sourceId: string, unitId: string, sectionId: string, fieldId: string, group: string }), 10000) });
const ifExperimentalDesignCheck = object({ kind: oneOf('independent', 'paired', 'repeated'), confirmed: bool, controlGroup: string,
  aggregation: oneOf('equal_sections'), metric: oneOf('pearsonAll', 'pearsonMasked', 'mandersM1', 'mandersM2'),
  regionMode: oneOf('whole_image', 'equal_rois'), assignments: array(object({ sampleId: string, sourceId: string, unitId: string, sectionId: string, fieldId: string, group: string, roiIds: array(string, 10000) }), 10000) });
const projectCheck = object({ version: oneOf(1), image: nullable(imageCheck), ...settingsFields,
  samples: array(object({ id: string, name: string, group: string, imageName: string, addedAt: number, metrics },
    { sourceId: string, profileId: profile, excludedFromStatistics: bool }), 10000) }, { experimentalDesign: experimentalDesignCheck, ifSamples: array(ifSampleCheck, 10000), ifExperimentalDesign: ifExperimentalDesignCheck });
const viewCheck = object({ showOverlay: bool, statsMetric: oneOf('positiveFraction', 'labelingIndex', 'hScore', 'integratedOpticalDensity', 'meanOpticalDensity', 'densityPerMm2'), lastStainProfile: profile, modelName: nullable(string), modelRequested: bool }, { modelId: nullable(string) });
type SampleRef = Omit<SampleSource, 'image' | 'control'> & { image: number | null; control: number | null };
interface PackageState {
  project: Omit<ProjectState, 'pixels'>;
  pixels: { file: number; width: number; height: number } | null;
  sources: { main: number | null; control: number | null; samples: Record<string, SampleRef> };
  view: ProjectView;
  analysis: SavedAnalysis | null;
  restoredAnalysis: SavedAnalysis | null;
  completeness: string[];
}
const fileRef = nullable(integer(0, 2999));
const packageCheck = object({ project: projectCheck, pixels: nullable(object({ file: integer(0, 2999), width: integer(1, 4096), height: integer(1, 4096) })),
  sources: object({ main: fileRef, control: fileRef, samples: record(object({ image: fileRef, control: fileRef, settings: settingsCheck, analysis: nullable(analysisCheck), modelName: nullable(string) }), 10000) }),
  view: viewCheck, analysis: nullable(analysisCheck), restoredAnalysis: nullable(analysisCheck), completeness: array(string, 30000) });

export function pathologyCompleteness(project: LocalProject, view: ProjectView): string[] {
  const gaps: string[] = [];
  if (project.image && !project.sources?.main) gaps.push('缺当前原始图；已保留工作像素 / Original image missing; working pixels retained');
  if (project.profileId !== 'if_coloc' && project.threshold.controlImageName && !project.sources?.control) gaps.push('缺原始对照片；已保留标定阈值 / Original control missing; calibrated threshold retained');
  for (const sample of [...project.samples, ...(project.ifSamples ?? [])]) {
    const source = project.sources?.samples[sample.id];
    if (!source?.image) gaps.push(`缺样本原图 / Missing sample source: ${sample.name}`);
    if (!source) gaps.push(`缺历史样本分析设置 / Missing historical sample settings: ${sample.name}`);
    if (source?.settings.profileId !== 'if_coloc' && source?.settings.threshold.controlImageName && !source.control) gaps.push(`缺样本对照片 / Missing sample control: ${sample.name}`);
  }
  if (view.modelName || view.modelRequested) gaps.push('AI 模型权重不随项目上传，需在本机重新载入 / AI model weights are excluded; reload locally');
  return gaps;
}

export async function exportPathologyProject(project: LocalProject, view: ProjectView, run: AnalysisRun | null): Promise<{ blob: Blob; completeness: string[] }> {
  validateCurrentIfRois(project);
  await validateSampleSources(project);
  const { pixels, sources = emptySources(), restoredAnalysis: _restoredAnalysis, restoredView: _restoredView, ...state } = project;
  const analysis = currentAnalysis(run, analysisIdentity(project, view));
  // Legacy packages did not bind results to their generating inputs/settings.
  // Their imported result remains unverified history in memory; re-export requires
  // a newly completed, matched run. Do not infer provenance from current settings.
  const restoredAnalysis = null;
  if (!projectCheck(state) || !viewCheck(view)) invalid();
  const files: File[] = [];
  const addFile = (file: File | null): number | null => {
    if (!file) return null;
    const existing = files.indexOf(file);
    return existing < 0 ? files.push(file) - 1 : existing;
  };
  const allSamples = [...project.samples, ...(project.ifSamples ?? [])];
  if (new Set(allSamples.map((sample) => sample.id)).size !== allSamples.length) invalid();
  const sampleSources = Object.fromEntries(allSamples.flatMap((sample) => {
    const source = sources.samples[sample.id];
    return source ? [[sample.id, { ...source, image: addFile(source.image), control: addFile(source.control) }]] : [];
  }));
  const sourceRefs = { main: addFile(sources.main), control: addFile(sources.control), samples: sampleSources };
  const pixelsRef = pixels ? { file: addFile(new File([Uint8Array.from(pixels.data).buffer], 'working.rgba'))!, width: pixels.width, height: pixels.height } : null;
  const completeness = pathologyCompleteness(project, view);
  const packageState: PackageState = { project: state, pixels: pixelsRef, sources: sourceRefs, view, analysis: savedAnalysis(analysis), restoredAnalysis, completeness };
  if (!packageCheck(packageState)) invalid();
  return { blob: await packProject('pathology', packageState, files), completeness };
}

export async function importPathologyProject(blob: Blob): Promise<{ project: LocalProject; view: ProjectView; completeness: string[] }> {
  const unpacked = await unpackProject(blob, 'pathology', packageCheck);
  const state = unpacked.state as PackageState;
  const used = new Set<number>();
  const file = (index: number | null): File | null => {
    if (index === null) return null;
    if (!unpacked.files[index]) invalid();
    used.add(index);
    return unpacked.files[index];
  };
  let pixels: ImageData | null = null;
  if (state.pixels) {
    const bytes = await file(state.pixels.file)!.arrayBuffer();
    if (bytes.byteLength !== state.pixels.width * state.pixels.height * 4 || !state.project.image || state.project.image.workingWidth !== state.pixels.width || state.project.image.workingHeight !== state.pixels.height) invalid();
    pixels = new ImageData(new Uint8ClampedArray(bytes), state.pixels.width, state.pixels.height);
  } else if (state.project.image) invalid();
  const samples = Object.fromEntries(Object.entries(state.sources.samples).map(([id, source]) => [id, { ...source, image: file(source.image), control: file(source.control) }]));
  const sources: PathologySources = { main: file(state.sources.main), control: file(state.sources.control), samples };
  const allSamples = [...state.project.samples, ...(state.project.ifSamples ?? [])];
  const ids = new Set(allSamples.map((sample) => sample.id));
  if (ids.size !== allSamples.length || Object.keys(samples).some((id) => !ids.has(id)) || used.size !== unpacked.files.length) invalid();
  if (state.project.profileId === 'if_coloc') validateCurrentIfRois({ ...state.project, pixels });
  else for (const roi of state.project.rois) if (roi.w <= 0 || roi.h <= 0 || roi.x < 0 || roi.y < 0 || !pixels || roi.x + roi.w > pixels.width + 1 || roi.y + roi.h > pixels.height + 1) invalid();
  // Keep imported values as history only. Neither legacy nor new packages are
  // promoted to a current result without recomputation in this workspace.
  const project: LocalProject = { ...state.project, pixels, sources, restoredAnalysis: state.analysis ?? state.restoredAnalysis };
  await validateSampleSources(project);
  return { project, view: state.view, completeness: pathologyCompleteness(project, state.view) };
}

async function validateSampleSources(project: LocalProject): Promise<void> {
  for (const sample of [...project.samples, ...(project.ifSamples ?? [])]) {
    const source = project.sources?.samples[sample.id];
    if (source && sample.profileId && sample.profileId !== source.settings.profileId) invalid();
    if (source?.image && sample.sourceId?.startsWith('sha256:') && sample.sourceId !== await sourceContentId(source.image)) invalid();
  }
  for (const sample of project.ifSamples ?? []) {
    if (!ifSampleCheck(sample)) invalid();
    const source = project.sources?.samples[sample.id];
    if (!source) continue;
    if (Object.keys(sample.config).some((key) => sample.config[key as keyof typeof sample.config] !== source.settings.coloc[key as keyof typeof sample.config])) invalid();
    if (source.analysis?.ifAnalysis && stableJson(source.analysis.ifAnalysis) !== stableJson(sample.analysis)) invalid();
    const regions = sample.analysis.perRoi;
    if (source.settings.rois.length !== regions.length || regions.some((r) => !source.settings.rois.some((roi) => roi.id === r.roiId && roi.name === r.roiName))) invalid();
    for (const r of regions) {
      const requested = source.settings.rois.find((roi) => roi.id === r.roiId)!;
      const expected = clippedIfRoi(requested, sample.analysis.imageWidth, sample.analysis.imageHeight);
      if (Object.keys(expected).some((key) => expected[key as keyof typeof expected] !== r.rect[key as keyof typeof expected])) invalid();
    }
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}

function validateCurrentIfRois(project: ProjectState): void {
  if (project.profileId !== 'if_coloc') return;
  const pixels = project.pixels;
  if (project.rois.length && !pixels) invalid();
  const ids = new Set<string>();
  for (const roi of project.rois) {
    if (!roi.id.trim() || ids.has(roi.id)) invalid();
    ids.add(roi.id);
    try { clippedIfRoi(roi, pixels!.width, pixels!.height); } catch { invalid(); }
  }
}
