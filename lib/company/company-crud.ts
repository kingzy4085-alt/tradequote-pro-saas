import { supabase } from '@/lib/supabase'

export async function getCompanyRecords(
 table: string,
 companyId: string
){
 return supabase
   ?.from(table)
   .select('*')
   .eq('company_id', companyId)
}
