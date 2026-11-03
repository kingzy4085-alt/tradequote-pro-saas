import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = ['/pricing', '/terms', '/privacy', '/login', '/signup', '/api/leads'];

// Keeps the Supabase session fresh, sends signed-out visitors to /login and new accounts to /onboarding.
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));
  const isApi = path.startsWith('/api/');

  const redirect = (to: string) => {
    const r = NextResponse.redirect(new URL(to, req.url));
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!user) {
    if (isPublic) return res;
    if (isApi) return NextResponse.json({ success: false, error: 'Please sign in.' }, { status: 401 });
    return redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  if (isPublic || path === '/onboarding' || path === '/api/onboarding') return res;
  const { data: companyId } = await supabase.rpc('current_company_id');
  if (!companyId) {
    if (isApi) return NextResponse.json({ success: false, error: 'Set up your company first.' }, { status: 403 });
    return redirect('/onboarding');
  }
  return res;
}

export const config = {
  // Everything except the files a phone needs to install the app
  matcher: ['/((?!_next/static|_next/image|manifest.webmanifest|sw.js|icons/|icon.png|apple-icon.png|favicon.ico).*)'],
};
