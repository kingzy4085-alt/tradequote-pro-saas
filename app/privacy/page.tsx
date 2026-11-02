import { LegalPage } from '../legal';

export const metadata = { title: 'Privacy Policy — TradeQuote PRO' };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="November 1, 2026"
      sections={[
        ['Who we are', 'TradeQuote PRO is a software service for contractors. This policy explains how we collect, use and protect personal information, in line with Canada\'s Personal Information Protection and Electronic Documents Act (PIPEDA).'],
        ['What we collect', 'When you join the founding list: your name, company, email, phone (optional) and chosen plan. When you use the Service: the business records you enter, such as clients, estimates, timecards and logs, which may include names and contact details of your staff and clients.'],
        ['Why we collect it', 'To contact you about your account and founding offer, to provide and support the Service, to bill for subscriptions, and to keep the Service secure. We do not sell personal information.'],
        ['Consent', 'By submitting a form or using the Service, you consent to the collection and use described here. You may withdraw consent at any time, subject to legal or contractual limits; this may mean we can no longer provide the Service.'],
        ['Where it is stored', 'Data is stored with our hosting providers, Supabase (database) and Vercel (application hosting), which may process data outside Canada, including in the United States. Payments, when enabled, are handled by Stripe; we do not store card numbers.'],
        ['How long we keep it', 'Founding-list details are kept until you ask us to remove them or 24 months pass without an account being created. Account data is kept while your subscription is active and deleted within 90 days after you close your account, unless the law requires us to keep it longer.'],
        ['Security', 'We use encrypted connections, access controls and row-level security on our database. No system is perfectly secure; we will notify affected users of any breach that creates a real risk of significant harm, as PIPEDA requires.'],
        ['Your rights', 'You can ask to see, correct or delete the personal information we hold about you, or ask questions about this policy, by contacting us through the form on our Pricing page. We will respond within 30 days.'],
        ['Cookies', 'The Service uses only the storage needed to keep you signed in and remember your settings on your device. We do not use advertising trackers.'],
        ['Changes', 'We will post any changes here and update the date above.'],
      ]}
    />
  );
}
