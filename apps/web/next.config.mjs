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

function resolveAutoVersion() {
  const explicitVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (explicitVersion) {
    return explicitVersion;
  }

  const buildCounterFromEnv = process.env.BUILD_NUMBER?.trim() || process.env.GITHUB_RUN_NUMBER?.trim();
  if (buildCounterFromEnv) {
    return `4.0.${buildCounterFromEnv}`;
  }

  try {
    const commitCount = execSync('git rev-list --count HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();

    if (commitCount) {
      return `4.0.${commitCount}`;
    }
  } catch {
    // fallback below
  }

  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.SOURCE_VERSION?.trim();
  if (commitSha) {
    const numericFromSha = Number.parseInt(commitSha.slice(0, 8), 16);
    if (Number.isFinite(numericFromSha) && numericFromSha > 0) {
      return `4.0.${numericFromSha}`;
    }
  }

  return `4.0.${Math.floor(Date.now() / 1000)}`;
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAutoVersion()
  },
  async rewrites() {
    const backend = normalizeBackendOrigin(process.env.BACKEND_ORIGIN);
    if (!backend) {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
