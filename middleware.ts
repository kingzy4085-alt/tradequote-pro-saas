import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isTransientAuthError } from '@/lib/supabase/auth-error';

// Reachable without signing in. Everything else requires a session.
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/reset-password',
  '/auth/',
  '/legal/',
  '/api/stripe/webhook',
  '/pricing',
  '/about',
  '/api/leads',
  '/api/health',
  '/api/cron/',
  '/api/email/unsubscribe',
  // The client portal: the link's token is the credential (see lib/portal.ts)
  '/portal/',
  '/api/portal/',
  '/robots.txt',
  '/sitemap.xml',
];

// These carry their own authentication (or none) and never read a session, so
// they must keep working even when Supabase is unset or down.
const NO_SESSION_PATHS = ['/api/health', '/api/stripe/webhook', '/robots.txt', '/sitemap.xml'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
}

/** Sends a redirect that keeps any session cookies just rotated on `from`. */
function redirectWithCookies(to: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(to);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export async function middleware(request: NextRequest) {
  // The app has no next/image. Next 14's optimizer has unpatched RCE advisories,
  // so it is closed here rather than left reachable.
  if (request.nextUrl.pathname.startsWith('/_next/image')) return new NextResponse('Not found', { status: 404 });
  if (NO_SESSION_PATHS.includes(request.nextUrl.pathname)) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new NextResponse('TradeQuote PRO is not configured: set the Supabase variables from .env.example.', { status: 500 });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookies: { name: string; value: string; options: CookieOptions }[]) {
        // A session spans several chunk cookies, and stale chunks arrive here as
        // removals. Apply the whole batch at once so none of them is lost.
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes an expiring session and validates it with Supabase Auth
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // Auth being unreachable doesn't mean signed out. Pages and routes re-check the
  // session themselves and show a proper error instead of bouncing people to login.
  if (!user && isTransientAuthError(error)) return response;

  const { pathname, search } = request.nextUrl;
  if (!user && pathname === '/') {
    // A signed-out visitor to the root is most likely a prospect
    const pricing = request.nextUrl.clone();
    pricing.pathname = '/pricing';
    pricing.search = '';
    return redirectWithCookies(pricing, response);
  }
  if (!user && !isPublicPath(pathname)) {
    if (pathname.startsWith('/api/')) {
      const denied = NextResponse.json({ error: 'Sign in required' }, { status: 401 });
      for (const cookie of response.cookies.getAll()) denied.cookies.set(cookie);
      return denied;
    }
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(login, response);
  }
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return redirectWithCookies(home, response);
  }

  return response;
}

export const config = {
  // Skip static assets, the PWA files and Next internals
  matcher: ['/((?!_next/static|favicon.ico|icons/|icon.png|apple-icon.png|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};
