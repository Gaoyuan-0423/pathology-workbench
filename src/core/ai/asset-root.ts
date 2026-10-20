/** Resolve from the worker URL, not a relative string interpreted inside an ORT chunk. */
export function ortAssetRoot(workerHref: string): string {
  const worker = new URL(workerHref);
  const marker = worker.pathname.includes('/assets/') ? '/assets/' : '/src/core/';
  const index = worker.pathname.lastIndexOf(marker);
  if (index < 0) throw new Error('Cannot resolve the application root for local ONNX assets');
  worker.pathname = worker.pathname.slice(0, index + 1) + 'ort/';
  worker.search = '';
  worker.hash = '';
  return worker.href;
}
