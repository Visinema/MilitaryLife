import { execSync } from 'node:child_process';

function positiveIntegerString(input) {
  const trimmed = input?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

function shortSha(input) {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) return null;
  return trimmed.slice(0, 7).toLowerCase();
}

function gitHeadCommitTimestamp() {
  try {
    return positiveIntegerString(execSync('git show -s --format=%ct HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  } catch {
    return null;
  }
}

function gitHeadCommitShortSha() {
  try {
    return shortSha(execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  } catch {
    return null;
  }
}

function resolveVersion() {
  const override = process.env.NEXT_PUBLIC_APP_VERSION_OVERRIDE?.trim();
  if (override) return override;

  const base = (process.env.NEXT_PUBLIC_APP_VERSION?.trim() || '5.0').split('.').slice(0, 2).join('.');
  const run = positiveIntegerString(process.env.GITHUB_RUN_NUMBER) || positiveIntegerString(process.env.BUILD_NUMBER);
  if (run) return `${base}.${run}`;

  const sha = shortSha(process.env.VERCEL_GIT_COMMIT_SHA) || gitHeadCommitShortSha();
  if (sha) return `${base}.${sha}`;

  const ts = positiveIntegerString(process.env.VERCEL_GIT_COMMIT_TIMESTAMP) || gitHeadCommitTimestamp();
  if (ts) return `${base}.${ts}`;

  return `${base}.${Math.floor(Date.now() / 1000)}`;
}

const currentVersion = resolveVersion();
const previousVersion = process.env.PREVIOUS_BUILD_VERSION?.trim() || '';

if (!previousVersion) {
  console.log(`[check-version] current=${currentVersion} previous=<not-set>; skipping strict compare.`);
  process.exit(0);
}

if (previousVersion === currentVersion) {
  console.error(`[check-version] failed: current build version matches previous (${currentVersion}).`);
  process.exit(1);
}

console.log(`[check-version] ok: previous=${previousVersion} current=${currentVersion}`);

