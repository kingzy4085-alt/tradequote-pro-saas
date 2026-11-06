'use client';

import { useState } from 'react';
import { Alert, Button, FieldError, Input, Label, Panel, Select, Textarea } from '@/components/ui';
import { PROVINCES } from '@/lib/provinces';

export interface Profile {
  name: string;
  province: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  default_markup?: number | string | null;
  default_tax?: number | string | null;
  default_labour_rate?: number | string | null;
  default_terms?: string | null;
  overtime_multiplier?: number | string | null;
  default_holdback_pct?: number | string | null;
}

const KEYS = ['name', 'province', 'contact', 'phone', 'email', 'address', 'default_markup', 'default_tax', 'default_labour_rate', 'default_terms', 'overtime_multiplier', 'default_holdback_pct'] as const;
type Form = Record<(typeof KEYS)[number], string>;

export default function CompanyForm({ initial, canEdit, canSeeRates = canEdit }: { initial: Profile; canEdit: boolean; /** The markup and labour rate are for project managers and up. */ canSeeRates?: boolean }) {
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
          <div>
            <Label htmlFor="province">Province</Label>
            <Select id="province" options={PROVINCES.map((p) => p.code)} value={form.province} disabled={!canEdit} onChange={(e) => set('province', e.target.value)} />
          </div>
        </div>
      </Panel>
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
