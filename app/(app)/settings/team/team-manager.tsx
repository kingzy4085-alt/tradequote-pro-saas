'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Input, Label, Panel, Select } from '@/components/ui';
import { ROLE_LABEL, isRole, type Role } from '@/lib/roles';

interface Member {
  user_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
}

const ROLE_HELP: Record<Exclude<Role, 'owner'>, string> = {
  admin: 'Everything, including finance, team and billing',
  project_manager: 'Estimates, proposals, projects and job costing',
  foreman: 'Field modules, RFIs, schedule and approvals',
  electrician: 'Timecards, daily logs, safety and field records',
};

const label = (r: string) => (isRole(r) ? ROLE_LABEL[r] : r);

export default function TeamManager({ currentUserId, isOwner, canWrite, members, invitations }: { currentUserId: string; isOwner: boolean; canWrite: boolean; members: Member[]; invitations: Invitation[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('electrician');
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const assignable = (Object.keys(ROLE_HELP) as Exclude<Role, 'owner'>[]).filter((r) => r !== 'admin' || isOwner);

  async function call(method: string, body: object, success?: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/team', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: 'error', text: json.error ?? 'Something went wrong' });
      return false;
    }
    setMessage({ tone: json.warning ? 'info' : 'success', text: json.warning ?? json.message ?? success ?? 'Done.' });
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-8">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {canWrite && (
        <Panel title="Invite Someone">
          <form
            className="grid grid-cols-1 md:grid-cols-[1fr_16rem_auto] gap-4 items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call('POST', { email, role })) setEmail('');
            }}
          >
            <div>
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. tessa@prairieelectric.ca" />
            </div>
            <div>
              <Label htmlFor="invite-role">Role</Label>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Exclude<Role, 'owner'>)} options={assignable} />
            </div>
            <Button type="submit" size="lg" disabled={busy}>
              Send Invite
            </Button>
          </form>
          <p className="text-xs text-slate-400 mt-3">{ROLE_HELP[role]}.</p>
        </Panel>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">Members ({members.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-4">Name</th>
                <th className="p-4">Email</th>
                <th className="p-4">Role</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {members.map((m) => {
                const editable = m.user_id !== currentUserId && m.role !== 'owner' && (isOwner || m.role !== 'admin') && canWrite;
                return (
                  <tr key={m.user_id}>
                    <td className="p-4 font-medium text-white">{m.full_name || '—'}</td>
                    <td className="p-4 text-slate-300">{m.email}</td>
                    <td className="p-4">
                      {editable ? (
                        <Select aria-label={`Role for ${m.email}`} value={m.role} disabled={busy} onChange={(e) => call('PATCH', { userId: m.user_id, role: e.target.value }, 'Role updated.')} options={assignable} className="max-w-[12rem] py-2" />
                      ) : (
                        <Badge>{label(m.role)}</Badge>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {editable && (
                        <Button variant="danger" size="sm" disabled={busy} onClick={() => window.confirm(`Remove ${m.email} from the company?`) && call('DELETE', { userId: m.user_id }, 'Member removed.')}>
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {invitations.length > 0 && (
        <Panel title="Pending Invitations">
          <ul className="divide-y divide-slate-800">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="text-white">
                  {inv.email} <span className="text-slate-400">· {label(inv.role)} · expires {new Date(inv.expires_at).toLocaleDateString('en-CA')}</span>
                </span>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => call('DELETE', { invitationId: inv.id }, 'Invitation revoked.')}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
