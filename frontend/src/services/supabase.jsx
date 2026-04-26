import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getSupabaseConfigError() {
  if (isSupabaseConfigured) return null;
  return 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY';
}

export async function signInWithGoogle() {
  if (!supabase) {
    return { error: new Error(getSupabaseConfigError()) };
  }

  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // redirectTo: 'http://localhost:5174/dashboard',
      redirectTo: `${window.location.origin}/dashboard`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
}

export async function signOutUser() {
  if (!supabase) {
    return { error: new Error(getSupabaseConfigError()) };
  }

  return supabase.auth.signOut();
}
