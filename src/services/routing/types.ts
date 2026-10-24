import type { LatLng } from '../../types/package';

/** De onde vieram os tempos de viagem. */
export type MatrixSource = 'ors' | 'osrm' | 'straight-line';

export const SOURCE_LABEL: Record<MatrixSource, string> = {
  ors: 'OpenRouteService (ruas, sem trânsito)',
  osrm: 'OSRM de demonstração (ruas, sem trânsito)',
  'straight-line': 'estimativa em linha reta',
};

/** Tempos (s) e distâncias (m) de cada origem para cada destino; NaN onde não há rota. */
export interface Matrix {
  durations: number[][];
  distances: number[][] | null;
}

/**
 * Tempos de viagem pelas ruas. `sources` e `destinations` são índices de
 * `points`; a resposta tem `sources.length` linhas e `destinations.length` colunas.
 */
export interface MatrixProvider {
  readonly source: MatrixSource;
  table(points: LatLng[], sources: number[], destinations: number[], signal?: AbortSignal): Promise<Matrix>;
}

export class RoutingUnavailableError extends Error {
  constructor(message = 'Serviço de rotas indisponível no momento.') {
    super(message);
    this.name = 'RoutingUnavailableError';
  }
}

export const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
