import RecordPage from '@/components/record-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'LOTO Permit · TradeQuote PRO' };

export default function LotoPermitPage({ params }: { params: { id: string } }) {
  return <RecordPage slug="loto-permits" id={params.id} />;
}
