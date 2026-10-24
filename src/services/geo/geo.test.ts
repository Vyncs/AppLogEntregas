import { describe, expect, it, vi } from 'vitest';
import type { Address } from '../../types/package';
import { decideCandidates, GEO_VERSION, needsGeocode, sameStreet } from './candidates';
import { haversineMeters } from './distance';
import { fromGoogleResult } from './googleGeocoder';
import { NominatimGeocoder } from './nominatimGeocoder';
import type { GeocodeCandidate } from './types';

// Endereço fictício
const address: Address = {
  cep: '11400-000',
  street: 'Rua Exemplo',
  number: '98',
  complement: '',
  neighborhood: 'Centro',
  city: 'Guarujá',
  state: 'SP',
};

const cand = (lat: number, lng: number, precision: GeocodeCandidate['precision'], city = 'Guarujá'): GeocodeCandidate => ({
  location: { lat, lng },
  precision,
  provider: 'nominatim',
  label: 'x',
  city,
});

describe('haversineMeters', () => {
  it('~111 km por grau de latitude', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('decideCandidates', () => {
  it('prefere o mais preciso e descarta outra cidade', () => {
    const r = decideCandidates(address, [cand(-23.99, -46.25, 'street'), cand(-23.5, -46.6, 'number', 'São Paulo'), cand(-23.991, -46.251, 'number')]);
    expect(r).toMatchObject({ kind: 'found', best: { precision: 'number' }, ambiguous: false });
  });

  it('dois lugares igualmente precisos e distantes: ambíguo', () => {
    const r = decideCandidates(address, [cand(-23.99, -46.25, 'street'), cand(-23.95, -46.3, 'street')]);
    expect(r).toMatchObject({ kind: 'found', ambiguous: true });
  });

  it('trechos da mesma rua (OpenStreetMap sem número) viram um ponto só, no meio', () => {
    // 4 trechos da mesma rua, devolvidos em ordem que muda a cada busca
    const trechos = [
      cand(-23.98124, -46.20347, 'street'),
      cand(-23.97682, -46.20779, 'street'),
      cand(-23.98628, -46.20065, 'street'),
      cand(-23.9778, -46.20738, 'street'),
    ].map((c) => ({ ...c, street: 'Rua Exemplo' }));
    const a = decideCandidates(address, trechos);
    const b = decideCandidates(address, [...trechos].reverse());
    expect(a).toMatchObject({ kind: 'found', ambiguous: false });
    if (a.kind !== 'found' || b.kind !== 'found') throw new Error('esperava encontrar');
    expect(a.best.location.lat).toBeCloseTo(b.best.location.lat, 9);
    expect(a.best.location.lat).toBeCloseTo(-23.980535, 5);
  });

  it('ruas homônimas longe uma da outra continuam ambíguas', () => {
    const r = decideCandidates(address, [
      { ...cand(-23.99, -46.25, 'street'), street: 'Rua Exemplo' },
      { ...cand(-23.9, -46.35, 'street'), street: 'Rua Exemplo' },
    ]);
    expect(r).toMatchObject({ kind: 'found', ambiguous: true });
  });

  it('nada na cidade certa: não encontrado', () => {
    expect(decideCandidates(address, [cand(-23.5, -46.6, 'number', 'São Paulo')])).toEqual({ kind: 'not-found' });
  });

  it('outras ruas que o geocodificador traz junto não passam na frente nem tornam ambíguo', () => {
    // Como o TomTom responde: a rua sem número primeiro e o número certo no meio de outras ruas do bairro
    const r = decideCandidates(address, [
      { ...cand(-23.976, -46.208, 'street'), street: 'Rua Exemplo' },
      { ...cand(-23.978, -46.207, 'street'), street: 'Rua 5' },
      { ...cand(-23.985, -46.201, 'number'), street: 'Rua Exemplo', label: 'Rua Exemplo, 98' },
      { ...cand(-23.977, -46.207, 'number'), street: 'Rua A', label: 'Rua A, 98' },
    ]);
    expect(r).toMatchObject({ kind: 'found', best: { label: 'Rua Exemplo, 98', precision: 'number' }, ambiguous: false });
    if (r.kind !== 'found') throw new Error('esperava encontrar');
    expect(r.alternatives.map((c) => c.street)).toEqual(['Rua Exemplo']);
  });

  it('nenhum resultado na rua pedida: só a região, nunca "no ponto exato"', () => {
    const r = decideCandidates(address, [
      { ...cand(-23.977, -46.207, 'number'), street: 'Rua A' },
      { ...cand(-23.978, -46.207, 'street'), street: 'Rua 5' },
    ]);
    expect(r).toMatchObject({ kind: 'found', best: { precision: 'cep' }, alternatives: [], ambiguous: false });
  });
});

describe('sameStreet', () => {
  it('abreviação, título, acento, caixa e erro de leitura: mesma rua', () => {
    expect(sameStreet('R. Exemplo', 'Rua Exemplo')).toBe(true);
    expect(sameStreet('AV GOV FULANO DE TAL', 'Avenida Governador Fulano de Tal')).toBe(true);
    expect(sameStreet('Rua Conceicao', 'Rua Conceição')).toBe(true);
    expect(sameStreet('Rua Exernplo', 'Rua Exemplo')).toBe(true); // "m" lido como "rn"
  });

  it('outra rua do bairro: não', () => {
    expect(sameStreet('Rua A', 'Rua Exemplo')).toBe(false);
    expect(sameStreet('Rua 5', 'Rua Exemplo')).toBe(false);
    expect(sameStreet('Rua 15', 'Rua 16')).toBe(false);
  });
});

describe('needsGeocode', () => {
  const geo = (precision: 'number' | 'street', provider: 'nominatim' | 'google', version?: number) => ({
    location: { lat: 0, lng: 0 },
    precision,
    provider,
    label: '',
    at: '',
    version,
  });

  it('sem ponto, ou ponto aproximado de regra antiga: localiza de novo', () => {
    expect(needsGeocode(null, 'nominatim')).toBe(true);
    expect(needsGeocode(geo('street', 'nominatim'), 'nominatim')).toBe(true);
    expect(needsGeocode(geo('street', 'nominatim', GEO_VERSION - 1), 'nominatim')).toBe(true);
    expect(needsGeocode(geo('street', 'nominatim', GEO_VERSION), 'nominatim')).toBe(false);
  });

  it('com o Google configurado, refaz o aproximado do OpenStreetMap; o preciso fica', () => {
    expect(needsGeocode(geo('street', 'nominatim', GEO_VERSION), 'google')).toBe(true);
    expect(needsGeocode(geo('number', 'nominatim'), 'google')).toBe(false);
    expect(needsGeocode(geo('street', 'google', GEO_VERSION), 'google')).toBe(false);
  });
});

describe('NominatimGeocoder', () => {
  const result = (extra: object) => ({ lat: '-23.99', lon: '-46.25', display_name: 'Rua Exemplo, Guarujá', ...extra });

  it('busca estruturada com número, nome do estado e país; precisão pelo tipo', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([result({ category: 'highway', addresstype: 'road', address: { city: 'Guarujá' } })])),
    );
    const geocoder = new NominatimGeocoder(fetchImpl as unknown as typeof fetch, 0);
    const found = await geocoder.geocode(address);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('street')).toBe('98 Rua Exemplo');
    expect(url.searchParams.get('state')).toBe('São Paulo');
    expect(url.searchParams.get('countrycodes')).toBe('br');
    expect(found[0]).toMatchObject({ precision: 'street', city: 'Guarujá', location: { lat: -23.99, lng: -46.25 } });
  });

  it('sem resultado com número, tenta só a rua e depois o CEP', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response(JSON.stringify([result({ addresstype: 'postcode' })])));
    const found = await new NominatimGeocoder(fetchImpl as unknown as typeof fetch, 0).geocode(address);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetchImpl.mock.calls[2][0])).searchParams.get('postalcode')).toBe('11400-000');
    expect(found[0].precision).toBe('cep');
  });

  it('respeita 1 consulta por segundo entre chamadas seguidas', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response('[]'));
    const geocoder = new NominatimGeocoder(fetchImpl as unknown as typeof fetch, 1100, sleep);
    await geocoder.search('a');
    await geocoder.search('b');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((sleep.mock.calls[0] as unknown as number[])[0]).toBeGreaterThan(1000);
  });

  it('a mesma busca vem do cache, sem nova consulta', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]'));
    const geocoder = new NominatimGeocoder(fetchImpl as unknown as typeof fetch, 0);
    await geocoder.search('Rua X');
    await geocoder.search('Rua X');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sem internet: indisponível (não "não encontrado")', async () => {
    const geocoder = new NominatimGeocoder(vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch, 0);
    await expect(geocoder.geocode(address)).rejects.toMatchObject({ name: 'GeoUnavailableError' });
  });
});

describe('fromGoogleResult', () => {
  it('ROOFTOP é no número; cidade pelo município', () => {
    const c = fromGoogleResult({
      geometry: { location_type: 'ROOFTOP', location: { lat: () => -23.99, lng: () => -46.25 } },
      types: ['street_address'],
      formatted_address: 'Rua Exemplo, 98 - Centro, Guarujá - SP',
      place_id: 'ChIJ-exemplo',
      address_components: [{ long_name: 'Guarujá', short_name: 'Guarujá', types: ['administrative_area_level_2'] }],
    } as unknown as google.maps.GeocoderResult);
    expect(c).toMatchObject({ precision: 'number', city: 'Guarujá', placeId: 'ChIJ-exemplo', location: { lat: -23.99, lng: -46.25 } });
  });
});
