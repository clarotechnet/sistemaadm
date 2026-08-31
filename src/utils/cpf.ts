export function normalizeCpf(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.slice(-11).padStart(11, "0");
}

export function formatCpf(value: unknown, masked = false): string {
  const cpf = normalizeCpf(value);
  if (!cpf) return "—";
  if (masked) return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}
