import RecordPage from '@/components/record-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tailgate Meeting · TradeQuote PRO' };

export default function TailgateLogPage({ params }: { params: { id: string } }) {
  return <RecordPage slug="tailgate-logs" id={params.id} />;
}
