import type { Address, GeoPrecision } from '../../types/package';
import { normalizeCep } from '../label/cep';
import { STATE_NAME } from './states';
import { GeoUnavailableError, type GeocodeCandidate, type Geocoder } from './types';

/**
 * OpenStreetMap via Nominatim (https://nominatim.org), sem chave. O servidor
 * público pede no máximo 1 requisição por segundo, identificação (o navegador
 * manda o Referer) e cache — tudo respeitado aqui. Serve para testar; no Brasil
 * a cobertura de número de casa é fraca, então costuma localizar pela rua.
 */

const BASE_URL = 'https://nominatim.openstreetmap.org/search';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  category?: string;
  type?: string;
  addresstype?: string;
  name?: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
}

type Attempt = 'number' | 'street' | 'cep' | 'free';

const CITY_TYPES = new Set(['city', 'town', 'village', 'municipality', 'suburb', 'neighbourhood', 'quarter', 'city_district', 'state', 'county']);

function precisionOf(result: NominatimResult, attempt: Attempt): GeoPrecision {
  if (attempt === 'cep' || result.addresstype === 'postcode') return 'cep';
  if (result.address?.house_number || result.addresstype === 'building' || result.category === 'building') {
    return 'number';
  }
  if (result.category === 'highway' || result.addresstype === 'road') return 'street';
  if (CITY_TYPES.has(result.addresstype ?? '')) return 'city';
  return 'street';
}

const toCandidate = (result: NominatimResult, attempt: Attempt): GeocodeCandidate => ({
  location: { lat: Number(result.lat), lng: Number(result.lon) },
  precision: precisionOf(result, attempt),
  provider: 'nominatim',
  label: result.display_name,
  city: result.address?.city ?? result.address?.town ?? result.address?.village ?? result.address?.municipality,
  street: result.address?.road ?? result.name,
});

export class NominatimGeocoder implements Geocoder {
  readonly id = 'nominatim' as const;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = -Infinity;
  private readonly cache = new Map<string, NominatimResult[]>();

  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly minIntervalMs = 1100,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Uma requisição por vez, respeitando o intervalo mínimo do servidor público. */
  private throttled<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequest + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequest = Date.now();
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request(params: Record<string, string>, signal?: AbortSignal): Promise<NominatimResult[]> {
    const query = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
      countrycodes: 'br',
      'accept-language': 'pt-BR',
      ...params,
    }).toString();
    const cached = this.cache.get(query);
    if (cached) return cached;

    let response: Response;
    try {
      response = await this.throttled(() => this.fetchImpl(`${BASE_URL}?${query}`, { signal }));
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      throw new GeoUnavailableError();
    }
    if (!response.ok) throw new GeoUnavailableError();
    const results = (await response.json()) as NominatimResult[];
    this.cache.set(query, results);
    return results;
  }

  /** Rua com número → só a rua → só o CEP: para na primeira que achar. */
  async geocode(address: Address, signal?: AbortSignal): Promise<GeocodeCandidate[]> {
    const place = {
      city: address.city.trim(),
      state: STATE_NAME[address.state.trim().toUpperCase()] ?? address.state.trim(),
      country: 'Brasil',
    };
    const attempts: Array<[Attempt, Record<string, string>]> = [];
    const street = address.street.trim();
    const number = address.number.trim();
    if (street && /\d/.test(number)) attempts.push(['number', { street: `${number} ${street}`, ...place }]);
    if (street) attempts.push(['street', { street, ...place }]);
    const cep = normalizeCep(address.cep);
    if (cep) attempts.push(['cep', { postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}`, country: 'Brasil' }]);

    for (const [attempt, params] of attempts) {
      const results = await this.request(params, signal);
      if (results.length > 0) return results.map((r) => toCandidate(r, attempt));
    }
    return [];
  }

  async search(query: string, signal?: AbortSignal): Promise<GeocodeCandidate[]> {
    const results = await this.request({ q: query }, signal);
    return results.map((r) => toCandidate(r, 'free'));
  }
}
