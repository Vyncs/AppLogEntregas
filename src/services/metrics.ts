import type { OcrProviderId } from '../types/package';

/**
 * Taxa de acerto da leitura, sem dado pessoal: quantas leituras cada provedor
 * fez, em quantas o usuário precisou corrigir algo e quais campos. Nenhum texto
 * lido é guardado. Fica no aparelho.
 */

const KEY = 'rota-facil-metricas-v1';

export interface OcrMetrics {
  readings: Partial<Record<OcrProviderId, number>>;
  withCorrections: Partial<Record<OcrProviderId, number>>;
  /** Campo → quantas vezes foi corrigido */
  fieldCorrections: Record<string, number>;
}

const empty = (): OcrMetrics => ({ readings: {}, withCorrections: {}, fieldCorrections: {} });

export function readMetrics(): OcrMetrics {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...(JSON.parse(raw) as OcrMetrics) } : empty();
  } catch {
    return empty();
  }
}

export function recordReading(provider: OcrProviderId, correctedFields: string[]): void {
  const metrics = readMetrics();
  metrics.readings[provider] = (metrics.readings[provider] ?? 0) + 1;
  if (correctedFields.length > 0) {
    metrics.withCorrections[provider] = (metrics.withCorrections[provider] ?? 0) + 1;
  }
  for (const field of correctedFields) {
    metrics.fieldCorrections[field] = (metrics.fieldCorrections[field] ?? 0) + 1;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(metrics));
  } catch {
    // Sem armazenamento (aba anônima): a métrica desta leitura se perde
  }
}
