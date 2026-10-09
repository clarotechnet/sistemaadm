const localDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function validIsoDate(year: string, month: string, day: string): string | null {
  const y = Number(year), m = Number(month), d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Datas da API QuarkRH podem vir como timestamp Unix em milissegundos
 * (13 dígitos), segundos (10 dígitos), ou como datas ISO.
 * Timestamps representam instantes, convertidos para o dia civil de São Paulo.
 * Datas ISO sem horário já representam um dia civil e não sofrem conversão de fuso.
 */
export function parseQuarkEmployeeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]);

  const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilian) return validIsoDate(brazilian[3], brazilian[2], brazilian[1]);

  if (!/^\d{10}(?:\d{3})?$/.test(text)) return null;
  const milliseconds = Number(text) * (text.length === 10 ? 1000 : 1);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return null;

  const instant = new Date(milliseconds);
  if (!Number.isFinite(instant.getTime())) return null;

  const parts = localDateFormatter.formatToParts(instant);
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return validIsoDate(year, month, day);
}
