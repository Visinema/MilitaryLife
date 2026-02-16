import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function ensureWasmFallbackBundle() {
  let nextDirectory;
  let wasmPackageDirectory;

  try {
    nextDirectory = path.dirname(require.resolve('next/package.json'));
    wasmPackageDirectory = path.dirname(require.resolve('@next/swc-wasm-nodejs/package.json'));
  } catch {
    return;
  }

  const wasmTargetDirectory = path.join(nextDirectory, 'wasm', '@next', 'swc-wasm-nodejs');
  const wasmEntry = path.join(wasmTargetDirectory, 'wasm.js');

  if (existsSync(wasmEntry)) {
    return;
  }

  mkdirSync(wasmTargetDirectory, { recursive: true });
  cpSync(wasmPackageDirectory, wasmTargetDirectory, { recursive: true, force: true });
}

process.env.npm_config_user_agent = 'npm';
process.env.NEXT_DISABLE_SWC_NATIVE = '1';
ensureWasmFallbackBundle();

const nextCli = require.resolve('next/dist/bin/next');
const result = spawnSync(process.execPath, [nextCli, 'build'], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
