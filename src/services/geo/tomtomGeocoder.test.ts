import { describe, expect, it, vi } from 'vitest';
import type { Address } from '../../types/package';
import { needsGeocode } from './candidates';
import { TOMTOM_REJECTED, TomTomGeocoder } from './tomtomGeocoder';

// Endereço fictício
const address: Address = {
  cep: '11400-000',
  street: 'Rua Exemplo',
  number: '98',
  complement: 'casa 2',
  neighborhood: 'Bairro Teste',
  city: 'Guarujá',
  state: 'SP',
};

const result = (type: string, extra: object = {}) => ({
  type,
  position: { lat: -23.98, lon: -46.2 },
  address: { streetNumber: '98', streetName: 'Rua Exemplo', municipality: 'Guarujá', freeformAddress: 'Rua Exemplo, 98, Guarujá' },
  ...extra,
});

describe('TomTomGeocoder', () => {
  it('busca estruturada: rua, número, cidade, UF, CEP e bairro em campos separados; sem complemento', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [result('Point Address')] })));
    const found = await new TomTomGeocoder('chave', fetchImpl as unknown as typeof fetch).geocode(address);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe('/search/2/structuredGeocode.json');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      key: 'chave',
      countryCode: 'BR',
      streetName: 'Rua Exemplo',
      streetNumber: '98',
      municipality: 'Guarujá',
      countrySubdivision: 'SP',
      postalCode: '11400-000',
      municipalitySubdivision: 'Bairro Teste',
    });
    expect(url.searchParams.get('complement')).toBeNull();
    expect(found[0]).toMatchObject({ precision: 'number', provider: 'tomtom', city: 'Guarujá', location: { lat: -23.98, lng: -46.2 } });
  });

  it('precisão pelo tipo do resultado', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [result('Address Range'), result('Street'), result('Geography', { entityType: 'PostalCodeArea' }), result('Geography', { entityType: 'Municipality' })],
        }),
      ),
    );
    const found = await new TomTomGeocoder('k', fetchImpl as unknown as typeof fetch).geocode(address);
    expect(found.map((c) => c.precision)).toEqual(['number', 'street', 'cep', 'city']);
  });

  it('busca livre (ponto de partida) restrita ao Brasil', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    await new TomTomGeocoder('k', fetchImpl as unknown as typeof fetch).search('Rua Exemplo, 98, Guarujá');
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(decodeURIComponent(url.pathname)).toBe('/search/2/geocode/Rua Exemplo, 98, Guarujá.json');
    expect(url.searchParams.get('countrySet')).toBe('BR');
  });

  it('chave recusada ou limite do dia: explica o que conferir', async () => {
    const geocoder = new TomTomGeocoder('k', vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch);
    await expect(geocoder.geocode(address)).rejects.toThrow(TOMTOM_REJECTED);
  });

  it('com o TomTom configurado, o ponto aproximado do OpenStreetMap é refeito; o marcado no mapa fica', () => {
    const geo = (provider: 'nominatim' | 'map', precision: 'street' | 'number') => ({
      location: { lat: 0, lng: 0 },
      precision,
      provider,
      label: '',
      at: '',
      version: 2,
    });
    expect(needsGeocode(geo('nominatim', 'street'), 'tomtom')).toBe(true);
    expect(needsGeocode(geo('map', 'number'), 'tomtom')).toBe(false);
  });
});
