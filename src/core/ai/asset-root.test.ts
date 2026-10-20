import { expect, it } from 'vitest';
import { ortAssetRoot } from './asset-root';
it.each([
  ['app://wisplab/pathology/assets/analysis.worker-hash.js', 'app://wisplab/pathology/ort/'],
  ['https://gaoyuan-0423.github.io/pathology-workbench/assets/analysis.worker-hash.js', 'https://gaoyuan-0423.github.io/pathology-workbench/ort/'],
  ['https://pathology.wisplab.top/assets/analysis.worker-hash.js', 'https://pathology.wisplab.top/ort/'],
  ['http://localhost:4206/src/core/analysis.worker.ts?worker_file&type=module', 'http://localhost:4206/ort/'],
])('resolves local WASM assets for %s', (url, expected) => { expect(ortAssetRoot(url)).toBe(expected); });
