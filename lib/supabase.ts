// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

// Client-side (public)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server-side (service role — for file uploads)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export async function uploadScreenshot(file: File, tradeId: string): Promise<string | null> {
  const ext = file.name.split('.').pop()
  const path = `screenshots/${tradeId}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from('elistas-trades')
    .upload(path, file, { upsert: true })

  if (error) { console.error('Upload error:', error); return null }

  const { data } = supabaseAdmin.storage.from('elistas-trades').getPublicUrl(path)
  return data.publicUrl
}
