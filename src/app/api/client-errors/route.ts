import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    console.error('[client-error]', JSON.stringify(body));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error('[client-error] failed to record', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
