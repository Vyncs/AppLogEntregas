/**
 * CEP com tolerância ao que o OCR costuma fazer: "06454-000", "06454000",
 * "06454 000" ou "06454.000". Os limites (\b) impedem casar dentro de um
 * número maior, como o código de rastreio.
 */
export const CEP_PATTERN = /\b(\d{5})\s?[-.]?\s?(\d{3})\b/g;

/** Só os 8 dígitos, ou null quando não há um CEP bem formado. */
export function normalizeCep(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

/** "06454000" → "06454-000" (aceita também já formatado). */
export function formatCep(value: string): string {
  const digits = normalizeCep(value);
  return digits ? `${digits.slice(0, 5)}-${digits.slice(5)}` : value;
}

/**
 * Formato válido para consultar: 8 dígitos e não todos iguais (00000000 e
 * afins aparecem quando o OCR lê borrão como zero).
 */
export function isValidCepFormat(value: string): boolean {
  const digits = normalizeCep(value);
  return digits !== null && !/^(\d)\1{7}$/.test(digits);
}

export interface CepMatch {
  cep: string;
  index: number;
  length: number;
}

/** Todos os CEPs do texto, na ordem, normalizados para 8 dígitos. */
export function findCeps(text: string): CepMatch[] {
  return [...text.matchAll(CEP_PATTERN)].map((m) => ({
    cep: `${m[1]}${m[2]}`,
    index: m.index ?? 0,
    length: m[0].length,
  }));
}
