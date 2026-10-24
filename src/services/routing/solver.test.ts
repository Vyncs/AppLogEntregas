import { describe, expect, it } from 'vitest';
import { heldKarp, pathCost, solveRoute } from './solver';

/** Gerador determinístico para os testes. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pontos aleatórios num quadrado; custo = distância × fator de mão única aleatório. */
function instance(n: number, seed: number, asymmetric = true) {
  const random = rng(seed);
  const pts = Array.from({ length: n }, () => [random() * 10_000, random() * 10_000]);
  const skew = Array.from({ length: n }, () => Array.from({ length: n }, () => (asymmetric ? 1 + random() * 0.4 : 1)));
  return pts.map(([x1, y1], i) => pts.map(([x2, y2], j) => (i === j ? 0 : Math.hypot(x1 - x2, y1 - y2) * skew[i][j])));
}

function bruteForce(cost: number[][], end: number | null): number {
  const stops = [...Array(cost.length).keys()].filter((i) => i !== 0 && i !== end);
  let best = Infinity;
  const permute = (rest: number[], path: number[]) => {
    if (!rest.length) {
      best = Math.min(best, pathCost(cost, [0, ...path, ...(end !== null ? [end] : [])]));
      return;
    }
    rest.forEach((s, k) => permute([...rest.slice(0, k), ...rest.slice(k + 1)], [...path, s]));
  };
  permute(stops, []);
  return best;
}

const costOf = (cost: number[][], order: number[], end: number | null) =>
  pathCost(cost, [0, ...order, ...(end !== null ? [end] : [])]);

const isPermutation = (order: number[], n: number, end: number | null) =>
  [...order].sort((a, b) => a - b).join() ===
  [...Array(n).keys()].filter((i) => i !== 0 && i !== end).join();

describe('solveRoute — exato (Held-Karp)', () => {
  it('acha o ótimo, termine na última entrega ou volte para casa', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const cost = instance(8, seed);
      for (const end of [null, 0]) {
        const order = solveRoute(cost, { end });
        expect(isPermutation(order, 8, end)).toBe(true);
        expect(costOf(cost, order, end)).toBeCloseTo(bruteForce(cost, end), 6);
      }
    }
  });

  it('pontos em linha: vai em ordem, sem voltar (rota aberta)', () => {
    const xs = [0, 5, 1, 4, 2, 3];
    const cost = xs.map((a) => xs.map((b) => Math.abs(a - b)));
    expect(solveRoute(cost).map((i) => xs[i])).toEqual([1, 2, 3, 4, 5]);
  });

  it('respeita mão única: ida e volta com custos diferentes', () => {
    // De 1 para 2 é caro (contramão); de 2 para 1 é barato
    const cost = [
      [0, 1, 1],
      [9, 0, 50],
      [9, 1, 0],
    ];
    expect(solveRoute(cost)).toEqual([2, 1]);
  });
});

describe('solveRoute — heurística (acima de 12 paradas)', () => {
  it('fica a até 3% do ótimo em instâncias que dá para conferir', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const cost = instance(13, seed);
      const stops = [...Array(13).keys()].slice(1);
      const optimal = costOf(cost, heldKarp(cost, stops, null), null);
      const order = solveRoute(cost, { exactLimit: 0, maxKicks: 200, timeLimitMs: 2000, seed });
      expect(isPermutation(order, 13, null)).toBe(true);
      expect(costOf(cost, order, null)).toBeLessThanOrEqual(optimal * 1.03);
    }
  });

  it('150 paradas: ordem válida, melhor que o vizinho mais próximo, em menos de 1,5 s', () => {
    const cost = instance(151, 42);
    const started = performance.now();
    const order = solveRoute(cost, { timeLimitMs: 400 });
    const elapsed = performance.now() - started;
    expect(isPermutation(order, 151, null)).toBe(true);
    expect(elapsed).toBeLessThan(1500);

    // Vizinho mais próximo puro, para comparar
    const left = new Set([...Array(151).keys()].slice(1));
    const greedy: number[] = [];
    let at = 0;
    while (left.size) {
      const next = [...left].reduce((a, b) => (cost[at][b] < cost[at][a] ? b : a));
      greedy.push(next);
      left.delete(next);
      at = next;
    }
    expect(costOf(cost, order, null)).toBeLessThan(costOf(cost, greedy, null));
  });

  it('com volta para casa, termina no ponto fixo', () => {
    const cost = instance(30, 7);
    const order = solveRoute(cost, { end: 0, maxKicks: 50 });
    expect(isPermutation(order, 30, 0)).toBe(true);
  });
});
