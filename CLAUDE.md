# CLAUDE.md — TradeQuote PRO

## Overview
- App: TradeQuote PRO SaaS
- Stack: Next.js App Router, Supabase RLS, Stripe
- Build: npm run build (Stable)
- Architecture Rule: Use proxy.ts at root. Never create a root middleware.ts to avoid build collisions.