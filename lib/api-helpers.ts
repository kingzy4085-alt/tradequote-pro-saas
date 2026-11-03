import { NextResponse } from 'next/server';

export const fail = (message: string, status = 500) => NextResponse.json({ success: false, error: message }, { status });
export const ok = (data: unknown) => NextResponse.json({ success: true, data });
export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Finite, non-negative number, or null when the input isn't one ('' counts as 0)
export function amount(v: unknown) {
  const x = typeof v === 'string' && v.trim() === '' ? 0 : Number(v ?? 0);
  return Number.isFinite(x) && x >= 0 ? x : null;
}

export const text = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : null);

export const isSignature = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('data:image/png;base64,') && v.length <= 300000;
