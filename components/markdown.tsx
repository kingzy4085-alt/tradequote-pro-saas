import { Fragment, type ReactNode } from 'react';

// A small, safe markdown renderer for assistant answers: headings, lists, tables,
// bold, italics, inline code and links. Builds React elements only — no HTML strings.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith('**')) out.push(<strong key={key} className="text-white font-semibold">{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) out.push(<code key={key} className="font-mono text-xs bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5">{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'));
      out.push(
        <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
          {label}
        </a>
      );
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const key = `b${k++}`;

    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="font-mono text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto text-slate-300">{body.join('\n')}</pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<p key={key} className={heading[1].length <= 2 ? 'text-lg font-bold text-white mt-2' : 'font-semibold text-white mt-2'}>{inline(heading[2], key)}</p>);
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wider text-slate-400">
                {head.map((h, j) => (
                  <th key={j} className="py-2 pr-4">{inline(h, `${key}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="py-2 pr-4 text-slate-300">{inline(c, `${key}r${ri}c${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}-${j}`)}</li>
          ))}
        </List>
      );
      continue;
    }
    // Always consume the current line, so an unmatched pattern can never stall the loop
    const para: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s)/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={key}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `${key}-${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }
  return <div className="space-y-3 text-slate-200 leading-relaxed">{blocks}</div>;
}
