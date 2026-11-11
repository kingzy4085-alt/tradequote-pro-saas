TradeQuote PRO is the operations hub for industrial shutdown and electrical contractors: estimates, proposals, crews, safety logs, LOTO permits, tool crib. Every screen is a dark control-room console — slate grounds, white figures, one amber signal colour — built to read in sunlight on a tablet and to work with gloves on.

## Content fundamentals

- **Voice: plain, operational, trade-literate.** Name the thing the crew calls it: *Estimates & Bidding*, *LOTO Permits*, *Tool Crib*, *Change Orders*, *Command Center*. Industrial nouns, no marketing adjectives.
- **Title Case for titles, buttons and nav labels:** "Warranty Management", "Add New Record", "Save Estimate", "View Proposals".
- **Labels are UPPERCASE `label` style:** "PROJECT NAME", "ACTIVE CRM CLIENTS", "← BACK TO COMMAND CENTER".
- **Create actions lead with a plus:** "+ New Estimate". Back links lead with an arrow: "← Back to Command Center".
- **Placeholders give a real job, prefixed "e.g.":** "e.g. Canola Plant Shutdown Maintenance", "e.g. Cargill Ltd.". Search placeholders say what they search: "Search estimates by project or client...".
- **States speak in full sentences:** loading "Loading records...", empty "No records found. Add one above." Success titles may end in "!" ("Client Saved Successfully!"); nothing else does.
- **Spelling is Canadian where it differs:** *labour*, not *labor*.
- **No emoji.** Glyphs are limited to `+` and `←`.

## Visual foundations

### Colour

- Paint the page `surface-page`; put every grouped thing on `surface-card` with a 1px `border-default` edge, `radius-2xl` and `shadow-xl`. Recess inputs and tiles inside a card with `surface-inset`.
- Text: `ink-strong` for headings, figures and primary cells; `ink` for body; `ink-secondary` for secondary cells; `ink-muted` for subtitles, labels and table headers. Keep `ink-subtle` to loading/empty rows and placeholders — it is below 4.5:1 on both grounds.
- **Amber is the only brand colour.** `accent` fills the one primary action per view, with `ink-on-accent` text, and marks focus (`focus-ring`). `accent-text` carries amber words on dark grounds: stat captions, badges, the hovered tile. `accent-soft` + `accent-soft-border` make the status pill.
- Destructive actions are soft, never solid: `danger-soft` fill, `danger-border` edge, `danger-text` label, `danger-soft-hover` on hover.
- Module-level colours mark a form's submit and its result panel, one per module: `success` (CRM), `info` (Proposals), `critical` (Punch List), each with its `-text` title and `-border` edge. Their buttons carry `ink-strong` text; `success` and every `-hover` fill are below 4.5:1 with white — keep those labels 16px semibold or larger and prefer `accent` for new primary actions.
- Focus is amber everywhere: use `focus-ring`. Some older forms (CRM, Proposals, Punch List, Sub Compliance) focus in `info-hover` blue; that is drift, not a variant.
- Colour never carries meaning alone: badges always say their status in words.
- Printed proposals switch to `print-paper` with `print-ink`, `print-ink-body`, `print-ink-muted`, `print-ink-subtle`, and no amber.

### Type

- One family: **Inter** (`sans`), from Google Fonts. Mono (`mono`) is the system monospace stack, used only for JSON results and code-like values (`mono-data`).
- One `page-title` per page, `tracking-tight`. `section-title` for panel and modal titles, `card-title` for form panels.
- `metric-value` (36px extrabold) is only for stat-card figures.
- `body-sm` is the working size: tables, descriptions, tiles. Use weight 500 for the name column.
- `label` is always uppercase with 0.05em tracking.

### Spacing and layout

- Pages: `space-8` padding, content centred in `size-container`; sections stacked `space-8` apart.
- Cards: `space-6` padding (`space-8` for the navigation panel); stat grid gap `space-6`; form and tile grid gaps `space-4` / `space-3`.
- Tables: `space-4` cell padding, header row in `surface-table-head`, rows divided by `border-default`, hover `surface-row-hover`.
- Header layout: title block left, actions right, stacking below 768px.
- Grids collapse: stats 3 → 2 → 1 columns; module tiles 6 → 4 → 3 → 2.

### Shape, depth, motion

- Radii step with size: `radius-lg` for header buttons and compact inputs, `radius-xl` for form controls and tiles, `radius-2xl` for cards and modals, `radius-full` only for badges.
- Depth comes from borders first, then `shadow-xl` on cards and `shadow-2xl` on modals. No gradients, no glow.
- Modals sit on `scrim` with a small backdrop blur.
- Motion is colour-only: 150ms `transition-colors` on hover. Nothing moves or scales.

### Field use

- Under 768px every button, link, input and select is at least `size-touch` (48px) tall and wide.
- Tables scroll sideways on touch instead of wrapping.
- Focus is unmistakable: 2px `focus-ring` outline plus border.

## Iconography

TradeQuote PRO uses no icons today. `lucide-react` is installed but imported nowhere; the only glyphs are typed characters (`+`, `←`). If icons are added, use Lucide at 16px / 1.5 stroke in `currentColor`, beside text, never alone. There is no logo: set the product name in Inter 800, `ink-strong`, written exactly "TradeQuote PRO".

## Components

Every component here was hand-written from the class patterns repeated across `app/**/page.tsx`; the codebase has no component library of its own. Classes are prefixed `tq-` in `components/bundle.css`.

## Not synced

- **Font:** `app/layout.tsx` loads Inter through `next/font` as `--font-Inter-sans` and `--font-Inter-mono`, but `tailwind.config.js` never maps them, so the app actually renders in the system UI font. This system sets Inter as intended.
- **Row hover:** pages use `hover:bg-slate-850/50`, which is not a Tailwind colour and renders nothing; `surface-row-hover` is the stated fix.
- **Focus rule:** `globals.css` scopes its amber outline to `.dark input:focus`, but no `.dark` class is ever set, so only the `focus:border-amber-500` utility applies.
- **Not built:** there are no component sources to build from; `components/bundle.js` is hand-written. The Login page is a stub and the proposal export page was taken only as print colours.
- **Assets:** no logo or brand files exist in the repo (`public/` holds the Next.js starter SVGs only).
