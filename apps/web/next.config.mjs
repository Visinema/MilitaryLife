import { execSync } from 'node:child_process';

/** @type {import('next').NextConfig} */
function normalizeBackendOrigin(rawValue) {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

function semverLike(input) {
  const trimmed = input?.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return null;
  }

  return {
    major: match[1],
    minor: match[2],
    patch: match[3] ?? null
  };
}

function resolveBaseVersion(input) {
  const parsed = semverLike(input);
  if (!parsed) {
    return '5.1';
  }

  const major = Number(parsed.major);
  const minor = Number(parsed.minor);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return '5.1';
  }

  // Guard against stale env values (for example 4.x) left in hosting settings.
  if (major < 5 || (major === 5 && minor < 1)) {
    return '5.1';
  }

  return `${major}.${minor}`;
}

function positiveIntegerString(input) {
  const trimmed = input?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function shortSha(input) {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^[0-9a-fA-F]{7,40}$/);
  if (!match) return null;
  return trimmed.slice(0, 7).toLowerCase();
}

function gitHeadCommitTimestamp() {
  try {
    const output = execSync('git show -s --format=%ct HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
    return positiveIntegerString(output);
  } catch {
    return null;
  }
}

function gitHeadCommitShortSha() {
  try {
    const output = execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
    return shortSha(output);
  } catch {
    return null;
  }
}

function resolveAutoVersion() {
  const overrideVersion = process.env.NEXT_PUBLIC_APP_VERSION_OVERRIDE?.trim();
  if (overrideVersion) {
    return overrideVersion;
  }

  const baseVersion = resolveBaseVersion(process.env.NEXT_PUBLIC_APP_VERSION);

  const runNumber = positiveIntegerString(process.env.GITHUB_RUN_NUMBER) || positiveIntegerString(process.env.BUILD_NUMBER);
  if (runNumber) {
    return `${baseVersion}.${runNumber}`;
  }

  const commitShaShort = shortSha(process.env.VERCEL_GIT_COMMIT_SHA) || gitHeadCommitShortSha();
  if (commitShaShort) {
    return `${baseVersion}.${commitShaShort}`;
  }

  const commitTimestamp = positiveIntegerString(process.env.VERCEL_GIT_COMMIT_TIMESTAMP) || gitHeadCommitTimestamp();
  if (commitTimestamp) {
    return `${baseVersion}.${commitTimestamp}`;
  }

  return `${baseVersion}.${Math.floor(Date.now() / 1000)}`;
}

const backendForRewrite = normalizeBackendOrigin(process.env.BACKEND_ORIGIN);
const vercelEnv = process.env.VERCEL_ENV?.trim();
const runningOnVercel = process.env.VERCEL === '1' || Boolean(vercelEnv);
const shouldRequireBackendOrigin = runningOnVercel && (vercelEnv === 'production' || vercelEnv === 'preview');

if (shouldRequireBackendOrigin && !backendForRewrite) {
  throw new Error('BACKEND_ORIGIN is required for Vercel deployments. This prevents runtime 404 on /api/v1/* rewrites.');
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAutoVersion()
  },
  async rewrites() {
    if (!backendForRewrite) {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: `${backendForRewrite}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
