import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const viteEnv = import.meta.env as Record<string, string | undefined>;
  const url = viteEnv.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY ??
    viteEnv.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase público não configurado.");
  return createBrowserClient(url, key);
}
