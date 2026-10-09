import { pathToFileURL } from "node:url";

// Public project identifier, not an API key. Changing the production database
// must be an explicit code review, never an accidental replacement of a secret.
export const RH_SUPABASE_PROJECT_REF = "kdbnheeosaptxpwkmjbz";

export function validateProductionConfig(env) {
  const rawUrl = String(env.RH_URL ?? "").trim();
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("Publicação bloqueada: URL do Supabase ausente ou inválida."); }
  if (url.origin !== `https://${RH_SUPABASE_PROJECT_REF}.supabase.co` || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Publicação bloqueada: a URL não corresponde ao projeto Supabase do RH Controle.");
  }
  const key = String(env.RH_KEY ?? "").trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    let claims;
    try {
      const parts = key.split(".");
      if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch { throw new Error("Publicação bloqueada: use uma chave publishable ou anon, nunca uma chave privada."); }
    if (claims?.role !== "anon" || claims?.ref !== RH_SUPABASE_PROJECT_REF) {
      throw new Error("Publicação bloqueada: a chave legada deve ser anon e pertencer ao projeto correto.");
    }
  }
  for (const field of ["FTP_SERVER", "FTP_USERNAME", "FTP_PASSWORD"]) {
    if (!String(env[field] ?? "").trim()) throw new Error(`Publicação bloqueada: configure o secret HOSTINGER_${field}.`);
  }
  return { url: url.origin, key };
}

export async function verifyProductionSupabase(config, request = fetch) {
  // Public Auth settings: read-only, no employee/payroll data or user session.
  const response = await request(`${config.url}/auth/v1/settings`, {
    headers: { apikey: config.key },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Publicação bloqueada: o Supabase não aceitou a configuração pública (HTTP ${response.status}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = validateProductionConfig(process.env);
    await verifyProductionSupabase(config);
    console.log("Configuração pública do Supabase e secrets FTP presentes; destino isolado em administrativo.");
  } catch (error) {
    // Do not print response bodies, API keys, FTP credentials or fetch errors.
    console.error(error instanceof Error && error.message.startsWith("Publicação bloqueada:") ? error.message : "Publicação bloqueada: não foi possível verificar o Supabase. Tente novamente antes de publicar.");
    process.exitCode = 1;
  }
}
