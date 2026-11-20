'use client';

import { useCallback, useRef, useState } from 'react';
import type { CompanyPrice } from '@/lib/costbook';
import { parseCompanyPrices } from '@/lib/estimate-helpers';

/**
 * The company's own prices, fetched once the first time a panel needs them. A missing route or a
 * failure leaves reference prices only, and says so.
 */
export function usePriceBook() {
  const [prices, setPrices] = useState<CompanyPrice[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const started = useRef(false);
  const load = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setState('loading');
    try {
      const res = await fetch('/api/price-book', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setPrices(parseCompanyPrices(await res.json().catch(() => ({}))));
      setState('ready');
    } catch {
      setPrices([]);
      setState('unavailable');
    }
  }, []);
  return { prices, state, load };
}
