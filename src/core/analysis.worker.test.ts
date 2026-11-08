import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from './types.ts';
import type { AnalysisRequest, AnalysisResponse } from './analysis.worker.ts';

const mocks = vi.hoisted(() => ({ stain: vi.fn(), coloc: vi.fn(), session: vi.fn() }));
vi.mock('./analysis/engine.ts', () => ({ analyzeStainImage: mocks.stain, analyzeColocImage: mocks.coloc }));
vi.mock('./image/color.ts', () => ({ buildStainMatrix: () => [], extractStainChannel: () => new Float32Array(1) }));
vi.mock('./ai/prepost.ts', () => ({ probToMask: () => new Uint8Array(1) }));
vi.mock('./ai/session.ts', () => ({ ensureSession: mocks.session, cachedModelName: () => 'test.onnx', cachedModelId: () => 'a', inferNucleiProb: async () => new Float32Array(1) }));
beforeEach(() => {
  vi.resetModules(); mocks.stain.mockReset(); mocks.coloc.mockReset(); mocks.session.mockReset();
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray; width: number; height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height; }
  });
});
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const responses: AnalysisResponse[] = [];
  const scope = { onmessage: null as ((event: { data: AnalysisRequest }) => void) | null, postMessage: (response: AnalysisResponse) => responses.push(response) };
  vi.stubGlobal('self', scope);
  await import('./analysis.worker.ts');
  const project = createEmptyProject();
  const request: AnalysisRequest = { ...project, requestId: 1, pixels: { width: 1, height: 1 } as ImageData, stainOverride: null, ai: { useAi: false, model: null } };
  return { scope, responses, request };
}
describe('worker request boundaries', () => {
  it('passes rectangular ROIs to IF analysis and returns its dedicated results', async () => {
    const { scope, responses, request } = await setup();
    const rois = [{ id: 'r1', name: 'ROI 1', x: 0, y: 0, w: 1, h: 1 }];
    const ifAnalysis = { schemaVersion: 'wisplab.if-colocalization/v1', normalizationScope: 'whole_image', imageWidth: 1, imageHeight: 1, overall: { pearsonAll: null }, perRoi: [{ roiId: 'r1', pearsonAll: null }] };
    mocks.coloc.mockReturnValue({ overall: {}, overlayRgba: new Uint8Array(4), coloc: {}, ifAnalysis, warnings: [] });
    scope.onmessage!({ data: { ...request, profileId: 'if_coloc', rois } });
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(mocks.coloc).toHaveBeenCalledWith(request.pixels, request.coloc, rois);
    expect(responses[0]).toMatchObject({ ifAnalysis, perRoi: [], aiUsed: false });
  });
  it('returns a structured error and continues processing subsequent requests', async () => {
    const { scope, responses, request } = await setup();
    mocks.coloc.mockImplementationOnce(() => { throw new Error('bad pixels'); }).mockReturnValue({ overall: {}, overlayRgba: new Uint8Array(4), coloc: {}, warnings: [] });
    scope.onmessage!({ data: { ...request, profileId: 'if_coloc' } });
    scope.onmessage!({ data: { ...request, requestId: 2, profileId: 'if_coloc' } });
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(responses[0]).toEqual({ requestId: 1, error: 'bad pixels' });
    expect(responses[1]).toMatchObject({ requestId: 2, aiUsed: false });
  });
  it('keeps a second request out of the shared model session until the first finishes', async () => {
    const { scope, responses, request } = await setup();
    let release!: () => void;
    mocks.session.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    mocks.stain.mockReturnValue({ overall: {}, perRoi: [], overlayRgba: new Uint8Array(4), warnings: [] });
    const ai = { useAi: true, model: { name: 'test.onnx', id: 'a', bytes: new ArrayBuffer(1) } };
    scope.onmessage!({ data: { ...request, ai } });
    scope.onmessage!({ data: { ...request, requestId: 2, ai: { ...ai, model: { ...ai.model, id: 'b' } } } });
    await vi.waitFor(() => expect(mocks.session).toHaveBeenCalledTimes(1));
    expect(responses).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(mocks.session.mock.calls.map((args) => args[2])).toEqual(['a', 'b']);
    expect(responses.map((response) => response.requestId)).toEqual([1, 2]);
    expect(responses.every((response) => 'ifAnalysis' in response && response.ifAnalysis === null)).toBe(true);
  });
});
