export function parseMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  let text = String(value).trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const negative = text.startsWith("(") || text.startsWith("-");
  text = text.replace(/[()\-]/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  else if ((text.match(/\./g) ?? []).length > 1) text = text.replace(/\./g, "");
  const parsed = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function compareValues(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= Math.abs(tolerance);
}
