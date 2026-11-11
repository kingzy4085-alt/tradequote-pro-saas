// Modules with their own detail page (line items, photos, sign-off). The row title
// in the module list opens it. Add a slug here when a module gets a detail page.
export const DETAIL_PAGES: Record<string, string> = {
  estimates: '/estimates',
  proposals: '/proposals',
  projects: '/projects',
  'daily-logs': '/daily-logs',
  'change-orders': '/change-orders',
  invoices: '/invoices',
  'progress-billing': '/invoices/draws',
  timecards: '/timecards',
  'loto-permits': '/loto-permits',
  'tailgate-logs': '/tailgate-logs',
  'safety-inspections': '/safety-inspections',
};

/** The detail page of a record, or null if its module only has the list. */
export function detailHref(slug: string, id: string): string | null {
  const route = DETAIL_PAGES[slug];
  return route ? `${route}/${id}` : null;
}
