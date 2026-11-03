// Which plan unlocks which module. Anything not listed is in every plan, and the free trial unlocks everything.
export const PLAN_RANK: Record<string, number> = { field: 1, crew: 2, contractor: 3 };

export const MODULE_PLAN: Record<string, 'crew' | 'contractor'> = {
  'job-costing': 'crew',
  'change-orders': 'crew',
  'rfi': 'crew',
  'rfis': 'crew',
  'submittals': 'crew',
  'loto-permits': 'crew',
  'progress-billing': 'crew',
  'crew-schedule': 'crew',
  'tool-crib': 'crew',
  'sub-compliance': 'contractor',
  'warranty': 'contractor',
  'commissioning': 'contractor',
  'cable-testing': 'contractor',
};

// First path segment of a page or /api/<module>/… route
export function moduleOf(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts[0] === 'api' ? parts[1] : parts[0];
}
