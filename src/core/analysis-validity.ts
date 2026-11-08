import type { AnalysisResult, ProjectState } from './types.ts';

/** Working pixels are immutable in the app; replacing an image changes this reference.
 * Settings are copied into a value key so later object edits cannot rewrite history.
 * Display options and the sample library do not change the current image measurement.
 */
export interface AnalysisIdentity {
  pixels: ImageData | null;
  settingsKey: string;
  modelRequested: boolean;
  modelId: string | null;
}

export interface AnalysisRun {
  ticket: number;
  identity: AnalysisIdentity;
  status: 'running' | 'ready' | 'failed';
  result: AnalysisResult | null;
  error: string | null;
}

export function analysisIdentity(
  project: ProjectState,
  ai: { modelRequested: boolean; modelId?: string | null },
): AnalysisIdentity {
  const { image, profileId, rois, threshold, segmentation, calibration, coloc, stainOverrides } = project;
  return {
    pixels: project.pixels,
    settingsKey: JSON.stringify({ image, profileId, rois, threshold, segmentation, calibration, coloc, stainOverrides }),
    modelRequested: ai.modelRequested,
    modelId: ai.modelId ?? null,
  };
}

export function sameAnalysisIdentity(a: AnalysisIdentity, b: AnalysisIdentity): boolean {
  return a.pixels === b.pixels && a.settingsKey === b.settingsKey
    && a.modelRequested === b.modelRequested && a.modelId === b.modelId;
}

/** The single gate used before displaying, exporting, or saving a current result. */
export function currentAnalysis(run: AnalysisRun | null, identity: AnalysisIdentity): AnalysisResult | null {
  return identity.pixels && run?.status === 'ready' && sameAnalysisIdentity(run.identity, identity)
    ? run.result : null;
}

export function startAnalysis(ticket: number, identity: AnalysisIdentity): AnalysisRun {
  return { ticket, identity, status: 'running', result: null, error: null };
}

/** A late completion/failure cannot replace the state of a newer request. */
export function finishAnalysis(run: AnalysisRun | null, ticket: number, outcome: AnalysisResult | Error): AnalysisRun | null {
  if (!run || run.ticket !== ticket || run.status !== 'running') return run;
  if (!(outcome instanceof Error) && outcome.aiUsed
    && (!run.identity.modelRequested || !run.identity.modelId || outcome.aiModelId !== run.identity.modelId)) {
    outcome = new Error('分析返回的 AI 模型身份与当前请求不一致。');
  }
  return outcome instanceof Error
    ? { ...run, status: 'failed', result: null, error: outcome.message }
    : { ...run, status: 'ready', result: outcome, error: null };
}

export async function modelContentId(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
