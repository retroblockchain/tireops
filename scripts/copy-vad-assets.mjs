#!/usr/bin/env node
// Copies VAD runtime assets from node_modules into public/ after every
// `npm install`. The VAD library (@ricky0123/vad-web) and its
// onnxruntime-web dependency ship .mjs JavaScript loaders + .wasm
// binaries that must be fetchable from the app's static origin at
// runtime. Next.js serves public/ as-is, so we copy the needed assets
// there.
//
// Why this exists:
//   The browser-side hands-free flow needs /vad.worklet.bundle.min.js,
//   /silero_vad_v5.onnx, and /ort-wasm/ort-wasm-simd-threaded(.jsep|.asyncify|.jspi)?(.mjs|.wasm)
//   to all return 200. Without the .mjs loaders, onnxruntime-web fails
//   to initialize with "Failed to fetch dynamically imported module".
//
// Why automated:
//   Hand-copying from node_modules is fragile — `npm update` bumps
//   onnxruntime-web but doesn't refresh public/. This script keeps the
//   two in sync. Wired up via the postinstall hook in package.json.
//
// Safe to run multiple times — it just overwrites. If the source
// packages aren't installed yet (rare partial-install scenarios), the
// script logs a warning and exits 0 so the outer npm install succeeds.

import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const vadDist = join(repoRoot, 'node_modules', '@ricky0123', 'vad-web', 'dist');
const ortDist = join(repoRoot, 'node_modules', 'onnxruntime-web', 'dist');
const publicDir = join(repoRoot, 'public');
const publicOrtDir = join(publicDir, 'ort-wasm');

if (!existsSync(vadDist) || !existsSync(ortDist)) {
  console.warn('[copy-vad-assets] source packages not installed — skipping. Will run again on next `npm install`.');
  process.exit(0);
}

// Files from @ricky0123/vad-web/dist/ → public/
const VAD_FILES = [
  'vad.worklet.bundle.min.js',
  'silero_vad_v5.onnx',
  'silero_vad_legacy.onnx',
];

// Files from onnxruntime-web/dist/ → public/ort-wasm/
// We copy every execution-provider variant the runtime might select.
// Each needs BOTH .mjs (the JS loader) and .wasm (the binary) — missing
// either is a runtime crash at hands-free start.
const ORT_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
];

mkdirSync(publicDir, { recursive: true });
mkdirSync(publicOrtDir, { recursive: true });

let copied = 0;
let totalBytes = 0;

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function copyOne(src, dst) {
  if (!existsSync(src)) {
    console.error(`[copy-vad-assets] MISSING source file: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dst);
  const size = statSync(dst).size;
  totalBytes += size;
  copied++;
  // Verbose log so the inventory is auditable on every install.
  const srcRel = relative(repoRoot, src).replace(/\\/g, '/');
  const dstRel = relative(repoRoot, dst).replace(/\\/g, '/');
  console.log(`[copy-vad-assets] ${srcRel}  ->  ${dstRel}  (${fmtSize(size)})`);
}

console.log('[copy-vad-assets] copying VAD runtime assets...');
for (const name of VAD_FILES) copyOne(join(vadDist, name), join(publicDir, name));
for (const name of ORT_FILES) copyOne(join(ortDist, name), join(publicOrtDir, name));
console.log(`[copy-vad-assets] done. ${copied} files, ${fmtSize(totalBytes)} total.`);
