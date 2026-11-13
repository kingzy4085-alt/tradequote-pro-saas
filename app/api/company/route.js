import { NextResponse } from 'next/server';

// In-memory fallback store for local dev when DB is disconnected
let mockDbCompany = {
  company_name: 'ingzys automation',
  main_contact: 'kyle ingalls',
  phone: '3066840899',
  email: 'kingzy4085@gmail.com',
  address: '965 Grace St',
  province: 'SK',
  default_markup: 15,
  sales_tax: 5,
  labour_rate: 36.50,
  proposal_terms: '1. Validity: This proposal is valid for 30 days from the date of issuance. 2. Payment Terms: Net 30 days upon invoice receipt unless otherwise agreed. A 1.5% monthly late fee applies to overdue balances. 3. Scope & Variations: Any additions, alterations, or deviations from the specified scope of work will be executed only upon written authorization and may incur additional charges. 4. Warranties: All labor is warranted for 1 year from completion. Material warranties are provided directly by the manufacturer.'
};

export async function GET() {
  return NextResponse.json({ success: true, company: mockDbCompany });
}

export async function PUT(request) {
  try {
    const body = await request.json();
    mockDbCompany = { ...mockDbCompany, ...body };
    return NextResponse.json({ success: true, company: mockDbCompany });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
export async function POST(request) {
  return PUT(request);
}
