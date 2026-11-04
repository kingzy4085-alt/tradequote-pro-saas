'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, AuthCard, Button, Input, Label, Select } from '@/components/ui';
import { PROVINCES } from '@/lib/provinces';
import { ROLE_LABEL, isRole } from '@/lib/roles';

interface Invitation {
  token: string;
  company_name: string;
  role: string;
}

export default function OnboardingForm({ email, invitations }: { email: string; invitations: Invitation[] }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [province, setProvince] = useState('SK');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(body: Record<string, string>) {
    if (!fullName.trim()) return setError('Enter your name.');
    setLoading(true);
    setError('');
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, fullName }),
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setError(json.error ?? 'Something went wrong. Try again.');
    router.replace('/');
    router.refresh();
  }

  return (
    <AuthCard title="Set up your company" subtitle={`Signed in as ${email}`}>
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="fullName">Your Name</Label>
          <Input id="fullName" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Jordan Smith" />
        </div>

        {invitations.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">You've been invited</p>
            {invitations.map((inv) => (
              <div key={inv.token} className="flex items-center justify-between gap-3 bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div>
                  <p className="font-medium text-white">{inv.company_name}</p>
                  <p className="text-xs text-slate-400">as {isRole(inv.role) ? ROLE_LABEL[inv.role] : inv.role}</p>
                </div>
                <Button disabled={loading} onClick={() => submit({ action: 'accept', token: inv.token })}>
                  Join
                </Button>
              </div>
            ))}
            <p className="text-xs text-slate-500 text-center">— or start your own company —</p>
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: 'create', companyName, province });
          }}
        >
          <div>
            <Label htmlFor="companyName">Company Name</Label>
            <Input id="companyName" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Prairie Industrial Electric Ltd." />
          </div>
          <div>
            <Label htmlFor="province">Province / Territory</Label>
            <Select id="province" value={province} onChange={(e) => setProvince(e.target.value)} options={PROVINCES.map((p) => p.code)} />
            <p className="text-xs text-slate-500 mt-1">Used for code references, GST/PST and holdback rules.</p>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Setting up...' : 'Create Company & Start Trial'}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
