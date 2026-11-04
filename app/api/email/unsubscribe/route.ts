import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyUnsubscribeToken } from '@/lib/trial-emails';

export const dynamic = 'force-dynamic';

const Params = z.object({ e: z.string().trim().toLowerCase().email().max(320), t: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

function page(title: string, message: string, form?: { e: string; t: string }, status = 200) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const button = form
    ? `<form method="post" action="/api/email/unsubscribe?e=${encodeURIComponent(form.e)}&t=${encodeURIComponent(form.t)}"><button style="margin-top:16px;background:#f59e0b;color:#020617;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;font-size:15px;cursor:pointer">Unsubscribe</button></form>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · TradeQuote PRO</title></head>
<body style="margin:0;background:#020617;color:#f8fafc;font-family:Arial,Helvetica,sans-serif"><main style="max-width:480px;margin:15vh auto;padding:0 16px">
<p style="color:#f59e0b;font-weight:bold">TradeQuote PRO</p><h1 style="font-size:24px">${esc(title)}</h1><p style="color:#cbd5e1;line-height:1.5">${esc(message)}</p>${button}</main></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function check(request: Request) {
  const url = new URL(request.url);
  const parsed = Params.safeParse({ e: url.searchParams.get('e'), t: url.searchParams.get('t') });
  if (!parsed.success || !verifyUnsubscribeToken(parsed.data.e, parsed.data.t, env.unsubscribeSecret())) return null;
  return parsed.data;
}

// The link in the email opens a confirmation page, so mail scanners that follow links don't unsubscribe anyone
export async function GET(request: Request) {
  const params = check(request);
  if (!params) return page('Link not valid', 'This unsubscribe link is incomplete or has been changed. Reply to any of our emails and we will remove you by hand.', undefined, 400);
  return page('Stop these emails?', `We'll stop sending TradeQuote PRO trial and product emails to ${params.e}. Account emails such as password resets still arrive.`, params);
}

// Also used by Gmail and Outlook's one-click unsubscribe (List-Unsubscribe-Post)
export async function POST(request: Request) {
  const params = check(request);
  if (!params) return page('Link not valid', 'This unsubscribe link is incomplete or has been changed.', undefined, 400);
  const { error } = await createSupabaseAdminClient().from('email_unsubscribes').upsert({ email: params.e }, { onConflict: 'email', ignoreDuplicates: true });
  if (error) {
    console.error('Unsubscribe failed', error);
    return page('Something went wrong', 'We could not save that. Please try again, or reply to any of our emails and we will remove you by hand.', undefined, 500);
  }
  return page("You're unsubscribed", `${params.e} won't get any more trial or product emails from TradeQuote PRO.`);
}
