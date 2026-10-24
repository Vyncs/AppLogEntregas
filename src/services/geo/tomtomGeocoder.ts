import type { Address, GeoPrecision } from '../../types/package';
import { formatCep, normalizeCep } from '../label/cep';
import { GeoUnavailableError, type GeocodeCandidate, type Geocoder } from './types';

/**
 * TomTom Search (https://developer.tomtom.com). Plano grátis: 2.500 consultas
 * por dia, sem cartão de crédito, uso comercial permitido — com 150 entregas
 * por dia sobra folga. Base comercial de endereços, com número de casa onde
 * existe ("Point Address").
 *
 * A chave fica visível no navegador (como a do OpenRouteService); quando o
 * Supabase entrar, a chamada passa para uma Edge Function.
 */

const BASE_URL = 'https://api.tomtom.com/search/2';

interface TomTomResult {
  type: string;
  entityType?: string;
  position: { lat: number; lon: number };
  address: {
    streetNumber?: string;
    streetName?: string;
    municipality?: string;
    freeformAddress?: string;
  };
}

export const TOMTOM_REJECTED =
  'A chave do TomTom foi recusada ou o limite grátis do dia (2.500 consultas) acabou: confira a VITE_TOMTOM_API_KEY no .env.local.';

function precisionOf(result: TomTomResult): GeoPrecision {
  if (result.type === 'Point Address' || result.type === 'Address Range') return 'number';
  if (result.type === 'Street' || result.type === 'Cross Street') return 'street';
  if (result.entityType === 'PostalCodeArea') return 'cep';
  if (result.type === 'Geography') return 'city';
  return 'street';
}

const toCandidate = (result: TomTomResult): GeocodeCandidate => ({
  location: { lat: result.position.lat, lng: result.position.lon },
  precision: precisionOf(result),
  provider: 'tomtom',
  label: result.address.freeformAddress ?? '',
  city: result.address.municipality,
  street: result.address.streetName,
});

export class TomTomGeocoder implements Geocoder {
  readonly id = 'tomtom' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request(url: string, signal?: AbortSignal): Promise<GeocodeCandidate[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      throw new GeoUnavailableError();
    }
    // 403: chave inválida ou limite do dia
    if (response.status === 401 || response.status === 403) throw new GeoUnavailableError(TOMTOM_REJECTED);
    if (!response.ok) throw new GeoUnavailableError();
    const data = (await response.json()) as { results?: TomTomResult[] };
    return (data.results ?? []).map(toCandidate);
  }

  // 10 resultados: o certo pode vir atrás de outras ruas do bairro (a
  // consulta custa o mesmo)
  private params(extra: Record<string, string>): string {
    return new URLSearchParams({ key: this.apiKey, language: 'pt-BR', limit: '10', ...extra }).toString();
  }

  /** Busca estruturada: rua, número, cidade, UF e CEP em campos separados. */
  geocode(address: Address, signal?: AbortSignal): Promise<GeocodeCandidate[]> {
    const cep = normalizeCep(address.cep);
    const fields: Record<string, string> = {
      countryCode: 'BR',
      streetName: address.street.trim(),
      municipality: address.city.trim(),
      countrySubdivision: address.state.trim(),
    };
    if (/\d/.test(address.number)) fields.streetNumber = address.number.trim();
    if (cep) fields.postalCode = formatCep(cep);
    if (address.neighborhood.trim()) fields.municipalitySubdivision = address.neighborhood.trim();
    return this.request(`${BASE_URL}/structuredGeocode.json?${this.params(fields)}`, signal);
  }

  search(query: string, signal?: AbortSignal): Promise<GeocodeCandidate[]> {
    return this.request(
      `${BASE_URL}/geocode/${encodeURIComponent(query)}.json?${this.params({ countrySet: 'BR' })}`,
      signal,
    );
  }
}
