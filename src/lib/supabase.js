import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const ROW_ID = 'default'

export async function cloudLoad() {
  const { data, error } = await supabase
    .from('portfolio_state')
    .select('data')
    .eq('id', ROW_ID)
    .maybeSingle()
  if (error) throw error
  return data?.data ?? null
}

export async function cloudSave(snapshot) {
  const { error } = await supabase
    .from('portfolio_state')
    .upsert({ id: ROW_ID, data: snapshot, updated_at: new Date().toISOString() })
  if (error) throw error
}
