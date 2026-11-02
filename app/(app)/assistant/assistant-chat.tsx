'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Textarea } from '@/components/ui';
import { Markdown } from '@/components/markdown';

interface Source {
  url: string;
  title: string;
}
interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

const STORAGE_KEY = 'tq-assistant-history';

export default function AssistantChat({ province }: { province: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const suggestions = [
    `What's the minimum working clearance in front of a 600 V MCC under the CEC as adopted in ${province}?`,
    'How do I size a feeder for three 50 hp motors at 600 V?',
    'What should a LOTO procedure for a conveyor drive include?',
    'Which of our estimates are still in draft?',
    `How does holdback work on progress billing in ${province}?`,
  ];

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {}
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError('');
    setInput('');
    const history: Message[] = [...messages, { role: 'user', content: question }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    setStatus('Thinking…');

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only send text, and drop any empty assistant turn from a failed earlier answer
        body: JSON.stringify({ messages: history.filter((m) => m.content.trim()).slice(-40).map(({ role, content }) => ({ role, content })) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'The assistant could not answer.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'text') {
            setStatus('');
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + event.text };
              return copy;
            });
          } else if (event.type === 'status') {
            setStatus(event.text);
          } else if (event.type === 'sources') {
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], sources: event.items };
              return copy;
            });
          } else if (event.type === 'error') {
            setError(event.text);
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'The assistant could not answer.');
      }
    } finally {
      setBusy(false);
      setStatus('');
      abortRef.current = null;
      setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' && !m[m.length - 1].content.trim() ? m.slice(0, -1) : m));
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">AI Assistant</h1>
          <p className="text-slate-400 mt-1">Canadian code, estimating, field and office questions — and your own records.</p>
        </div>
        {messages.length > 0 && (
          <Button variant="secondary" disabled={busy} onClick={() => setMessages([])}>
            New Conversation
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-6" aria-live="polite">
        {messages.length === 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Try asking</p>
            <div className="grid gap-3 md:grid-cols-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="text-left bg-slate-950 border border-slate-800 hover:border-amber-500/50 hover:bg-amber-500/10 rounded-xl p-4 text-sm text-slate-300 hover:text-amber-400 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] bg-amber-500 text-slate-950 rounded-2xl rounded-br-md px-4 py-3 whitespace-pre-wrap">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="max-w-[95%] bg-slate-900 border border-slate-800 rounded-2xl rounded-bl-md px-5 py-4">
              {m.content ? <Markdown text={m.content} /> : <p className="text-slate-400 text-sm">{status || 'Thinking…'}</p>}
              {busy && i === messages.length - 1 && m.content && status && <p className="text-slate-400 text-sm mt-2">{status}</p>}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-800">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Sources</p>
                  <ol className="space-y-1 text-sm list-decimal pl-5">
                    {m.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline break-words">
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )
        )}
        {error && <Alert>{error}</Alert>}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 mt-6 bg-slate-950 pt-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <div className="flex gap-3 items-end">
          <Textarea
            aria-label="Ask a question"
            rows={2}
            value={input}
            maxLength={8000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask about code, an estimate, a field problem, or your records…"
            className="flex-1"
          />
          {busy ? (
            <Button size="lg" variant="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={!input.trim()}>
              Ask
            </Button>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          General information, not engineering or legal advice. Confirm code requirements with your authority having jurisdiction, and prices with your supplier.
        </p>
      </form>
    </div>
  );
}
