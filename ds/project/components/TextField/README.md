# TextField

A labelled text input on the recessed `surface-inset` ground with an amber focus edge.

Hand-written from `app/estimates/page.tsx` (modal fields) and `app/warranty/page.tsx` (inline form).

## When to use
Every free-text, number or search field. Use `compact` in modals and for the search bar; `mono` for phone, PO or serial numbers.

## Consumer provides
`label` (rendered uppercase), `value`/`onChange`, a placeholder that gives a real example prefixed "e.g." (search fields say what they search).

## Don't
Focus in blue — focus is always `focus-ring` amber. Put the label inside the field as a placeholder only.
