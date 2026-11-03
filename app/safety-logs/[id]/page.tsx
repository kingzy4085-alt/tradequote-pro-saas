import { RecordDetail } from '../../records-ui';

export default function Page({ params }: { params: { id: string } }) {
  return <RecordDetail module="safety-logs" id={params.id} />;
}
