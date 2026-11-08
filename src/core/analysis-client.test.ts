import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from './types.ts';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
beforeEach(() => { vi.resetModules(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); });

async function request() {
  const client = await import('./analysis-client.ts');
  const p = createEmptyProject();
  return () => client.runAnalysis({} as ImageData, [], p.profileId, p.threshold, p.segmentation, p.calibration, p.coloc, null, { useAi: false, model: null });
}
describe('analysis worker failure delivery', () => {
  it('rejects a request error without stranding later requests', async () => {
    const run = await request();
    const first = run(); const second = run();
    const rejected = expect(first).rejects.toThrow('bad image');
    const worker = FakeWorker.instances[0];
    worker.onmessage!({ data: { requestId: 1, error: 'bad image' } });
    worker.onmessage!({ data: { requestId: 2, thresholdUsed: 91 } });
    await rejected;
    await expect(second).resolves.toMatchObject({ thresholdUsed: 91 });
  });
  it('rejects all pending work on worker failure and recreates the worker for retry', async () => {
    const run = await request();
    const first = run(); const second = run();
    const failures = [expect(first).rejects.toThrow('worker failed'), expect(second).rejects.toThrow('worker failed')];
    const worker = FakeWorker.instances[0];
    worker.onerror!({ message: 'worker failed', preventDefault() {} });
    await Promise.all(failures);
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = run();
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].onmessage!({ data: { requestId: 3, thresholdUsed: 92 } });
    await expect(retry).resolves.toMatchObject({ thresholdUsed: 92 });
  });
  it('rejects unreadable responses and synchronous postMessage failures', async () => {
    const run = await request();
    const first = run();
    const failure = expect(first).rejects.toThrow('分析响应无法读取');
    FakeWorker.instances[0].onmessageerror!();
    await failure;
    const second = run();
    const worker = FakeWorker.instances[1];
    worker.onmessage!({ data: { requestId: 2 } });
    await second;
    worker.postMessage.mockImplementationOnce(() => { throw new Error('clone failed'); });
    await expect(run()).rejects.toThrow('clone failed');
  });
});
