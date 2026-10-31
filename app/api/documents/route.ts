import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, fileName, fileUrl, version } = body;

    const { data, error } = await supabase
      .from('documents')
      .insert([{ project_id: projectId, file_name: fileName, file_url: fileUrl, version: version || '1.0' }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
