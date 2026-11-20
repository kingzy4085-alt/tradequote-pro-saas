import type { Trade } from '@/lib/costbook';

export const TRADE_LABEL: Record<Trade, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  carpentry: 'Carpentry and framing',
  drywall: 'Drywall',
  insulation: 'Insulation',
  concrete: 'Concrete',
  roofing: 'Roofing',
  painting: 'Painting',
  flooring: 'Flooring',
  general: 'General',
};

/** What the index page needs from a calculator, as plain data a client component can take. */
export interface ToolCard {
  id: string;
  name: string;
  trade: Trade;
  category: string;
  summary: string;
  keywords: string[];
}
