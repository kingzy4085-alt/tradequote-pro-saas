import { RecordDetail } from '../../records-ui';

export default function Page({ params }: { params: { id: string } }) {
  return <RecordDetail module="tailgate-logs" id={params.id} />;
}
