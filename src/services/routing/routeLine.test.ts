import { describe, expect, it, vi } from 'vitest';
import type { LatLng } from '../../types/package';
import { fetchRouteLine } from './routeLine';
import { RoutingUnavailableError } from './types';

const point = (k: number): LatLng => ({ lat: -23.95, lng: -46.4 + k * 0.001 });

/** OSRM de teste: devolve os próprios pontos pedidos, com um ponto no meio de cada trecho. */
function fakeOsrm() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const coords = new URL(String(input)).pathname.split('/').pop()!.split(';').map((c) => c.split(',').map(Number));
    const withMiddle = coords.flatMap((c, i) => (i === 0 ? [c] : [[(coords[i - 1][0] + c[0]) / 2, c[1]], c]));
    return new Response(JSON.stringify({ code: 'Ok', routes: [{ geometry: { coordinates: withMiddle } }] }));
  });
}

describe('fetchRouteLine', () => {
  it('segue as ruas (a geometria do serviço) e junta os trechos sem repetir o ponto de emenda', async () => {
    const fetchImpl = fakeOsrm();
    const points = Array.from({ length: 30 }, (_, k) => point(k));
    const line = await fetchRouteLine(points, { fetchImpl });
    // 30 pontos em trechos de 25: duas consultas (0–24 e 24–29)
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Cada um dos 29 intervalos ganhou um ponto no meio: 30 + 29
    expect(line).toHaveLength(59);
    // A URL leva 6 casas decimais
    expect(line[0].lng).toBeCloseTo(points[0].lng, 6);
    expect(line.at(-1)!.lng).toBeCloseTo(points[29].lng, 6);
  });

  it('paradas seguidas no mesmo lugar contam uma vez só', async () => {
    const fetchImpl = fakeOsrm();
    await fetchRouteLine([point(0), point(1), point(1), point(1), point(2)], { fetchImpl });
    expect(new URL(String(fetchImpl.mock.calls[0][0])).pathname.split(';')).toHaveLength(3);
  });

  it('serviço fora do ar vira RoutingUnavailableError (o mapa volta para a linha reta)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchRouteLine([point(0), point(1)], { fetchImpl })).rejects.toBeInstanceOf(RoutingUnavailableError);
  });
});
