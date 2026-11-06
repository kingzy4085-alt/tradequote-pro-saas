'use client';

import Link from 'next/link';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

// The pages this person's menu holds, which is worked out from their role. A page that is written for
// everyone can link only to these, so nobody gets a link that opens on "not found".
const NavLinks = createContext<ReadonlySet<string>>(new Set());

export function NavLinksProvider({ hrefs, children }: { hrefs: string[]; children: ReactNode }) {
  const value = useMemo(() => new Set(hrefs), [hrefs]);
  return <NavLinks.Provider value={value}>{children}</NavLinks.Provider>;
}

/** A link, if this page is in the person's menu. Otherwise nothing. */
export function IfNavLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const allowed = useContext(NavLinks);
  if (!allowed.has(href)) return null;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
