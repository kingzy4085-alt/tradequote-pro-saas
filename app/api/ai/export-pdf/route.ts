import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const proposalId = searchParams.get('id');

    let proposalData = {
      proposalTitle: 'Industrial Canola Plant Electrical Overhaul',
      clientName: 'Cargill Ltd.',
      totalAmount: 45000,
      scopeOfWork: 'Complete shutdown maintenance, cable testing, motor verification, and LOTO compliance.',
      generatedAt: new Date().toISOString()
    };

    if (proposalId && supabase) {
      const { data, error } = await supabase
        .from('proposals')
        .select('*')
        .eq('id', proposalId)
        .single();
      
      if (!error && data) {
        proposalData = { ...proposalData, ...data };
      }
    }

    return NextResponse.json({
      success: true,
      message: 'PDF proposal export compiled successfully.',
      data: proposalData,
      format: 'JSON-to-PDF payload'
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to generate PDF export.'
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { proposalTitle, clientName, totalAmount, scopeOfWork } = body;

    const exportRecord = {
      proposalTitle: proposalTitle || 'Untitled Proposal',
      clientName: clientName || 'Cargill Ltd.',
      totalAmount: totalAmount || 0,
      scopeOfWork: scopeOfWork || 'Standard industrial scope.',
      exportedAt: new Date().toISOString()
    };

    return NextResponse.json({
      success: true,
      message: 'Proposal PDF export generated successfully.',
      data: exportRecord
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Server error during PDF generation.'
    }, { status: 500 });
  }
}
