import { supabase } from './supabase';
import { amount, isDate, text } from './api-helpers';

export const TIMECARD_COLS = 'id, created_at, work_date, employee_name, project, task, regular_hours, overtime_hours, hourly_cost, total_cost, status, approved_by, approved_at';

// Labour cost = regular hours × rate + overtime hours × rate × the company's overtime multiplier
export async function costOf(regular: number, overtime: number, rate: number) {
  const { data: id } = await supabase!.rpc('current_company_id');
  const { data } = await supabase!.from('companies').select('overtime_multiplier').eq('id', id).maybeSingle();
  const mult = Number(data?.overtime_multiplier) || 1.5;
  return Math.round((regular * rate + overtime * rate * mult) * 100) / 100;
}

export function parseEntry(body: Record<string, unknown>) {
  const employee_name = text(body.employee_name, 200)?.trim();
  const project = text(body.project, 200)?.trim();
  if (!employee_name) return { error: 'Worker name is required.' };
  if (!project) return { error: 'Project is required.' };
  if (!isDate(body.work_date)) return { error: 'Date must be YYYY-MM-DD.' };
  const regular_hours = amount(body.regular_hours), overtime_hours = amount(body.overtime_hours), hourly_cost = amount(body.hourly_cost);
  if (regular_hours === null || overtime_hours === null || hourly_cost === null) return { error: 'Hours and rate must be numbers of 0 or more.' };
  if (regular_hours + overtime_hours > 24) return { error: 'More than 24 hours in one day.' };
  if (regular_hours + overtime_hours === 0) return { error: 'Enter the hours worked.' };
  return { row: { employee_name, project, name: employee_name, task: text(body.task, 500), work_date: body.work_date as string, regular_hours, overtime_hours, hourly_cost } };
}

