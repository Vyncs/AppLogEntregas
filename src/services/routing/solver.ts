/**
 * Ordem das paradas. `cost[i][j]` é o custo (segundos de viagem) de ir de i
 * até j — pode ser diferente na volta (mão única). O ponto 0 é a partida.
 *
 * - Até `EXACT_LIMIT` paradas: programação dinâmica (Held-Karp), resultado ótimo.
 * - Acima: duas construções (vizinho mais próximo e inserção mais barata),
 *   melhoradas por 2-opt e Or-opt (trechos de 1 a 3 paradas, também invertidos)
 *   com custo de cada troca calculado em tempo constante, e depois perturbações
 *   (double-bridge) até o limite de tempo. Com 150 paradas roda em frações de
 *   segundo.
 */

export interface SolveOptions {
  /** Ponto final fixo (voltar para casa), ou `null` para terminar na última entrega */
  end?: number | null;
  /** Tempo máximo das perturbações, em ms */
  timeLimitMs?: number;
  /** Limite de perturbações (para testes determinísticos) */
  maxKicks?: number;
  /** Semente do sorteio das perturbações */
  seed?: number;
  /** Até quantas paradas resolver de forma exata */
  exactLimit?: number;
}

export const EXACT_LIMIT = 12;
const EPS = 1e-9;

/** Custo do caminho t[0] → t[1] → … → t[último]. */
export function pathCost(cost: number[][], path: number[]): number {
  let total = 0;
  for (let k = 0; k + 1 < path.length; k++) total += cost[path[k]][path[k + 1]];
  return total;
}

/** Devolve a ordem de visita das paradas (sem a partida e sem o ponto final fixo). */
export function solveRoute(cost: number[][], options: SolveOptions = {}): number[] {
  const end = options.end ?? null;
  const stops = [...Array(cost.length).keys()].filter((i) => i !== 0 && i !== end);
  if (stops.length <= 1) return stops;
  if (stops.length <= (options.exactLimit ?? EXACT_LIMIT)) return heldKarp(cost, stops, end);

  const fixedEnd = end !== null;
  const wrap = (order: number[]) => (fixedEnd ? [0, ...order, end] : [0, ...order]);
  const deadline = now() + (options.timeLimitMs ?? 400);

  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const order of [nearestNeighbor(cost, stops), cheapestInsertion(cost, stops, end)]) {
    const path = localSearch(cost, wrap(order), fixedEnd, deadline + 1000);
    const c = pathCost(cost, path);
    if (c < bestCost - EPS) {
      best = path;
      bestCost = c;
    }
  }

  // Perturba a melhor solução e melhora de novo: escapa de ótimos locais
  const random = mulberry32(options.seed ?? 1);
  const maxKicks = options.maxKicks ?? Infinity;
  for (let kick = 0; kick < maxKicks && now() < deadline && stops.length >= 8; kick++) {
    const candidate = localSearch(cost, doubleBridge(best!, fixedEnd, random), fixedEnd, deadline);
    const c = pathCost(cost, candidate);
    if (c < bestCost - EPS) {
      best = candidate;
      bestCost = c;
    }
  }

  return best!.slice(1, fixedEnd ? -1 : undefined);
}

// ── Exato ───────────────────────────────────────────────────────────────────

export function heldKarp(cost: number[][], stops: number[], end: number | null): number[] {
  const m = stops.length;
  const full = 1 << m;
  const dp = new Float64Array(full * m).fill(Infinity);
  const parent = new Int32Array(full * m).fill(-1);
  for (let k = 0; k < m; k++) dp[(1 << k) * m + k] = cost[0][stops[k]];

  for (let mask = 1; mask < full; mask++) {
    for (let k = 0; k < m; k++) {
      const value = dp[mask * m + k];
      if (!(mask & (1 << k)) || value === Infinity) continue;
      for (let next = 0; next < m; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const candidate = value + cost[stops[k]][stops[next]];
        if (candidate < dp[nextMask * m + next]) {
          dp[nextMask * m + next] = candidate;
          parent[nextMask * m + next] = k;
        }
      }
    }
  }

  let last = 0;
  let best = Infinity;
  for (let k = 0; k < m; k++) {
    const total = dp[(full - 1) * m + k] + (end !== null ? cost[stops[k]][end] : 0);
    if (total < best) {
      best = total;
      last = k;
    }
  }
  const order: number[] = [];
  let mask = full - 1;
  for (let k = last; k !== -1; ) {
    order.push(stops[k]);
    const previous = parent[mask * m + k];
    mask &= ~(1 << k);
    k = previous;
  }
  return order.reverse();
}

// ── Construções ─────────────────────────────────────────────────────────────

export function nearestNeighbor(cost: number[][], stops: number[]): number[] {
  const left = new Set(stops);
  const order: number[] = [];
  let current = 0;
  while (left.size > 0) {
    let next = -1;
    for (const s of left) if (next === -1 || cost[current][s] < cost[current][next]) next = s;
    order.push(next);
    left.delete(next);
    current = next;
  }
  return order;
}

export function cheapestInsertion(cost: number[][], stops: number[], end: number | null): number[] {
  const path = end !== null ? [0, end] : [0];
  const left = new Set(stops);
  while (left.size > 0) {
    let bestStop = -1;
    let bestAt = -1;
    let bestDelta = Infinity;
    // Com ponto final fixo, nada entra depois dele
    const positions = end !== null ? path.length - 1 : path.length;
    for (const s of left) {
      for (let p = 0; p < positions; p++) {
        const next = path[p + 1];
        const delta =
          next === undefined
            ? cost[path[p]][s]
            : cost[path[p]][s] + cost[s][next] - cost[path[p]][next];
        if (delta < bestDelta) {
          bestDelta = delta;
          bestStop = s;
          bestAt = p + 1;
        }
      }
    }
    path.splice(bestAt, 0, bestStop);
    left.delete(bestStop);
  }
  return path.slice(1, end !== null ? -1 : undefined);
}

// ── Busca local ─────────────────────────────────────────────────────────────

/** 2-opt e Or-opt até não haver melhora (ou acabar o tempo). Altera e devolve `path`. */
export function localSearch(cost: number[][], path: number[], fixedEnd: boolean, deadline = Infinity): number[] {
  for (let guard = 0; guard < 100_000 && now() < deadline; guard++) {
    if (!twoOpt(cost, path, fixedEnd) && !orOpt(cost, path, fixedEnd)) break;
  }
  return path;
}

/** Somas acumuladas do caminho no sentido de ida (F) e de volta (B). */
function prefixSums(cost: number[][], t: number[]) {
  const F = new Float64Array(t.length);
  const B = new Float64Array(t.length);
  for (let k = 0; k + 1 < t.length; k++) {
    F[k + 1] = F[k] + cost[t[k]][t[k + 1]];
    B[k + 1] = B[k] + cost[t[k + 1]][t[k]];
  }
  return { F, B };
}

/** Inverte o trecho t[i..j] se encurtar o caminho. Primeira melhora encontrada. */
function twoOpt(cost: number[][], t: number[], fixedEnd: boolean): boolean {
  const last = t.length - 1;
  const lastMovable = fixedEnd ? last - 1 : last;
  const { F, B } = prefixSums(cost, t);
  for (let i = 1; i < lastMovable; i++) {
    for (let j = i + 1; j <= lastMovable; j++) {
      const tail = j < last;
      const before = cost[t[i - 1]][t[i]] + (F[j] - F[i]) + (tail ? cost[t[j]][t[j + 1]] : 0);
      const after = cost[t[i - 1]][t[j]] + (B[j] - B[i]) + (tail ? cost[t[i]][t[j + 1]] : 0);
      if (after < before - EPS) {
        for (let a = i, b = j; a < b; a++, b--) [t[a], t[b]] = [t[b], t[a]];
        return true;
      }
    }
  }
  return false;
}

/** Leva um trecho de 1 a 3 paradas (na mesma ordem ou invertido) para outro lugar. */
function orOpt(cost: number[][], t: number[], fixedEnd: boolean): boolean {
  const last = t.length - 1;
  const lastMovable = fixedEnd ? last - 1 : last;
  const { F, B } = prefixSums(cost, t);
  for (let len = 1; len <= 3; len++) {
    for (let i = 1; i + len - 1 <= lastMovable; i++) {
      const j = i + len - 1;
      const a = t[i - 1];
      const b = t[i];
      const e = t[j];
      const hasNext = j < last;
      const f = hasNext ? t[j + 1] : -1;
      // Quanto se economiza tirando o trecho e ligando a → f
      const saved = cost[a][b] + (hasNext ? cost[e][f] - cost[a][f] : 0);
      const reversedExtra = B[j] - B[i] - (F[j] - F[i]);

      for (let p = 0; p < last; p++) {
        if (p >= i - 1 && p <= j) continue;
        const x = t[p];
        const y = t[p + 1];
        const base = cost[x][y];
        if (cost[x][b] + cost[e][y] - base - saved < -EPS) {
          relocate(t, i, j, p, false);
          return true;
        }
        if (len > 1 && cost[x][e] + cost[b][y] - base + reversedExtra - saved < -EPS) {
          relocate(t, i, j, p, true);
          return true;
        }
      }
      // Caminho aberto: o trecho pode ir para o fim
      if (!fixedEnd && hasNext) {
        const x = t[last];
        if (cost[x][b] - saved < -EPS) {
          relocate(t, i, j, last, false);
          return true;
        }
        if (len > 1 && cost[x][e] + reversedExtra - saved < -EPS) {
          relocate(t, i, j, last, true);
          return true;
        }
      }
    }
  }
  return false;
}

/** Move t[i..j] para logo depois de t[p] (p fora do trecho). */
function relocate(t: number[], i: number, j: number, p: number, reversed: boolean) {
  const segment = t.slice(i, j + 1);
  if (reversed) segment.reverse();
  const rest = [...t.slice(0, i), ...t.slice(j + 1)];
  const at = p < i ? p + 1 : p - segment.length + 1;
  rest.splice(at, 0, ...segment);
  for (let k = 0; k < t.length; k++) t[k] = rest[k];
}

// ── Perturbação ─────────────────────────────────────────────────────────────

/** Double-bridge: corta o miolo em quatro (A B C D) e religa como A C B D. */
function doubleBridge(path: number[], fixedEnd: boolean, random: () => number): number[] {
  const start = 1;
  const stop = fixedEnd ? path.length - 1 : path.length;
  const n = stop - start;
  const cuts = new Set<number>();
  while (cuts.size < 3) cuts.add(start + 1 + Math.floor(random() * (n - 1)));
  const [p1, p2, p3] = [...cuts].sort((x, y) => x - y);
  return [
    ...path.slice(0, p1),
    ...path.slice(p2, p3),
    ...path.slice(p1, p2),
    ...path.slice(p3),
  ];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
