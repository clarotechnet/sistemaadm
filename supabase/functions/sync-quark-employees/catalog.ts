export type QuarkObject = Record<string, unknown>;
export const quarkObject = (value: unknown): QuarkObject => value && typeof value === "object" && !Array.isArray(value) ? value as QuarkObject : {};
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
export function quarkList(value: unknown): QuarkObject[] {
  if (Array.isArray(value)) {
    if (value.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("QuarkRH retornou registros inválidos.");
    return value as QuarkObject[];
  }
  const row = quarkObject(value);
  for (const key of ["dados", "content", "data", "items", "results", "result", "records", "registros", "colaboradores", "unidades", "lista"]) {
    if (Array.isArray(row[key])) return quarkList(row[key]);
  }
  for (const child of Object.values(row)) if (child && typeof child === "object" && !Array.isArray(child)) {
    try { return quarkList(child); } catch { /* Another response container. */ }
  }
  throw new Error("QuarkRH retornou uma resposta sem lista reconhecida. A sincronização não foi gravada.");
}
export function quarkUnits(rows: QuarkObject[]) {
  const units = new Map<string, { id: string; name: string; city: string }>();
  for (const row of rows) {
    const id = text(row.id ?? row.unidadeId ?? row.unidade_id);
    if (!/^\d+$/.test(id)) throw new Error("Unidade QuarkRH com identificador inválido.");
    const name = [row.nomeFantasia, row.razaoSocial, row.nome, row.denominacao, row.descricao, row.sigla].map(text).find(Boolean) || id;
    const address = quarkObject(row.endereco), city = row.cidade ?? row.municipio ?? address.cidade ?? address.municipio;
    units.set(id, { id, name, city: typeof city === "string" ? city.trim() : text(quarkObject(city).nome ?? quarkObject(city).denominacao) });
  }
  return [...units.values()];
}
export async function collectQuarkPages(request: (query: string) => Promise<unknown>) {
  const rows: QuarkObject[] = [], seen = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const list = quarkList(await request(new URLSearchParams({ page: String(page), page_size: "100" }).toString()));
    let added = 0;
    for (const row of list) {
      const id = text(row.id ?? row.colaboradorId ?? row.colaborador_id ?? row.unidadeId);
      if (!id) throw new Error("QuarkRH retornou um registro sem identificador.");
      if (!seen.has(id)) { seen.add(id); rows.push(row); added++; }
    }
    if (list.length < 100) return rows;
    if (!added) throw new Error("QuarkRH repetiu uma página. A sincronização não foi gravada.");
  }
  throw new Error("A consulta excedeu 100 páginas. A sincronização não foi gravada.");
}
type Identity = { cpf: string; external_id: string; external_unit_id: string; status: "ATIVO" | "DESLIGADO" };
export function resolveQuarkDuplicates<T extends Identity>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const key = row.cpf || `${row.external_unit_id}:${row.external_id}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const records: T[] = []; let conflicts = 0;
  for (const group of groups.values()) {
    const active = group.filter(row => row.status === "ATIVO"), candidates = active.length ? active : group;
    const distinct = new Map(candidates.map(row => [JSON.stringify(row), row]));
    if (distinct.size === 1) records.push([...distinct.values()][0]);
    else conflicts++;
  }
  return { records, conflicts, excluded: rows.length - records.length };
}
