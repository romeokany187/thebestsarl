import { NextRequest, NextResponse } from 'next/server';

function isLocalHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function denyIfLabDisabled(request: NextRequest) {
  const labEnabled = process.env.SECURITY_LAB_MODE !== 'false';
  const host = request.nextUrl.hostname;

  if (!labEnabled || !isLocalHost(host)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  return null;
}