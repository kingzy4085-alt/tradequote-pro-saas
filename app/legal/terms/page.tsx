export const metadata = { title: 'Terms of Service · TradeQuote PRO' };

// TEMPLATE — have a Canadian lawyer review and complete the bracketed details before launch.
export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-amber-300 text-sm">Draft template. Replace the bracketed details and have it reviewed by counsel before accepting customers.</p>
      <p>Last updated: [date]</p>
      <p>These terms are an agreement between your company and [legal company name] for the use of TradeQuote PRO.</p>
      <h2>Subscription and trial</h2>
      <p>
        New companies get a 14-day free trial. After that, the subscription is billed monthly in Canadian dollars until cancelled. You can cancel at any time from the Billing
        page; access continues to the end of the paid period. Prices exclude applicable taxes.
      </p>
      <h2>Your data</h2>
      <p>Your company owns the records it enters. You grant us permission to host and process them only to provide the service. You can export or request deletion of your data.</p>
      <h2>AI Assistant</h2>
      <p>
        The AI Assistant provides general information to help your team. It can be wrong. It is not engineering, legal or code-compliance advice, and it does not replace the
        current code documents adopted in your jurisdiction, the authority having jurisdiction, or a qualified professional. Always verify code requirements and prices before
        relying on them.
      </p>
      <h2>Acceptable use</h2>
      <p>Don&apos;t misuse the service, attempt to access other companies&apos; data, or use it to break the law.</p>
      <h2>Availability</h2>
      <p>We work to keep the service available but don&apos;t guarantee it will be uninterrupted. [Service level, if any.]</p>
      <h2>Liability</h2>
      <p>[Limitation of liability — to be drafted by counsel.]</p>
      <h2>Governing law</h2>
      <p>These terms are governed by the laws of [province] and the federal laws of Canada that apply there.</p>
      <h2>Contact</h2>
      <p>[Legal company name], [address], [support email].</p>
    </>
  );
}
