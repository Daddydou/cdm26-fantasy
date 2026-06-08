import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'

const supabaseUrl = 'https://ubnkuwyqclrjckogldlc.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVibmt1d3lxY2xyamNrb2dsZGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTI4MTYsImV4cCI6MjA5MTA2ODgxNn0.-AYb_Zabujcbv_TNmwaUEwhn4V7NVR043TrvRtGEmfE'

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(`Missing Supabase config: url=${supabaseUrl}, key=${supabaseAnonKey?.slice(0,10)}`)
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'cdm26-auth',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
})

export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  typeof window === 'undefined' ? (process.env.SUPABASE_SERVICE_ROLE_KEY || '') : supabaseAnonKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
)