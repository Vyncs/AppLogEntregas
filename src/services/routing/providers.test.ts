import { describe, expect, it, vi } from 'vitest';
import { OrsMatrixProvider } from './orsProvider';
import { OsrmMatrixProvider } from './osrmProvider';
import { StraightLineMatrixProvider } from './straightLineProvider';

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: -23.9 + i * 0.001, lng: -46.2 - i * 0.001 }));
const all = (n: number) => [...Array(n).keys()];

describe('OsrmMatrixProvider', () => {
  it('pede lng,lat e monta a matriz; trecho sem rota vira NaN', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'Ok', durations: [[0, 60], [null, 0]], distances: [[0, 500], [null, 0]] })),
    );
    const m = await new OsrmMatrixProvider('https://osrm.test', fetchImpl as unknown as typeof fetch).table(pts(2), [0, 1], [0, 1]);
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/table/v1/driving/-46.200000,-23.900000;-46.201000,-23.899000');
    expect(m.durations[0][1]).toBe(60);
    expect(m.durations[1][0]).toBeNaN();
  });

  it('acima de 100 pontos divide em blocos e remonta na posição certa', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const q = new URL(url);
      const coords = q.pathname.split('/').pop()!.split(';');
      const src = q.searchParams.get('sources')!.split(';').map(Number);
      const dst = q.searchParams.get('destinations')!.split(';').map(Number);
      // duração = índice "global" da origem*1000 + do destino, recuperado pelo lat
      const idx = (k: number) => Math.round((Number(coords[k].split(',')[1]) + 23.9) / 0.001);
      return new Response(JSON.stringify({ code: 'Ok', durations: src.map((s) => dst.map((d) => idx(s) * 1000 + idx(d))) }));
    });
    const n = 151;
    const m = await new OsrmMatrixProvider('https://osrm.test', fetchImpl as unknown as typeof fetch).table(pts(n), all(n), all(n));
    expect(fetchImpl.mock.calls.length).toBe(16);
    expect(m.durations[150][3]).toBe(150_003);
    expect(m.durations[7][120]).toBe(7120);
  });

  it('erro de rede vira indisponibilidade', async () => {
    const p = new OsrmMatrixProvider('https://osrm.test', vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch);
    await expect(p.table(pts(2), [0, 1], [0, 1])).rejects.toMatchObject({ name: 'RoutingUnavailableError' });
  });
});

describe('OrsMatrixProvider', () => {
  it('151 pontos: 7 consultas de até 3.500 pares, com a chave no cabeçalho', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { sources: number[]; destinations: number[] };
      expect(body.sources.length * body.destinations.length).toBeLessThanOrEqual(3500);
      return new Response(
        JSON.stringify({
          durations: body.sources.map((s) => body.destinations.map((d) => s * 1000 + d)),
          distances: body.sources.map(() => body.destinations.map(() => 1)),
        }),
      );
    });
    const n = 151;
    const m = await new OrsMatrixProvider('chave-teste', fetchImpl as unknown as typeof fetch).table(pts(n), all(n), all(n));
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'chave-teste' });
    expect(m.durations[150][2]).toBe(150_002);
    expect(m.durations.length).toBe(151);
  });

  it('chave recusada (401/403) explica o que conferir', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    await expect(
      new OrsMatrixProvider('errada', fetchImpl as unknown as typeof fetch).table(pts(2), [0, 1], [0, 1]),
    ).rejects.toThrow(/chave do OpenRouteService foi recusada/);
  });

  it('limite por minuto (429): espera e tenta de novo', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () =>
      ++calls === 1
        ? new Response('', { status: 429 })
        : new Response(JSON.stringify({ durations: [[0, 9], [9, 0]], distances: null })),
    );
    const sleep = vi.fn(async () => undefined);
    const m = await new OrsMatrixProvider('k', fetchImpl as unknown as typeof fetch, 3500, sleep).table(pts(2), [0, 1], [0, 1]);
    expect(sleep).toHaveBeenCalledOnce();
    expect(m.durations[0][1]).toBe(9);
  });
});

describe('StraightLineMatrixProvider', () => {
  it('estima pela linha reta com fator de ruas', async () => {
    const m = await new StraightLineMatrixProvider().table([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }], [0], [1]);
    // ~1.113 m em linha reta × 1,4
    expect(m.distances![0][0]).toBeGreaterThan(1500);
    expect(m.distances![0][0]).toBeLessThan(1600);
  });
});
