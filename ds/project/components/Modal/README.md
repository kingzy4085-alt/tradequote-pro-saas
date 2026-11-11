# Modal

A centred dialog on a blurred `scrim` for creating a record without leaving the list.

Hand-written from the Create New Estimate modal in `app/estimates/page.tsx`.

## When to use
Short create forms of up to about four fields. Longer forms get their own Panel on the page.

## Consumer provides
`title` ("Create New Estimate"), `open`, `onClose`, fields as children (compact TextFields), and `actions`: a ghost Cancel, then the primary action ("Save Estimate").
