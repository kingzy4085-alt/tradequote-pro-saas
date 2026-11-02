import { LegalPage } from '../legal';

export const metadata = { title: 'Terms of Service — TradeQuote PRO' };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="November 1, 2026"
      sections={[
        ['1. Agreement', 'By accessing or using TradeQuote PRO (the "Service"), you agree to these Terms. If you use the Service on behalf of a company, you confirm you have authority to bind that company. If you do not agree, do not use the Service.'],
        ['2. The Service', 'TradeQuote PRO is a hosted software service for estimating, project management and field reporting for contractors. Features may change over time. Features described as "coming soon" are not part of any current plan.'],
        ['3. Accounts', 'You are responsible for keeping your sign-in details confidential and for all activity under your account. Tell us promptly about any unauthorized use.'],
        ['4. Subscriptions and payment', 'Paid plans are billed in Canadian dollars, monthly or annually, in advance. Fees are non-refundable except where required by law. We may change prices with at least 30 days\' notice; changes apply from your next billing period. Founding-customer discounts apply for as long as the subscription stays active and in good standing.'],
        ['5. Your data', 'You own the data you enter into the Service. You grant us a limited licence to host, process and back it up solely to provide the Service. You can export or request deletion of your data at any time. You are responsible for the accuracy of your estimates, proposals, safety and compliance records.'],
        ['6. Acceptable use', 'You may not misuse the Service, attempt to access other customers\' data, interfere with its operation, reverse-engineer it, or resell it without written permission.'],
        ['7. Intellectual property', 'The Service, including its software, design and content, is owned by the owner of TradeQuote PRO and protected by copyright. These Terms grant you a limited, non-exclusive, non-transferable right to use the Service during your subscription; no ownership is transferred.'],
        ['8. Safety and professional judgement', 'The Service is a record-keeping and productivity tool. It does not replace professional judgement, electrical codes, permits, inspections, or your legal obligations for workplace safety (including lockout/tagout procedures). Always follow applicable codes and regulations.'],
        ['9. Disclaimer', 'The Service is provided "as is" and "as available". To the extent permitted by law, we disclaim all warranties, express or implied, including fitness for a particular purpose and uninterrupted or error-free operation.'],
        ['10. Limitation of liability', 'To the extent permitted by law, our total liability for any claim relating to the Service is limited to the fees you paid in the 12 months before the claim. We are not liable for indirect, incidental or consequential damages, including lost profits, lost bids or lost data.'],
        ['11. Termination', 'You may cancel at any time; access continues until the end of the paid period. We may suspend or end access for breach of these Terms. On termination you may request an export of your data within 30 days.'],
        ['12. Governing law', 'These Terms are governed by the laws of the Province of Saskatchewan and the federal laws of Canada that apply there.'],
        ['13. Changes', 'We may update these Terms. We will post the new version here and update the date above; material changes will be notified to active customers.'],
      ]}
    />
  );
}
