# Launch Checklist

## Release baseline — complete

- [x] Full regression suite passes.
- [x] Production build passes.
- [x] TypeScript validation passes.
- [x] Database migrations aligned with Production.
- [x] Production database compatibility repairs deployed.
- [x] Auth/password-recovery focused suite passes.
- [x] Stripe/billing focused suite passes.
- [x] Active transactional email/automation suite passes.
- [x] Core sellable workflow suite passes.
- [x] Live Production smoke test passes.
- [x] Logical Production schema backup created.
- [x] Logical Production data backup created.

## Before public marketing launch

- [ ] Select final product name.
- [ ] Replace **[Final Product Name]** placeholders across public assets.
- [ ] Verify `EMAIL_FROM` domain is verified and healthy in Resend.
- [ ] Confirm the intended Production Stripe product/price and Customer Portal configuration in Stripe.
- [ ] Confirm Supabase Auth Site URL and allowed recovery redirect URLs match the final public domain.
- [ ] Perform one real human signup/onboarding test using a clean account.
- [ ] Perform one real password-reset delivery test in Production.
- [ ] Perform one controlled Stripe test/live transaction appropriate to the launch plan.
- [ ] Perform one real client proposal-share test from creation through response notification.
- [ ] Confirm legal pages contain the final business/product identity.
- [ ] Confirm pricing and trial copy matches the intended commercial offer.

## Recovery and operations

- [ ] Create a repeatable schedule for logical database backups.
- [ ] Establish Supabase Storage object backup/recovery coverage.
- [ ] Decide whether to enable PITR.
- [ ] Document the restore procedure and perform a restore drill in a disposable environment.
- [ ] Confirm operator alert email receives automation failures.

## Post-release engineering

- [ ] Controlled encoding/mojibake cleanup.
- [ ] Remove or replace unused `/api/send-proposal` route.
- [ ] Add ESLint as an explicit CI gate.
- [ ] Plan and test Stripe API-version upgrade.
- [ ] Review remaining inactive Production DB lint findings.
