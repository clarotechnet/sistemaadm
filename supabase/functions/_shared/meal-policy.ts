export const normalizeMealText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
export const mealPolicyCities = [
  { key: "NATAL", label: "Natal" }, { key: "MOSSORO", label: "Mossoró" }, { key: "PARNAMIRIM", label: "Parnamirim" },
  { key: "FORTALEZA", label: "Fortaleza" }, { key: "RECIFE", label: "Recife" },
  { key: "JOAO PESSOA", label: "João Pessoa" }, { key: "MACEIO", label: "Maceió" },
];
export function canonicalMealCity(value: string) {
  const city = normalizeMealText(value);
  return city === "PANAMIRIM" ? "PARNAMIRIM" : city;
}
export type MealRateVersion = {
  id: string; revision: number; city: string; rate_group: string; effective_month: string;
  daily_value: number; fixed_days: number | null; created_at: string; created_by_name: string; note: string;
};
export type MealRateDefinition = { city: string; group: string; label: string; initialCents: number; fixedDays: number | null };
export const mealRateDefinitions: MealRateDefinition[] = mealPolicyCities.flatMap(({ key: city }) => {
  if (["NATAL", "MOSSORO", "PARNAMIRIM", "FORTALEZA"].includes(city)) return [
    { city, group: "TECNICO", label: "Técnica, técnico, auxiliar de instalação e supervisor técnico", initialCents: 2500, fixedDays: null },
    { city, group: "GERAL", label: "Demais setores e cargos", initialCents: 2000, fixedDays: null },
  ];
  if (city === "RECIFE") return [
    { city, group: "RECIFE_VENDAS", label: "Consultor e supervisor de vendas", initialCents: 2000, fixedDays: null },
    { city, group: "RECIFE_ESTOQUE_RH", label: "Estoque e RH", initialCents: 2300, fixedDays: 22 },
    { city, group: "RECIFE_TECNICO", label: "Técnica, auxiliar de instalação e supervisor técnico", initialCents: 2858, fixedDays: null },
  ];
  return [{ city, group: "VENDAS", label: "Consultor e supervisor de vendas", initialCents: 2000, fixedDays: null }];
});
export function isMealMonth(value: string) { return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && value >= "1900-01" && value <= "9999-12"; }
export function selectMealRateVersions(versions: MealRateVersion[], month: string) {
  if (!isMealMonth(month)) throw new Error("Competência dos valores inválida.");
  const selected = new Map<string, MealRateVersion>();
  for (const version of versions) {
    if (version.effective_month.slice(0, 7) > month) continue;
    const key = canonicalMealCity(version.city) + ":" + version.rate_group, previous = selected.get(key);
    if (!previous || version.effective_month > previous.effective_month || (version.effective_month === previous.effective_month && version.revision > previous.revision)) selected.set(key, version);
  }
  return [...selected.values()];
}
export function resolveMealRateVersion(versions: MealRateVersion[], month: string, city: string, group: string) {
  return selectMealRateVersions(versions, month).find(version => canonicalMealCity(version.city) === canonicalMealCity(city) && version.rate_group === group) ?? null;
}
export function parseMealDailyCents(input: string) {
  const value = input.trim().replace(/^R\$\s*/, "");
  const brazilian = /^\d+(?:,\d{1,2})?$/.test(value) || (value.includes(",") && /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})$/.test(value));
  const normalized = brazilian ? value.replace(/\./g, "").replace(",", ".") : value;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Informe um valor diário válido, com até duas casas decimais.");
  const [whole, fraction = ""] = normalized.split("."), cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 999999999999) throw new Error("Valor diário fora do limite suportado.");
  return cents;
}
