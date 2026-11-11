# DataTable

The record list every module page ends with: a titled card, uppercase headers, divided rows.

Hand-written from `app/warranty/page.tsx` and `app/estimates/page.tsx`.

## When to use
Listing a module's records. Name column `tone: 'primary'`, dates `tone: 'muted'`, actions `align: 'right'` with a small danger Button.

## Consumer provides
`columns`, `rows`, `title` like "Records (12)", `loading`, and `loadingText` / `emptyText` in full sentences ("No records found. Add one above.").

## Notes
Row hover uses `surface-row-hover`; the source's `hover:bg-slate-850/50` rendered nothing. On touch screens the table scrolls sideways.
