import { describe, expect, it, vi } from 'vitest';
import type { DeliveryPackage } from '../../types/package';
import { addressForMaps, googleMapsDirectionsUrl, newPendingSince, routeProgress } from './navigation';
import { planRoute, type CachedMatrix, type NamedPoint, type RoutePoint } from './planner';
import { StraightLineMatrixProvider } from './straightLineProvider';
import { RoutingUnavailableError, type MatrixProvider } from './types';

// Pontos fictícios ao longo de uma avenida (oeste → leste)
const home: NamedPoint = { id: 'start', label: 'Casa', location: { lat: -23.95, lng: -46.4 } };
const stop = (id: string, k: number): RoutePoint => ({ id, location: { lat: -23.95, lng: -46.4 + k * 0.01 } });
const stops = [stop('c', 3), stop('a', 1), stop('d', 4), stop('b', 2)];

/** Provedor de teste: tempo = distância em "quadras" × 60 s, contando as chamadas. */
function fakeProvider(): MatrixProvider & { calls: Array<{ sources: number[]; destinations: number[] }> } {
  const calls: Array<{ sources: number[]; destinations: number[] }> = [];
  return {
    source: 'ors',
    calls,
    async table(points, sources, destinations) {
      calls.push({ sources, destinations });
      const k = (i: number) => Math.round((points[i].lng + 46.4) / 0.01);
      return {
        durations: sources.map((s) => destinations.map((d) => Math.abs(k(s) - k(d)) * 60)),
        distances: sources.map((s) => destinations.map((d) => Math.abs(k(s) - k(d)) * 1000)),
      };
    },
  };
}

describe('planRoute', () => {
  it('ordena da casa até a última entrega, sem voltar, com totais', async () => {
    const provider = fakeProvider();
    const { plan, fetched, cache } = await planRoute({ origin: home, stops, returnTo: null, provider, cache: null });
    expect(plan.stops.map((s) => s.packageId)).toEqual(['a', 'b', 'c', 'd']);
    expect(plan.totalSeconds).toBe(4 * 60);
    expect(plan.totalMeters).toBe(4000);
    expect(plan.backLeg).toBeNull();
    expect(fetched).toBe('full');
    expect(cache?.ids).toEqual(['start', 'c', 'a', 'd', 'b']);
  });

  it('com volta para casa, soma o trecho de volta', async () => {
    const { plan } = await planRoute({ origin: home, stops, returnTo: home, provider: fakeProvider(), cache: null });
    // Ir até a parada mais distante (4 quadras) e voltar: 8 quadras, em qualquer ordem ótima
    expect(plan.totalSeconds).toBe(480);
    const lastAt = { a: 1, b: 2, c: 3, d: 4 }[plan.stops.at(-1)!.packageId as 'a'];
    expect(plan.backLeg).toEqual({ seconds: lastAt * 60, meters: lastAt * 1000 });
  });

  it('recalcular a partir de uma parada já conhecida não consulta o serviço', async () => {
    const provider = fakeProvider();
    const first = await planRoute({ origin: home, stops, returnTo: null, provider, cache: null });
    const fromB: NamedPoint = { ...stop('b', 2), label: 'Última entrega' };
    const again = await planRoute({ origin: fromB, stops: [stop('c', 3), stop('d', 4)], returnTo: null, provider, cache: first.cache });
    expect(again.fetched).toBe('none');
    expect(provider.calls).toHaveLength(1);
    expect(again.plan.stops.map((s) => s.packageId)).toEqual(['c', 'd']);
  });

  it('da localização atual: pede só a linha da nova partida', async () => {
    const provider = fakeProvider();
    const first = await planRoute({ origin: home, stops, returnTo: null, provider, cache: null });
    const gps: NamedPoint = { id: 'gps', label: 'Você', location: { lat: -23.95, lng: -46.4 + 0.025 } };
    const again = await planRoute({ origin: gps, stops: [stop('a', 1), stop('d', 4)], returnTo: null, provider, cache: first.cache });
    expect(again.fetched).toBe('row');
    expect(provider.calls[1]).toEqual({ sources: [0], destinations: [1, 2] });
    expect(again.cache).toBe(first.cache);
  });

  it('serviço fora do ar: cai para linha reta, avisa e não guarda a matriz', async () => {
    const provider: MatrixProvider = {
      source: 'ors',
      table: vi.fn(async () => {
        throw new RoutingUnavailableError('Chave recusada.');
      }),
    };
    const result = await planRoute({ origin: home, stops, returnTo: null, provider, cache: null });
    expect(result.fellBack).toBe(true);
    expect(result.fallbackReason).toBe('Chave recusada.');
    expect(result.plan.source).toBe('straight-line');
    expect(result.cache).toBeNull();
    expect(result.plan.stops.map((s) => s.packageId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('matriz guardada de outro provedor não é reaproveitada', async () => {
    const straight = await planRoute({ origin: home, stops, returnTo: null, provider: new StraightLineMatrixProvider(), cache: null });
    const provider = fakeProvider();
    const real = await planRoute({ origin: home, stops, returnTo: null, provider, cache: straight.cache as CachedMatrix });
    expect(real.fetched).toBe('full');
  });
});

describe('navegação', () => {
  const pkg = (id: string, status: DeliveryPackage['status']) => ({ id, status }) as DeliveryPackage;

  it('próxima parada, progresso, retiradas e encomendas novas', async () => {
    const { plan } = await planRoute({ origin: home, stops, returnTo: null, provider: fakeProvider(), cache: null });
    const byId = new Map([pkg('a', 'delivered'), pkg('b', 'pending'), pkg('c', 'pending'), pkg('d', 'problem')].map((p) => [p.id, p]));
    const progress = routeProgress(plan, byId, new Set());
    expect(progress).toMatchObject({ total: 4, done: 2, nextNumber: 2 });
    expect(progress.next?.packageId).toBe('b');

    expect(routeProgress(plan, byId, new Set(['b'])).total).toBe(3);

    const fresh = [...byId.values(), pkg('e', 'pending')];
    expect(newPendingSince(plan, fresh, new Set()).map((p) => p.id)).toEqual(['e']);
  });

  const endereco = {
    cep: '11400000',
    street: 'Rua Exemplo',
    number: '98',
    complement: 'ponto comercial',
    neighborhood: 'Bairro Teste',
    city: 'Guarujá',
    state: 'SP',
  };

  const ponto = (placeId?: string) => ({
    location: { lat: -23.9876543, lng: -46.2 },
    precision: 'street' as const,
    provider: 'nominatim' as const,
    label: '',
    at: '',
    ...(placeId ? { placeId } : {}),
  });

  it('o Maps recebe rua, número, cidade e CEP — sem complemento e sem bairro', () => {
    // O bairro dos Correios casou com o nome de um estabelecimento em outra rua
    expect(addressForMaps(endereco)).toBe('Rua Exemplo, 98, Guarujá - SP, 11400-000');
    expect(googleMapsDirectionsUrl(endereco, ponto())).toBe(
      `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent('Rua Exemplo, 98, Guarujá - SP, 11400-000')}`,
    );
  });

  it('com a chave do Google, vai também o identificador exato do lugar', () => {
    expect(googleMapsDirectionsUrl(endereco, ponto('ChIJ-exemplo'))).toContain('&destination_place_id=ChIJ-exemplo');
  });

  it('sem rua ou número, usa a coordenada', () => {
    expect(googleMapsDirectionsUrl({ ...endereco, number: '' }, ponto())).toContain('destination=-23.987654,-46.200000');
  });
});

describe('sameAddressKey', () => {
  const address = (street: string, number: string, complement = '') => ({
    cep: '13300-000', street, number, complement, neighborhood: 'Centro', city: 'Itu', state: 'SP',
  });

  it('mesma rua e número, mesmo com "R." e outro complemento, é o mesmo endereço', async () => {
    const { sameAddressKey } = await import('./navigation');
    expect(sameAddressKey(address('R. das Flores', '979', 'casa 1'))).toBe(sameAddressKey(address('Rua das Flores', '979', 'sobrado')));
    expect(sameAddressKey(address('Rua das Flores', '979'))).not.toBe(sameAddressKey(address('Rua das Flores', '980')));
    expect(sameAddressKey(address('Rua das Flores', 'S/N'))).toBeNull();
  });
});
