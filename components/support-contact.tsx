'use client';

import { createContext, useContext, type ReactNode } from 'react';

// The support address comes from the server (env.supportEmail() in lib/env.ts). Error screens are
// client components that Next renders with only the error, so the root layout hands the address down here.

/** undefined: no provider above. null: the provider says no address is set. */
const SupportEmail = createContext<string | null | undefined>(undefined);

// The global error screen replaces the root layout, so it sits above the provider. It gets the last
// address the provider was given, which is set on every render and is the same on every request. Next
// draws that screen only in the browser, so this cannot differ between server and browser. If the
// layout failed before the provider ever rendered on this page, there is no address and the screen
// says who else to ask instead.
let remembered: string | undefined;

export function SupportEmailProvider({ email, children }: { email?: string; children: ReactNode }) {
  remembered = email;
  return <SupportEmail.Provider value={email ?? null}>{children}</SupportEmail.Provider>;
}

/** The support address, or undefined when none is set. */
export function useSupportEmail(): string | undefined {
  const given = useContext(SupportEmail);
  return given === undefined ? remembered : given ?? undefined;
}

export function SupportEmailLink({ email, subject }: { email: string; subject?: string }) {
  const href = subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
  return (
    <a href={href} className="min-h-[48px] lg:min-h-0 inline-flex items-center break-all font-semibold text-amber-400 hover:underline">
      {email}
    </a>
  );
}

/** The last line of an error screen: who to ask when trying again does not help. */
export function SupportLine({ email, lead, subject }: { email?: string; lead: string; subject?: string }) {
  return (
    <p className="mt-6 text-sm text-slate-400">
      {email ? `${lead} Email ` : `${lead} Contact the company that set up your account.`}
      {email && <SupportEmailLink email={email} subject={subject} />}
    </p>
  );
}
