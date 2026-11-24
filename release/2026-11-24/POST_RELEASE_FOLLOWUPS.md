# Post-Release Follow-Ups

## P1 — before broad public launch

### Final brand
Choose the final product name and replace the `[Final Product Name]` placeholder in all customer-facing assets. Do not create more launch collateral under the temporary TradeQuote PRO name.

### Real-world email verification
Confirm the configured `EMAIL_FROM` domain is verified in Resend and complete a real password-reset and notification delivery test.

### Storage recovery
Create and verify a backup/recovery plan for actual Supabase Storage objects. Database dumps protect database records and Storage metadata, not the stored files themselves.

### Human end-to-end launch rehearsal
Use a clean account to rehearse signup → onboarding → estimate → proposal → client share → acceptance → project → Job Costing → billing.

## P2 — shortly after launch

### PITR decision
Evaluate whether the Production plan should enable Point-in-Time Recovery based on acceptable recovery-point and recovery-time objectives.

### Encoding polish
Perform a narrow UTF-8 cleanup of visible mojibake without broad search-and-replace operations.

### Legacy route cleanup
Remove or replace the unused `/api/send-proposal` endpoint after confirming no external integration depends on it.

### Explicit lint gate
Introduce ESLint as a deliberate CI/tooling change, fix findings in a dedicated branch, then remove `ignoreDuringBuilds` only when the new gate is reliably green.

### Stripe API-version upgrade
Treat the Stripe API-version change as its own compatibility project with webhook and subscription regression testing.

### Database drift classification
Continue classifying remaining Production lint findings by active callers/triggers before modifying or deleting legacy database functions.
