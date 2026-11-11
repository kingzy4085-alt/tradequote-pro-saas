# Panel

The card that groups a page section: `surface-card`, `border-default`, `radius-2xl`, `shadow-xl`.

Hand-written from the create-form and navigation panels in `app/warranty/page.tsx` and `app/page.tsx`.

## When to use
Any section of a page: a create form ("Add New Record"), the module navigation, a settings group. Sections stack `space-8` apart.

## Consumer provides
`title`, optional `description` (the title then steps up to `section-title`), `roomy` for the 32px navigation panel, and children.
