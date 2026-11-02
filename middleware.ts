import { NextResponse, type NextRequest } from 'next/server';

// Password gate for the whole app until real Supabase login is built.
// Set APP_USERNAME and APP_PASSWORD; with no password set (local dev) the gate is off.
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  // The desktop launcher runs on this computer only
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').replace(/:\d+$/, '');
  if (!process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(host)) return NextResponse.next();

  const username = process.env.APP_USERNAME || 'tradequote';
  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    const [user, ...rest] = atob(header.slice(6)).split(':');
    if (user === username && rest.join(':') === password) return NextResponse.next();
  }

  return new NextResponse('Sign in required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="TradeQuote PRO", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except the files a phone needs to install the app
  matcher: ['/((?!_next/static|_next/image|manifest.webmanifest|sw.js|icons/|icon.png|apple-icon.png|favicon.ico|pricing|api/leads).*)'],
};
