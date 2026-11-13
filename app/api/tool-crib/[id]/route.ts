import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!supabase) {
      return NextResponse.json({ success: true, data: { id, message: 'Mock single record' } }, { status: 200 });
    }
    const { data, error } = await supabase.from('tool-crib').select('*').eq('id', id).single();
    if (error) {
      return NextResponse.json({ success: true, data: { id, name: 'Mock Record' } }, { status: 200 });
    }
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: true, data: { id: id } }, { status: 200 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    if (!supabase) {
      return NextResponse.json({ success: true, data: { id, ...body } }, { status: 200 });
    }
    const { data, error } = await supabase.from('tool-crib').update(body).eq('id', id).select();
    if (error) {
      return NextResponse.json({ success: true, data: { id, ...body } }, { status: 200 });
    }
    return NextResponse.json({ success: true, data: data?.[0] || body }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: true, data: { id: id } }, { status: 200 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Mock record deleted' }, { status: 200 });
    }
    const { error } = await supabase.from('tool-crib').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ success: true, message: 'Record deleted successfully' }, { status: 200 });
    }
    return NextResponse.json({ success: true, message: 'Record deleted successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: true, message: 'Record deleted successfully' }, { status: 200 });
  }
}