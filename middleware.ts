import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { MODULE_PLAN, PLAN_RANK, moduleOf } from '@/lib/plans';

const PUBLIC = ['/pricing', '/terms', '/privacy', '/login', '/signup', '/api/leads', '/api/stripe/webhook'];

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

  // Plans: the free trial unlocks everything; after it, each plan unlocks its modules
  const needs = MODULE_PLAN[moduleOf(path)];
  const always = ALWAYS_OPEN.some((p) => path === p || path.startsWith(p + '/'));
  if (always) return res;
  const { data: c } = await supabase.from('companies').select('subscription_plan, subscription_status, trial_ends_at').eq('id', companyId).maybeSingle();
  const paying = ['active', 'trialing', 'past_due'].includes(c?.subscription_status);
  const inTrial = !paying && !!c?.trial_ends_at && new Date(c.trial_ends_at) > new Date();
  const blocked = inTrial ? null
    : !paying ? 'Your free trial has ended. Choose a plan to keep using TradeQuote PRO.'
    : needs && (PLAN_RANK[c!.subscription_plan] || 0) < PLAN_RANK[needs] ? `This module is part of the ${needs === 'crew' ? 'Crew' : 'Contractor'} plan.`
    : null;
  if (blocked) {
    if (isApi) return NextResponse.json({ success: false, error: blocked }, { status: 402 });
    return redirect(`/billing?locked=${encodeURIComponent(moduleOf(path) || '')}`);
  }
  return res;
}

// Reachable with an expired trial so the company can pay or manage its account
const ALWAYS_OPEN = ['/billing', '/settings', '/help', '/about', '/api/stripe', '/api/company', '/api/health'];

export const config = {
  // Everything except the files a phone needs to install the app
  matcher: ['/((?!_next/static|_next/image|manifest.webmanifest|sw.js|icons/|icon.png|apple-icon.png|favicon.ico).*)'],
};
