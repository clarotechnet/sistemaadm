export function createEmployeeQuarkRequester(options: { base: string; token: string; deadline: number; fetcher?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void>; intervalMs?: number }) {
  const now = options.now ?? Date.now, fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let nextAt = 0;
  return async (path: string, unit?: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = Math.max(0, nextAt - now());
      if (now() + delay + 1000 >= options.deadline) throw new Error("A API não liberou a consulta dentro do prazo. Aguarde e tente novamente; os cadastros foram preservados.");
      if (delay) await wait(delay);
      const response = await fetcher(options.base + path, { headers: { Accept: "application/json", "Auth-Token": options.token, "User-Agent": "RH-Control-Quark-Sync/1.0", ...(unit ? { "Unidade-ID": unit } : {}) }, signal: AbortSignal.timeout(Math.min(20000, options.deadline - now())) });
      nextAt = now() + (options.intervalMs ?? 1200);
      if (response.status === 429) {
        const raw = response.headers.get("Retry-After"), seconds = raw === null ? NaN : Number(raw);
        const retry = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : raw && Number.isFinite(Date.parse(raw)) ? Math.max(0, Date.parse(raw) - now()) : 2000 * 2 ** attempt;
        nextAt = Math.max(nextAt, now() + retry); await response.body?.cancel();
        if (attempt < 2) continue;
      }
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`QuarkRH HTTP ${response.status}${unit ? ` na unidade ${unit}` : " ao descobrir unidades"}. Os cadastros foram preservados.`); }
      try { return await response.json() as unknown; } catch { throw new Error("Resposta QuarkRH inválida. Os cadastros foram preservados."); }
    }
    throw new Error("Não foi possível concluir a consulta QuarkRH.");
  };
}
