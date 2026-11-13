import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const prompt = `Analyze the following scope document and extract:
1. Estimated Labor (in hours)
2. Estimated Material Cost (in USD)
3. A summary of the scope of work

Return ONLY a JSON object with this structure:
{
  "estimatedLabor": number,
  "estimatedMaterials": number,
  "description": string
}
`;

    const result = await model.generateContent([
        {
            inlineData: {
                data: base64Data,
                mimeType: file.type
            }
        },
        prompt
    ]);

    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\{.*\}/s);
    
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response as JSON");
    }

    const data = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      success: true,
      data
    });
  } catch (err: any) {
    console.error("AI Extraction Error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
