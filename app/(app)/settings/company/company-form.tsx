'use client';

import { useRef, useState } from 'react';
import { Alert, Button, FieldError, Input, Label, Panel, Select, Textarea } from '@/components/ui';
import { logoFileProblem } from '@/lib/company-logo';
import { PROVINCES } from '@/lib/provinces';

export interface LogoState {
  /** A short-lived link to show the current logo, or null when there is none or it could not be loaded. */
  url: string | null;
  hasLogo: boolean;
  /** Owner or admin, and the company can still make changes. */
  canChange: boolean;
  /** An owner or admin whose trial or subscription has ended. */
  lapsed?: boolean;
}

/** The logo printed on proposals, invoices and other documents. Upload, replace and remove: owner and admins only. */
function LogoPanel({ initial }: { initial: LogoState }) {
  const [logo, setLogo] = useState({ url: initial.url, hasLogo: initial.hasLogo });
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function send(label: string, init: RequestInit, done: string) {
    setBusy(label);
    setStatus(null);
    try {
      const res = await fetch('/api/company/logo', init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ tone: 'error', text: json.error ?? 'Something went wrong. Try again.' });
        return;
      }
      setLogo({ url: json.data?.logo_url ?? null, hasLogo: !!json.data?.logo_path });
      setStatus({ tone: 'success', text: done });
    } catch {
      setStatus({ tone: 'error', text: 'Network error. Check your connection and try again.' });
    } finally {
      setBusy('');
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    const problem = logoFileProblem(file);
    if (problem) {
      setStatus({ tone: 'error', text: problem });
      return;
    }
    const body = new FormData();
    body.append('logo', file);
    send('Uploading…', { method: 'POST', body }, 'Logo saved. It prints on your documents from now on.');
  }

  function remove() {
    if (!window.confirm('Remove the logo? Documents will print without one.')) return;
    send('Removing…', { method: 'DELETE' }, 'Logo removed.');
  }

  return (
    <Panel title="Logo" description="Printed at the top of proposals, invoices, change orders and other documents. PNG or JPEG, up to 1 MB.">
      <div className="space-y-4">
        {status && <Alert tone={status.tone}>{status.text}</Alert>}
        {initial.lapsed && <Alert tone="info">Your trial or subscription has ended, so the logo cannot be changed until billing is updated.</Alert>}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center justify-center h-24 w-full sm:w-60 rounded-xl border border-slate-800 bg-white p-3">
            {logo.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to private storage
              <img src={logo.url} alt="Company logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-sm text-slate-500">{logo.hasLogo ? 'Logo saved' : 'No logo yet'}</span>
            )}
          </div>
          {initial.canChange ? (
            <div className="flex flex-wrap gap-3">
              <input
                ref={input}
                id="company-logo"
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Logo image file"
                className="hidden"
                tabIndex={-1}
                disabled={!!busy}
                onChange={(e) => {
                  upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button onClick={() => input.current?.click()} disabled={!!busy}>
                {busy === 'Uploading…' ? busy : logo.hasLogo ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logo.hasLogo && (
                <Button variant="danger" onClick={remove} disabled={!!busy}>
                  {busy === 'Removing…' ? busy : 'Remove logo'}
                </Button>
              )}
            </div>
          ) : (
            !initial.lapsed && <p className="text-sm text-slate-400">Only the owner or an admin can change the logo.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

export interface Profile {
  name: string;
  province: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_number?: string | null;
  default_markup?: number | string | null;
  default_tax?: number | string | null;
  default_labour_rate?: number | string | null;
  default_terms?: string | null;
  overtime_multiplier?: number | string | null;
  default_holdback_pct?: number | string | null;
}

const KEYS = ['name', 'province', 'contact', 'phone', 'email', 'address', 'tax_number', 'default_markup', 'default_tax', 'default_labour_rate', 'default_terms', 'overtime_multiplier', 'default_holdback_pct'] as const;
type Form = Record<(typeof KEYS)[number], string>;

export default function CompanyForm({
  initial,
  canEdit,
  canSeeRates = canEdit,
  logo,
}: {
  initial: Profile;
  canEdit: boolean;
  /** The markup and labour rate are for project managers and up. */
  canSeeRates?: boolean;
  logo?: LogoState;
}) {
  const [form, setForm] = useState<Form>(() => Object.fromEntries(KEYS.map((k) => [k, initial[k] == null ? '' : String(initial[k])])) as Form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    setErrors({});
    try {
      const res = await fetch('/api/company', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.details) setErrors(json.details);
        setStatus({ tone: 'error', text: json.error ?? 'Could not save' });
        return;
      }
      setStatus({ tone: 'success', text: 'Saved. New records start with these defaults.' });
    } catch {
      setStatus({ tone: 'error', text: 'Network error — check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const field = (k: keyof Form, label: string, type = 'text') => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type={type} min={type === 'number' ? 0 : undefined} step="any" value={form[k]} disabled={!canEdit} aria-invalid={!!errors[k]} onChange={(e) => set(k, e.target.value)} />
      <FieldError message={errors[k]} />
    </div>
  );

  return (
    <form onSubmit={save} className="space-y-6 max-w-4xl">
      {!canEdit && <Alert tone="info">Only the owner or an admin can change these details.</Alert>}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
      <Panel title="Company profile">
        <div className="grid sm:grid-cols-2 gap-4">
          {field('name', 'Company name')}
          {field('contact', 'Main contact')}
          {field('phone', 'Phone', 'tel')}
          {field('email', 'Email', 'email')}
          {field('address', 'Address')}
          {field('tax_number', 'GST/HST number (printed on invoices)')}
          <div>
            <Label htmlFor="province">Province</Label>
            <Select id="province" options={PROVINCES.map((p) => p.code)} value={form.province} disabled={!canEdit} onChange={(e) => set('province', e.target.value)} />
          </div>
        </div>
      </Panel>
      {logo && <LogoPanel initial={logo} />}
      <Panel title="Estimating defaults">
        <div className="grid sm:grid-cols-3 gap-4">
          {canSeeRates && field('default_markup', 'Default markup %', 'number')}
          {field('default_tax', 'Sales tax %', 'number')}
          {canSeeRates && field('default_labour_rate', 'Labour rate ($/hr)', 'number')}
        </div>
        <div className="mt-4">
          <Label htmlFor="default_terms">Proposal terms</Label>
          <Textarea id="default_terms" rows={4} value={form.default_terms} disabled={!canEdit} onChange={(e) => set('default_terms', e.target.value)} />
          <FieldError message={errors.default_terms} />
        </div>
      </Panel>
      <Panel title="Payroll and billing defaults">
        <div className="grid sm:grid-cols-2 gap-4">
          {field('overtime_multiplier', 'Overtime multiplier (1.5 = time and a half)', 'number')}
          {field('default_holdback_pct', 'Holdback %', 'number')}
        </div>
      </Panel>
      {canEdit && (
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? 'Saving…' : 'Save company details'}
        </Button>
      )}
    </form>
  );
}
