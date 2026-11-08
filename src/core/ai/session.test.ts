import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('onnxruntime-web', () => ({ env: { wasm: { wasmPaths: '' } }, InferenceSession: { create } }));
beforeEach(() => {
  vi.resetModules(); create.mockReset();
  vi.stubGlobal('self', { location: { href: 'http://localhost:5173/src/core/analysis.worker.ts' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('AI session content identity', () => {
  it('reuses identical content and replaces same-name models whose content changed', async () => {
    const first = { inputNames: ['a'], outputNames: ['b'], run: vi.fn() };
    const second = { ...first };
    create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { ensureSession, cachedModelId, cachedModelName } = await import('./session.ts');
    const bytes = new Uint8Array([1]).buffer;
    expect(await ensureSession('same.onnx', bytes, 'content-a')).toBe(first);
    expect(await ensureSession('renamed.onnx', bytes, 'content-a')).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cachedModelName()).toBe('renamed.onnx');
    expect(await ensureSession('same.onnx', bytes, 'content-b')).toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
    expect(cachedModelId()).toBe('content-b');
  });
  it('does not return another model during a pending load, or reuse it after a load failure', async () => {
    let resolve!: (session: unknown) => void;
    create.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockRejectedValueOnce(new Error('invalid model'));
    const { ensureSession, cachedModelId } = await import('./session.ts');
    const bytes = new ArrayBuffer(1);
    const first = ensureSession('same.onnx', bytes, 'a');
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    const second = ensureSession('same.onnx', bytes, 'b');
    const failure = expect(second).rejects.toThrow('invalid model');
    resolve({ inputNames: [], outputNames: [], run: vi.fn() });
    await first; await failure;
    expect(create).toHaveBeenCalledTimes(2);
    expect(cachedModelId()).toBeNull();
  });
});
