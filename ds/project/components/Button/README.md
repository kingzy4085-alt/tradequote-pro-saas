# Button

Buttons trigger one action; amber `primary` is the single main action on a view.

Hand-written from `app/page.tsx`, `app/estimates/page.tsx`, `app/warranty/page.tsx` and `app/crm/page.tsx`.

## When to use
- `primary` (amber) for the one create/save action: "+ New Estimate", "Save Estimate", "Add Record".
- `secondary` for a second header action beside primary: "View Proposals".
- `ghost` for Cancel inside a modal.
- `danger` with `size="sm"` for row actions like Delete — soft, never a solid red.
- `success` / `info` / `critical` only as a module's full-width form submit (CRM, Proposals, Punch List).

## Sizes
`sm` row actions (12px, radius-lg) · `md` header actions (radius-lg) · `lg` inline form submit (radius-xl) · `block` full-width form submit (radius-xl).

## Consumer provides
Label text in Title Case (lead create actions with "+ "), `onClick` or `href`, `type="submit"` in forms.

## Don't
Put two primary buttons side by side. Use white text on `success-hover` / `info-hover` / `critical-hover` below 16px.
