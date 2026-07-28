import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(url && anonKey);

// Google OAuth のようなコンソール操作（クライアント作成・同意画面設定）を避けるため、
// マジックリンクのメールログインだけを使う。
export function initSupabase() {
  if (!hasSupabaseConfig) return null;
  const client = createClient(url, anonKey);
  return {
    client,
    signIn: (email) => client.auth.signInWithOtp({ email }),
    signOut: () => client.auth.signOut(),
    onChange: (fn) =>
      client.auth.onAuthStateChange((_event, session) => fn(session ? session.user : null)),
  };
}
