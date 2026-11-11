import RecordPage from '@/components/record-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Safety Inspection · TradeQuote PRO' };

export default function SafetyInspectionPage({ params }: { params: { id: string } }) {
  return <RecordPage slug="safety-inspections" id={params.id} />;
}
