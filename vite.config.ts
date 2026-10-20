/// <reference types="vitest/config" />
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const copyStaticAssets: Plugin = {
  name: 'copy-static-assets',
  apply: 'build',
  closeBundle() {
    const root = fileURLToPath(new URL('.', import.meta.url))
    // onnxruntime-web 的 wasm/mjs → dist/ort/（离线推理，不走 CDN）
    const ortSource = root + 'node_modules/onnxruntime-web/dist'
    const ortTarget = root + 'dist/ort'
    mkdirSync(ortTarget, { recursive: true })
    for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
      copyFileSync(ortSource + '/' + file, ortTarget + '/' + file)
    }
    // README 截图 → dist/screenshots/（Pages 上 README 图片可访问）
    const shotsSource = root + 'docs/screenshots'
    const shotsTarget = root + 'dist/screenshots'
    mkdirSync(shotsTarget, { recursive: true })
    for (const file of readdirSync(shotsSource)) {
      copyFileSync(shotsSource + '/' + file, shotsTarget + '/' + file)
    }
  },
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [{ name: "wisplab-build-identity", transformIndexHtml() {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
    return [{ tag: "meta", attrs: { name: "wisplab-build", content: "pathology:" + sha + (dirty ? ":local-changes" : "") }, injectTo: "head" as const }];
  }}, react(), copyStaticAssets],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
