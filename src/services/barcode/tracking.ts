import type { DetectedCode } from './barcodeReader';

export interface TrackingPick {
  code: string;
  /** De onde veio: o código de barras, ou só o texto impresso abaixo dele */
  source: 'barcode' | 'printed';
  /** O código de barras bate com o texto impresso da etiqueta */
  confirmed: boolean;
}

const clean = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** Rastreio plausível: 8+ caracteres, letras e números, e não é URL. */
const plausible = (value: string) => /^[A-Z0-9-]{8,40}$/.test(value);

/**
 * Escolhe o código de rastreio entre o que foi lido. O QR e o código de barras
 * da etiqueta trazem o mesmo número; preferimos o que também aparece impresso
 * (conferência) e, entre os demais, o que aparece mais vezes.
 */
export function pickTrackingCode(
  codes: DetectedCode[],
  printedCandidates: string[] = [],
): TrackingPick | null {
  const printed = new Set(printedCandidates.map(clean));
  const counts = new Map<string, number>();
  for (const code of codes) {
    const value = clean(code.value);
    if (plausible(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort(
    ([a, na], [b, nb]) =>
      Number(printed.has(b)) - Number(printed.has(a)) || nb - na || b.length - a.length,
  );
  if (ranked.length > 0) {
    const [code] = ranked[0];
    return { code, source: 'barcode', confirmed: printed.has(code) };
  }

  // Sem código de barras: o texto impresso vira sugestão, para conferir
  const fromText = [...printed].find(plausible);
  return fromText ? { code: fromText, source: 'printed', confirmed: false } : null;
}
