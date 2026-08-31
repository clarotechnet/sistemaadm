const LEGACY_REPLACEMENTS: Record<string, string> = {
  "þ": "ç", "Þ": "Ç", "Ò": "ã", "ò": "ã", "Æ": "Ã", "æ": "ã",
};

export function fixLegacyEncoding(value: unknown): string {
  return String(value ?? "").replace(/[þÞÒòÆæ]/g, char => LEGACY_REPLACEMENTS[char] ?? char);
}

export function normalizeText(value: unknown): string {
  return fixLegacyEncoding(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[_.\-/\\]+/g, " ")
    .replace(/[^A-Z0-9% ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const normalizeHeader = normalizeText;

export function nameSimilarity(first: string, second: string): number {
  const a = normalizeText(first);
  const b = normalizeText(second);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const matrix = Array.from({ length: b.length + 1 }, (_, index) => [index]);
  for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return Math.max(0, (1 - matrix[b.length][a.length] / Math.max(a.length, b.length)) * 100);
}
