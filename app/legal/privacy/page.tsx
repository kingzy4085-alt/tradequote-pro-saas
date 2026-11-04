export const metadata = { title: 'Privacy Policy · TradeQuote PRO' };

// TEMPLATE — have a Canadian lawyer review and complete the bracketed details before launch.
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-amber-300 text-sm">Draft template. Replace the bracketed details and have it reviewed by counsel before accepting customers.</p>
      <p>Last updated: [date]</p>
      <p>
        [Legal company name] (&quot;we&quot;) operates TradeQuote PRO. This policy explains how we collect, use and protect personal information in line with the Personal
        Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial privacy laws.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, work email, company name, province and role.</li>
        <li>Records your company enters: estimates, proposals, timecards, safety logs, employee and subcontractor details, and similar operational data.</li>
        <li>Billing details, handled by our payment processor (Stripe). We never store full card numbers.</li>
        <li>Questions sent to the AI Assistant, which are processed by our AI provider (Anthropic) to generate answers.</li>
        <li>Technical data such as sign-in times and error logs, used to keep the service secure and working.</li>
      </ul>
      <h2>How we use it</h2>
      <p>To provide and secure the service, bill your subscription, answer support requests and meet legal obligations. We do not sell personal information.</p>
      <h2>Who we share it with</h2>
      <p>
        Service providers who process data on our behalf: [hosting provider], Supabase (database and authentication), Stripe (payments) and Anthropic (AI Assistant). Some
        providers may store or process data outside Canada, including in the United States. [List data locations.]
      </p>
      <h2>Your company&apos;s data</h2>
      <p>Each company&apos;s records are isolated from every other company. Your company&apos;s owner and admins control who on your team can see which records.</p>
      <h2>Retention</h2>
      <p>We keep your data while your account is active and for [period] after cancellation, unless the law requires longer. You can request deletion at any time.</p>
      <h2>Your rights</h2>
      <p>You can ask to access or correct your personal information, or withdraw consent, by contacting our Privacy Officer at [privacy email]. You may also contact the Office of the Privacy Commissioner of Canada.</p>
      <h2>Contact</h2>
      <p>Privacy Officer, [legal company name], [address], [privacy email].</p>
    </>
  );
}
