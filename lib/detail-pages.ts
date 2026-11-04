// Modules with more than the generic form. Add a slug here when you add its page;
// the shared module list then links to it.

/** Module slug to its detail route. The row title opens `<route>/<id>`. */
export const DETAIL_PAGES: Record<string, string> = {
  estimates: '/estimates',
  'daily-logs': '/daily-logs',
};

/** Module slug to its print route. The row's Print link opens `<route>/<id>`. */
export const PRINT_PAGES: Record<string, string> = {
  proposals: '/print/proposal',
};

export function detailHref(slug: string, id: string): string | null {
  return DETAIL_PAGES[slug] ? `${DETAIL_PAGES[slug]}/${id}` : null;
}

export function printHref(slug: string, id: string): string | null {
  return PRINT_PAGES[slug] ? `${PRINT_PAGES[slug]}/${id}` : null;
}
