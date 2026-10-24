import type { LatLng } from '../../types/package';
import { solveRoute } from './solver';
import { StraightLineMatrixProvider, straightLineSeconds } from './straightLineProvider';
import { RoutingUnavailableError, type MatrixProvider, type MatrixSource } from './types';

export interface RoutePoint {
  id: string;
  location: LatLng;
}

export interface NamedPoint extends RoutePoint {
  label: string;
}

/** Matriz guardada para recalcular sem consultar o serviço de novo. */
export interface CachedMatrix {
  source: MatrixSource;
  ids: string[];
  durations: number[][];
  distances: number[][] | null;
}

export interface PlannedStop {
  packageId: string;
  /** Tempo e distância desde a parada anterior (ou da partida) */
  legSeconds: number;
  legMeters: number | null;
}

export interface RoutePlan {
  /** ISO 8601 */
  createdAt: string;
  origin: NamedPoint;
  /** Ponto final fixo (volta para casa), ou null para terminar na última entrega */
  returnTo: NamedPoint | null;
  stops: PlannedStop[];
  backLeg: { seconds: number; meters: number | null } | null;
  totalSeconds: number;
  totalMeters: number | null;
  source: MatrixSource;
}

export interface PlanInput {
  origin: NamedPoint;
  stops: RoutePoint[];
  returnTo: NamedPoint | null;
  provider: MatrixProvider;
  cache: CachedMatrix | null;
  signal?: AbortSignal;
  now?: Date;
  timeLimitMs?: number;
}

export interface PlanResult {
  plan: RoutePlan;
  /** O que guardar para o próximo recálculo */
  cache: CachedMatrix | null;
  /** O serviço de rotas falhou e a ordem saiu da linha reta */
  fellBack: boolean;
  /** Por que falhou (ex.: chave recusada) */
  fallbackReason?: string;
  /** Consultas feitas ao serviço (0 = tudo veio da matriz guardada) */
  fetched: 'none' | 'row' | 'full';
}

function submatrix(cache: CachedMatrix, ids: string[]): CachedMatrix {
  const at = ids.map((id) => cache.ids.indexOf(id));
  return {
    source: cache.source,
    ids,
    durations: at.map((i) => at.map((j) => cache.durations[i][j])),
    distances: cache.distances ? at.map((i) => at.map((j) => cache.distances![i][j])) : null,
  };
}

async function acquire(
  points: RoutePoint[],
  provider: MatrixProvider,
  cache: CachedMatrix | null,
  signal?: AbortSignal,
): Promise<{
  matrix: CachedMatrix;
  cache: CachedMatrix | null;
  fellBack: boolean;
  fallbackReason?: string;
  fetched: PlanResult['fetched'];
}> {
  const ids = points.map((p) => p.id);
  const locations = points.map((p) => p.location);
  const all = points.map((_, i) => i);
  const usable = cache !== null && cache.source === provider.source;

  // 1. Tudo já está na matriz guardada (ex.: recalcular a partir de uma parada)
  if (usable && ids.every((id) => cache.ids.includes(id))) {
    return { matrix: submatrix(cache, ids), cache, fellBack: false, fetched: 'none' };
  }

  try {
    // 2. Só a partida é nova (ex.: recalcular da localização atual): só a linha dela
    const [origin, ...rest] = ids;
    if (usable && !cache.ids.includes(origin) && rest.every((id) => cache.ids.includes(id))) {
      const row = await provider.table(locations, [0], all.slice(1), signal);
      const known = submatrix(cache, rest);
      const durations = all.map((i) =>
        all.map((j) => (i === j ? 0 : i === 0 ? row.durations[0][j - 1] : j === 0 ? NaN : known.durations[i - 1][j - 1])),
      );
      const distances =
        row.distances && known.distances
          ? all.map((i) =>
              all.map((j) => (i === j ? 0 : i === 0 ? row.distances![0][j - 1] : j === 0 ? NaN : known.distances![i - 1][j - 1])),
            )
          : null;
      return { matrix: { source: provider.source, ids, durations, distances }, cache, fellBack: false, fetched: 'row' };
    }

    // 3. Matriz completa
    const full = await provider.table(locations, all, all, signal);
    const matrix: CachedMatrix = { source: provider.source, ids, ...full };
    return { matrix, cache: matrix, fellBack: false, fetched: 'full' };
  } catch (error) {
    if (!(error instanceof RoutingUnavailableError)) throw error;
    // Sem serviço de rotas: linha reta, avisando — e não guarda, para tentar de novo depois
    const straight = await new StraightLineMatrixProvider().table(locations, all, all);
    return {
      matrix: { source: 'straight-line', ids, ...straight },
      cache,
      fellBack: true,
      fallbackReason: error.message,
      fetched: 'none',
    };
  }
}

/** Custo para o otimizador: trecho sem rota (NaN) vira linha reta com penalidade. */
function costMatrix(matrix: CachedMatrix, points: RoutePoint[]): number[][] {
  return matrix.durations.map((row, i) =>
    row.map((v, j) =>
      i === j ? 0 : Number.isFinite(v) ? v : straightLineSeconds(points[i].location, points[j].location) * 3,
    ),
  );
}

/**
 * Calcula a rota: partida → paradas na melhor ordem → (opcional) volta.
 * Por padrão termina na última entrega, sem voltar para casa.
 */
export async function planRoute(input: PlanInput): Promise<PlanResult> {
  const { origin, stops, returnTo } = input;
  const backHome = returnTo !== null && returnTo.id !== origin.id;
  const points: RoutePoint[] = [origin, ...stops, ...(backHome ? [returnTo] : [])];

  const { matrix, cache, fellBack, fallbackReason, fetched } = await acquire(points, input.provider, input.cache, input.signal);
  const cost = costMatrix(matrix, points);
  const end = returnTo === null ? null : backHome ? points.length - 1 : 0;
  const order = solveRoute(cost, { end, timeLimitMs: input.timeLimitMs ?? 400 });

  const leg = (from: number, to: number) => ({
    seconds: cost[from][to],
    meters: matrix.distances && Number.isFinite(matrix.distances[from][to]) ? matrix.distances[from][to] : null,
  });

  let previous = 0;
  const planned: PlannedStop[] = order.map((index) => {
    const l = leg(previous, index);
    previous = index;
    return { packageId: points[index].id, legSeconds: l.seconds, legMeters: l.meters };
  });
  const back = end === null ? null : leg(previous, end);
  const legs = [...planned.map((s) => ({ seconds: s.legSeconds, meters: s.legMeters })), ...(back ? [back] : [])];

  return {
    plan: {
      createdAt: (input.now ?? new Date()).toISOString(),
      origin,
      returnTo,
      stops: planned,
      backLeg: back,
      totalSeconds: legs.reduce((sum, l) => sum + l.seconds, 0),
      totalMeters: legs.every((l) => l.meters !== null) ? legs.reduce((sum, l) => sum + (l.meters ?? 0), 0) : null,
      source: matrix.source,
    },
    cache,
    fellBack,
    fallbackReason,
    fetched,
  };
}
