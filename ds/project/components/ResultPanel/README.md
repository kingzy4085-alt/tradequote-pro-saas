# ResultPanel

Confirmation shown under a form after a save, with the saved record as JSON.

Hand-written from `app/crm/page.tsx`, `app/proposals/page.tsx` and `app/punch-list/page.tsx`.

## When to use
After a submit on modules that echo the stored record. The tone matches the module's submit button: `success` CRM, `info` Proposals, `critical` Punch List.

## Consumer provides
`tone`, a `title` in Title Case that may end in "!" ("Client Saved Successfully!"), and `data` (pretty-printed in `mono-data`).
