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

export function isValidCpf(value: unknown): boolean {
  const cpf = String(value ?? "").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}
