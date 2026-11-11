'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import SignaturePad from '@/components/signature-pad';

const input = 'w-full min-h-[48px] rounded-lg border border-gray-400 bg-white px-3 py-2 text-base text-black';
const button = 'min-h-[48px] rounded-lg px-5 py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed';

/** The client's answer: accept with a name and drawn signature, or decline with an optional reason. */
export default function DecisionForm({ token, company }: { token: string; company: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'accept' | 'decline'>('accept');
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    setError('');
    if (mode === 'accept' && !name.trim()) return setError('Enter the name of the person signing.');
    if (mode === 'accept' && !signature) return setError('Draw your signature in the box first.');
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(mode === 'accept' ? { decision: 'accepted', name, signature } : { decision: 'declined', reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Your answer could not be saved. Try again.');
      // The page now shows the recorded answer in place of this form
      router.refresh();
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. Your answer was not sent. Check your connection and try again.' : err instanceof Error ? err.message : 'Your answer could not be saved.');
      setBusy(false);
    }
  }

  return (
    <section aria-label="Your answer" className="rounded-xl border-2 border-black p-5 print:hidden">
      <h2 className="text-lg font-bold text-black mb-3">Your answer</h2>
      <div role="radiogroup" aria-label="Accept or decline" className="grid grid-cols-2 gap-3 mb-5">
        {(['accept', 'decline'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => {
              setMode(m);
              setError('');
            }}
            className={`${button} border-2 ${mode === m ? 'border-black bg-black text-white' : 'border-gray-400 bg-white text-black'}`}
          >
            {m === 'accept' ? 'Accept' : 'Decline'}
          </button>
        ))}
      </div>

      {mode === 'accept' ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="signer" className="block text-sm font-semibold text-black mb-1">
              Your full name
            </label>
            <input id="signer" className={input} value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <p className="text-sm font-semibold text-black mb-1">Sign here</p>
            <SignaturePad onChange={setSignature} />
          </div>
          <p className="text-sm">By accepting you agree to the scope, price and terms above. {company} is told straight away.</p>
        </div>
      ) : (
        <div>
          <label htmlFor="reason" className="block text-sm font-semibold text-black mb-1">
            Reason (optional)
          </label>
          <textarea id="reason" className={`${input} min-h-[96px]`} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-700 bg-red-50 px-3 py-2 text-base text-red-800">
          {error}
        </p>
      )}

      <button type="button" onClick={send} disabled={busy} className={`${button} mt-5 w-full sm:w-auto ${mode === 'accept' ? 'bg-green-700 text-white hover:bg-green-800' : 'bg-gray-800 text-white hover:bg-black'}`}>
        {busy ? 'Sending…' : mode === 'accept' ? 'Accept and sign' : 'Decline this proposal'}
      </button>
    </section>
  );
}
