import { createBrowserClient } from "@supabase/ssr";

function publicSupabaseConfig() {
  const viteEnv = import.meta.env as Record<string, string | undefined>;
  const url = viteEnv.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY ??
    viteEnv.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase público não configurado.");
  return { url, key };
}

export function createSupabaseBrowserClient() {
  const { url, key } = publicSupabaseConfig();
  return createBrowserClient(url, key);
}

// Recovery exchanges its code explicitly, without racing automatic URL detection.
export function createSupabasePasswordRecoveryClient() {
  const { url, key } = publicSupabaseConfig();
  return createBrowserClient(url, key, {
    isSingleton: false,
    auth: { detectSessionInUrl: false },
  });
}
