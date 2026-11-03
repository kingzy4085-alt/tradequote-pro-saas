import { supabase } from '@/lib/supabase';
import { fail, isDate, ok, text } from '@/lib/api-helpers';
import { estimateTotals } from '@/lib/estimate-math';

const CATEGORIES = ['Material', 'Equipment', 'Subcontract', 'Other'];
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Job {
  project: string;
  estimates: number[];
  contract: number; // estimate price before tax + approved change orders
  budget_material: number;
  budget_labour: number;
  budget_hours: number;
  change_orders: number;
  actual_labour: number;
  actual_hours: number;
  actual_costs: Record<string, number>;
  billed: number;
  paid: number;
}

// Per-job budget vs actual: estimates and approved change orders against timecards and cost entries, plus billing
export async function GET() {
  if (!supabase) return fail('Database unavailable.', 503);
  const [ests, items, cos, cards, costs, invs] = await Promise.all([
    supabase.from('estimates').select('id, "projectName", "labourRate", "markupPercentage", status'),
    supabase.from('estimate_items').select('estimate_id, quantity, material_unit_cost, labour_hours_per_unit, description, unit'),
    supabase.from('change-orders').select('project, price, material_cost, labour_hours, labour_rate, status').eq('status', 'Approved'),
    supabase.from('timecards').select('project, regular_hours, overtime_hours, total_cost'),
    supabase.from('job-costing').select('id, project, category, vendor, description, amount, cost_date').order('cost_date', { ascending: false }),
    supabase.from('invoices').select('project, subtotal, status'),
  ]);
  const err = [ests, items, cos, cards, costs, invs].find((x) => x.error)?.error;
  if (err) return fail(err.message);

  const jobs: Record<string, Job> = {};
  const key = (p: string | null) => (p || '').trim().toLowerCase();
  const job = (p: string | null) => {
    const k = key(p);
    return (jobs[k] ||= { project: (p || '').trim() || '(no project)', estimates: [], contract: 0, budget_material: 0, budget_labour: 0, budget_hours: 0, change_orders: 0, actual_labour: 0, actual_hours: 0, actual_costs: {}, billed: 0, paid: 0 });
  };

  for (const e of ests.data!) {
    // Lost estimates aren't jobs
    if (e.status === 'Lost') continue;
    const t = estimateTotals(items.data!.filter((i) => String(i.estimate_id) === String(e.id)), e.labourRate, e.markupPercentage, 0);
    const j = job(e.projectName);
    j.estimates.push(e.id);
    j.contract += t.beforeTax;
    j.budget_material += t.material;
    j.budget_labour += t.labour;
    j.budget_hours += t.labourHours;
  }
  for (const c of cos.data!) {
    const j = job(c.project);
    j.change_orders += Number(c.price) || 0;
    j.contract += Number(c.price) || 0;
    j.budget_material += Number(c.material_cost) || 0;
    j.budget_labour += (Number(c.labour_hours) || 0) * (Number(c.labour_rate) || 0);
    j.budget_hours += Number(c.labour_hours) || 0;
  }
  for (const t of cards.data!) {
    const j = job(t.project);
    j.actual_labour += Number(t.total_cost) || 0;
    j.actual_hours += (Number(t.regular_hours) || 0) + (Number(t.overtime_hours) || 0);
  }
  for (const c of costs.data!) {
    const j = job(c.project);
    j.actual_costs[c.category || 'Other'] = (j.actual_costs[c.category || 'Other'] || 0) + (Number(c.amount) || 0);
  }
  for (const i of invs.data!) {
    const j = job(i.project);
    j.billed += Number(i.subtotal) || 0;
    if (i.status === 'Paid') j.paid += Number(i.subtotal) || 0;
  }

  const summary = Object.values(jobs).map((j) => {
    const actual_other = Object.values(j.actual_costs).reduce((s, v) => s + v, 0);
    const actual_total = j.actual_labour + actual_other;
    const budget_total = j.budget_material + j.budget_labour;
    return {
      ...j,
      contract: r2(j.contract), budget_material: r2(j.budget_material), budget_labour: r2(j.budget_labour), budget_hours: r2(j.budget_hours),
      change_orders: r2(j.change_orders), actual_labour: r2(j.actual_labour), actual_hours: r2(j.actual_hours), billed: r2(j.billed), paid: r2(j.paid),
      actual_material: r2(j.actual_costs.Material || 0),
      actual_total: r2(actual_total),
      budget_total: r2(budget_total),
      margin: r2(j.contract - actual_total),
      margin_pct: j.contract ? r2(((j.contract - actual_total) / j.contract) * 100) : null,
      cost_used_pct: budget_total ? r2((actual_total / budget_total) * 100) : null,
    };
  }).sort((a, b) => a.project.localeCompare(b.project));

  return ok({ jobs: summary, costs: costs.data, categories: CATEGORIES });
}

// Records an actual cost (material invoice, rental, subcontractor…) against a job
export async function POST(request: Request) {
  if (!supabase) return fail('Database unavailable.', 503);
  const body = await request.json().catch(() => ({}));
  const project = text(body.project, 200)?.trim();
  if (!project) return fail('Project is required.', 400);
  if (!CATEGORIES.includes(body.category)) return fail('Pick a cost category.', 400);
  const amt = Number(body.amount);
  if (!Number.isFinite(amt) || amt === 0) return fail('Enter the cost amount (use a negative number for a credit).', 400);
  if (!isDate(body.cost_date)) return fail('Date must be YYYY-MM-DD.', 400);
  const { data, error } = await supabase
    .from('job-costing')
    .insert([{ project, name: project, category: body.category, vendor: text(body.vendor, 200), description: text(body.description, 500), amount: r2(amt), cost_date: body.cost_date }])
    .select()
    .single();
  if (error) return fail(error.message);
  return ok(data);
}

