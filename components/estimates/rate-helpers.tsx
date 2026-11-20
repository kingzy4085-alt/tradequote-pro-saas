'use client';

import { useState } from 'react';
import { Button, Label, Select } from '@/components/ui';
import type { LabourClass, ShopType, Trade } from '@/lib/costbook';
import { TRADES } from '@/lib/costbook/types';
import { LABOUR_CLASS_LABEL, LABOUR_RATE_NOTE, TRADE_LABEL, defaultLabourClass, labourSuggestion, salesTaxFor, taxSentence } from '@/lib/estimate-helpers';
import { formatMoney } from '@/lib/format';

const toggle = 'inline-flex items-center min-h-[48px] lg:min-h-0 lg:py-1 text-amber-400 hover:text-amber-300 font-semibold text-sm';

export function LabourRateHelper({ province, trade, onUse }: { province: string; trade: Trade; onUse: (rate: number) => void }) {
  const [open, setOpen] = useState(false);
  const [labourClass, setLabourClass] = useState<LabourClass>(defaultLabourClass(trade));
  const [shop, setShop] = useState<ShopType>('open');
  const s = labourSuggestion(labourClass, province, shop);
  return (
    <div>
      <button type="button" className={toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        Suggest a labour rate
      </button>
      {open && (
        <div className="mt-2 space-y-3 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rate-class">Who does the work</Label>
              <Select id="rate-class" value={labourClass} onChange={(e) => setLabourClass(e.target.value as LabourClass)} options={Object.entries(LABOUR_CLASS_LABEL).map(([value, label]) => ({ value, label }))} />
            </div>
            <div>
              <Label htmlFor="rate-shop">Shop</Label>
              <Select id="rate-shop" value={shop} onChange={(e) => setShop(e.target.value as ShopType)} options={[{ value: 'open', label: 'Open shop' }, { value: 'union', label: 'Union' }]} />
            </div>
          </div>
          <p className="text-sm text-slate-300">
            Burdened cost {formatMoney(s.cost)}/hr (wage {formatMoney(s.wage)} plus {s.burdenPct}% for vacation, holidays, CPP, EI, WCB and benefits). Suggested charge-out <strong className="text-amber-300">{formatMoney(s.charge)}/hr</strong>, with overhead and profit.
          </p>
          <Button onClick={() => onUse(s.charge)}>Use {formatMoney(s.charge)}/hr as the labour rate</Button>
          <p className="text-xs text-slate-500">{LABOUR_RATE_NOTE}</p>
        </div>
      )}
    </div>
  );
}

export function TaxHelper({ province, trade, onTradeChange, onUse }: { province: string; trade: Trade; onTradeChange: (t: Trade) => void; onUse: (percent: number) => void }) {
  const [open, setOpen] = useState(false);
  const rate = salesTaxFor(province, trade).total;
  return (
    <div>
      <button type="button" className={toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        Use the provincial tax rate
      </button>
      {open && (
        <div className="mt-2 space-y-3 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
          <div>
            <Label htmlFor="tax-trade">Type of work</Label>
            <Select id="tax-trade" value={trade} onChange={(e) => onTradeChange(e.target.value as Trade)} options={TRADES.map((t) => ({ value: t, label: TRADE_LABEL[t] }))} />
          </div>
          <p className="text-sm text-slate-300">{taxSentence(province, trade)}</p>
          <Button onClick={() => onUse(rate)}>Set tax to {rate}%</Button>
        </div>
      )}
    </div>
  );
}
