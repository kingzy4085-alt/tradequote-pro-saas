import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { provinceName } from '@/lib/provinces';
import AssistantChat from './assistant-chat';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Assistant · TradeQuote PRO' };

export default async function AssistantPage() {
  const result = await getContext();
  if (result.status !== 'ok') redirect('/login');
  return <AssistantChat province={provinceName(result.ctx.company.province)} />;
}
