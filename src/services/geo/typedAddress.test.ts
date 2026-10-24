import { describe, expect, it, vi } from 'vitest';
import type { CepService } from '../cep/cepService';
import { locateTypedAddress, numberFromText, simplifyTypedAddress } from './typedAddress';
import type { GeocodeCandidate, Geocoder } from './types';

// Endereços fictícios, no formato copiado do Google Maps
const COLADO = 'R. Fictícia da Silva, 80 - Bairro Teste, Guarujá - SP, 11400-290';

const cepService = (info: Awaited<ReturnType<CepService['lookup']>>): CepService => ({ lookup: vi.fn(async () => info) });
const found: GeocodeCandidate = { location: { lat: -23.98, lng: -46.2 }, precision: 'street', provider: 'nominatim', label: 'Rua Fictícia da Silva, Guarujá', city: 'Guarujá' };

describe('endereço colado do Google Maps', () => {
  it('acha o número ignorando o CEP', () => {
    expect(numberFromText(COLADO)).toBe('80');
    expect(numberFromText('Rua 14, 80, Itu')).toBe('80');
  });

  it('simplifica para a busca livre: abreviação por extenso, sem bairro, UF e CEP', () => {
    expect(simplifyTypedAddress(COLADO)).toBe('Rua Fictícia da Silva, 80, Guarujá');
    expect(simplifyTypedAddress('Av. Brasil 100, Itu - SP')).toBe('Avenida Brasil 100, Itu');
  });

  it('com CEP: rua e cidade do ViaCEP e busca estruturada com o número', async () => {
    const geocoder: Geocoder = { id: 'nominatim', geocode: vi.fn(async () => [found]), search: vi.fn(async () => []) };
    const r = await locateTypedAddress(COLADO, {
      cep: cepService({ cep: '11400290', street: 'Rua Fictícia da Silva', neighborhood: 'Bairro Teste', city: 'Guarujá', state: 'SP', generic: false }),
      geocoder,
    });
    expect(geocoder.geocode).toHaveBeenCalledWith(
      expect.objectContaining({ street: 'Rua Fictícia da Silva', number: '80', city: 'Guarujá', state: 'SP' }),
      undefined,
    );
    expect(r.candidates[0]).toBe(found);
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it('rua que o mapa não tem: tenta o texto simplificado e devolve a cidade para o mapa', async () => {
    const geocoder: Geocoder = { id: 'nominatim', geocode: vi.fn(async () => []), search: vi.fn(async () => []) };
    const r = await locateTypedAddress(COLADO, {
      cep: cepService({ cep: '11400290', street: 'Rua Fictícia da Silva', neighborhood: 'Bairro Teste', city: 'Guarujá', state: 'SP', generic: false }),
      geocoder,
    });
    expect(geocoder.search).toHaveBeenCalledWith('Rua Fictícia da Silva, 80, Guarujá', undefined);
    expect(r).toMatchObject({ candidates: [], address: { city: 'Guarujá', state: 'SP' } });
  });

  it('sem CEP: busca livre simplificada', async () => {
    const geocoder: Geocoder = { id: 'nominatim', geocode: vi.fn(), search: vi.fn(async () => [found]) };
    const r = await locateTypedAddress('R. Fictícia da Silva, 80, Guarujá', { cep: cepService(null), geocoder });
    expect(geocoder.geocode).not.toHaveBeenCalled();
    expect(r.candidates).toEqual([found]);
  });
});
