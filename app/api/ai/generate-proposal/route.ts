import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { clientName, projectName, items, scopeNotes } = await request.json();
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({
        success: true,
        aiGeneratedScope: '[Offline Mode] Proposal scope generated for ' + (clientName || 'Client') + '.'
      });
    }

    const prompt = 'You are an expert trade contractor estimator. Write a professional project proposal scope of work for client ' + clientName + ' with items: ' + JSON.stringify(items);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://tradequotepro.local",
        "X-Title": "TradeQuote PRO"
      },
      body: JSON.stringify({
        model: "anthropic/claude-3.5-sonnet",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || "Generated proposal successfully.";

    return NextResponse.json({ success: true, aiGeneratedScope: aiContent });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
