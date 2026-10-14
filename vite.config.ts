/// <reference types="vitest/config" />
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const copyOrtWasm: Plugin = {
  name: 'copy-ort-wasm',
  // onnxruntime-web 的 wasm/mjs 复制到 dist/ort/（离线推理，不走 CDN）
  apply: 'build',
  closeBundle() {
    const root = fileURLToPath(new URL('.', import.meta.url))
    const sourceDir = root + 'node_modules/onnxruntime-web/dist'
    const targetDir = root + 'dist/ort'
    mkdirSync(targetDir, { recursive: true })
    for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
      copyFileSync(sourceDir + '/' + file, targetDir + '/' + file)
    }
  },
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), copyOrtWasm],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
