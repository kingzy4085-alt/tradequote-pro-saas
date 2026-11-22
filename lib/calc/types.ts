// The shape every calculator has. One registry (lib/calc/registry.ts) lists them, and three places
// read it: the estimate editor, the public /tools pages and the AI assistant's calculator tool. So a
// calculator is described by data (its fields) as well as code (run), and never throws on bad input.
import type { TakeoffLine, Trade } from '@/lib/costbook/types';

export type { TakeoffLine, Trade };

export type CalcValue = number | string | boolean;
export type CalcInput = Record<string, CalcValue>;

export interface CalcField {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  /** Shown beside the box, e.g. 'm', 'A', 'sq ft'. */
  unit?: string;
  help?: string;
  default: CalcValue;
  min?: number;
  max?: number;
  step?: number;
  /** For type 'select'. */
  options?: { value: string; label: string }[];
}

export interface CalcResult {
  /** The answer as a person reads it, most important first. */
  summary: { label: string; value: string; emphasis?: boolean }[];
  /** The same answer for code and the AI, keyed by name. */
  values: Record<string, CalcValue>;
  /** Materials and labour the answer implies, ready for the cost engine to price. */
  takeoff: TakeoffLine[];
  /** Anything the user should know: clamped inputs, code limits exceeded, assumptions. */
  warnings: string[];
  /** The method or code rule relied on, e.g. 'CEC Rule 8-102 (voltage drop)'. Never quoted text. */
  references: string[];
}

export interface Calculator {
  /** URL slug and registry key, e.g. 'voltage-drop'. */
  id: string;
  name: string;
  trade: Trade;
  /** Grouping on the tools page, e.g. 'Electrical design', 'Takeoff'. */
  category: string;
  /** One sentence for cards, search results and the AI tool description. */
  summary: string;
  fields: CalcField[];
  /** Validates and clamps its own input, and reports what it changed in warnings. Never throws. */
  run(input: CalcInput): CalcResult;
  keywords?: string[];
}
