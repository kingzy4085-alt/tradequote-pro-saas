import { ImageResponse } from 'next/og';

export const alt = 'TradeQuote PRO: quotes that win, billing that pays, jobs you can measure';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#020617', color: '#f8fafc', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', height: 14, width: '100%' }}>
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} style={{ display: 'flex', flex: 1, background: i % 2 ? '#0f172a' : '#f59e0b' }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, color: '#f8fafc' }}>
            TradeQuote <span style={{ color: '#fbbf24', marginLeft: 10 }}>PRO</span>
          </div>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 900, lineHeight: 1.02, marginTop: 24, maxWidth: 1000 }}>Quote it once. Win it, bill it, and know it paid.</div>
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#94a3b8' }}>Estimates, signed proposals, holdback billing and job costing for Canadian contractors</div>
      </div>
    ),
    size
  );
}
