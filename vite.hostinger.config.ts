import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  return {
    base: "/",
    plugins: [react()],
    define: {
      "process.env.NEXT_PUBLIC_DEPLOY_TARGET": JSON.stringify("static-hostinger"),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(supabaseKey),
    },
    build: {
      outDir: "dist-hostinger",
      emptyOutDir: true,
    },
  };
});
