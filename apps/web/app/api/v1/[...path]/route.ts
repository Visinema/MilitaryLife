import { NextRequest } from 'next/server';

function normalizeBackendOrigin(rawValue: string | undefined): string | null {
  if (!rawValue) return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

function resolveBackendOrigin(): string | null {
  const backendFromOrigin = normalizeBackendOrigin(process.env.BACKEND_ORIGIN);
  if (backendFromOrigin) return backendFromOrigin;

  const rawApiBase = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (!rawApiBase) return null;

  if (/^https?:\/\//i.test(rawApiBase)) {
    try {
      const url = new URL(rawApiBase);
      const pathname = url.pathname.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
      return `${url.origin}${pathname}`;
    } catch {
      return null;
    }
  }

  return null;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const backend = resolveBackendOrigin();
  if (!backend) {
    return Response.json(
      {
        error:
          'Backend origin is not configured. Set BACKEND_ORIGIN in Vercel project settings to your Railway API domain.'
      },
      { status: 500 }
    );
  }

  const { path = [] } = await context.params;
  const targetUrl = new URL(`${backend}/api/v1/${path.join('/')}`);
  targetUrl.search = request.nextUrl.search;

  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual'
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, context);
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, context);
}
