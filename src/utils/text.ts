const LEGACY_REPLACEMENTS: Record<string, string> = {
  "þ": "ç", "Þ": "Ç", "Ò": "ã", "ò": "ã", "Æ": "Ã", "æ": "ã",
};

const UTF8_MOJIBAKE_REPLACEMENTS: Record<string,string> = {
  "Ã¡":"á","Ã¢":"â","Ã£":"ã","Ã¤":"ä","Ã ":"à",
  "Ã©":"é","Ãª":"ê","Ã«":"ë","Ã¨":"è",
  "Ã­":"í","Ã®":"î","Ã¯":"ï","Ã¬":"ì",
  "Ã³":"ó","Ã´":"ô","Ãµ":"õ","Ã¶":"ö","Ã²":"ò",
  "Ãº":"ú","Ã»":"û","Ã¼":"ü","Ã¹":"ù","Ã§":"ç",
  "Ã":"Á","Ã‚":"Â","Ãƒ":"Ã","Ã„":"Ä","Ã€":"À",
  "Ã‰":"É","ÃŠ":"Ê","Ã‹":"Ë","Ãˆ":"È",
  "Ã":"Í","ÃŽ":"Î","Ã":"Ï","ÃŒ":"Ì",
  "Ã“":"Ó","Ã”":"Ô","Ã•":"Õ","Ã–":"Ö","Ã’":"Ò",
  "Ãš":"Ú","Ã›":"Û","Ãœ":"Ü","Ã™":"Ù","Ã‡":"Ç",
  "Â·":"·","Âº":"º","Âª":"ª","Â ":" ","Â":""
};

export function fixLegacyEncoding(value: unknown): string {
  let text=String(value ?? "").replace(/[þÞÒòÆæ]/g, char => LEGACY_REPLACEMENTS[char] ?? char);
  for(const [broken,fixed] of Object.entries(UTF8_MOJIBAKE_REPLACEMENTS))text=text.split(broken).join(fixed);
  return text;
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
