# PageHeader

The top of every page: optional amber back link, the H1, a subtitle, actions on the right.

Hand-written from `app/page.tsx`, `app/estimates/page.tsx` and `app/warranty/page.tsx`.

## When to use
Once per page, `space-8` above the first section. Module pages set `backHref="/"`; the Command Center does not.

## Consumer provides
`title` in Title Case ("Warranty Management"), an operational `subtitle`, and up to two `actions` (primary then secondary).
