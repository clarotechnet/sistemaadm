/** Matrícula eSocial exibida no cadastro QuarkRH.
 * A API Extrator serializa esse campo dentro de pessoa.eletronicoSocial.
 * Não confundir com o id interno do colaborador, PIS ou CPF.
 */
const textValue = (value: unknown): string => {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  // O Extrator QuarkRH devolve muitas matrículas numéricas como "123.0".
  // Não confundir esse sufixo de formatação com parte da matrícula.
  return /^\d+\.0+$/.test(text) ? text.replace(/\.0+$/, "") : text;
};

export function quarkEmployeeRegistration(record: Record<string, unknown>): string {
  const pessoa = record.pessoa && typeof record.pessoa === "object" && !Array.isArray(record.pessoa)
    ? record.pessoa as Record<string, unknown>
    : {};

  return [
    pessoa.eletronicoSocial,
    record.matricula,
    record.numeroMatricula,
    record.numero_matricula,
  ].map(textValue).find(Boolean) ?? "";
}
