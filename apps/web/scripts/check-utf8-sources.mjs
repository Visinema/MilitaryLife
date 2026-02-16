import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WEB_ROOT = join(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'lib', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage']);
const CHECK_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.css']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

function hasValidExt(filename) {
  for (const ext of CHECK_EXT) {
    if (filename.endsWith(ext)) return true;
  }
  return false;
}

async function walk(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!hasValidExt(entry.name)) continue;
    out.push(join(dir, entry.name));
  }
}

async function main() {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    await walk(join(WEB_ROOT, dir), files);
  }

  const invalid = [];
  for (const file of files) {
    const bytes = await readFile(file);
    try {
      utf8.decode(bytes);
    } catch {
      invalid.push(relative(WEB_ROOT, file));
    }
  }

  if (invalid.length > 0) {
    console.error('[check-utf8] ditemukan file non-UTF8:');
    for (const item of invalid) {
      console.error(` - ${item}`);
    }
    process.exit(1);
  }

  console.info(`[check-utf8] ok (${files.length} file)`);
}

main().catch((error) => {
  console.error('[check-utf8] gagal dijalankan', error);
  process.exit(1);
});
