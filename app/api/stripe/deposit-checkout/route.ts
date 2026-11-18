import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/api';

export async function POST(request: Request) {
  try {
    await requireApi({ minRank: 20, write: true });
    
    const { proposalId, amount } = await request.json();

    if (!proposalId) {
      return NextResponse.json({ error: 'Proposal ID is required' }, { status: 400 });
    }

    return NextResponse.json({ success: true, url: '#' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}



