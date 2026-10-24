import type { Address, GeoPrecision } from '../../types/package';
import { formatCep } from '../label/cep';
import { GeoUnavailableError, type GeocodeCandidate, type Geocoder } from './types';

/**
 * Google Geocoding pela API JavaScript do Maps: é a forma de usar a chave no
 * navegador restrita ao domínio do app (as chamadas REST exigiriam restringir
 * por IP, num servidor). Cobrado como Geocoding; carregar a API sem mostrar
 * mapa não conta como carregamento de mapa.
 */

let loading: Promise<void> | null = null;

export const KEY_REJECTED =
  'A chave do Google foi recusada: confira se o faturamento do projeto está ativo, se a Geocoding API e a Maps JavaScript API estão ativadas e se o endereço do app está nos sites permitidos da chave.';

/** O Google chama isto quando a chave é inválida ou o site não é permitido. */
let authFailed = false;

function loadMapsApi(apiKey: string): Promise<void> {
  if (typeof google !== 'undefined' && typeof google.maps?.importLibrary === 'function') return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const callback = '__rotaFacilMapsReady';
    (window as unknown as Record<string, () => void>)[callback] = () => resolve();
    (window as unknown as Record<string, () => void>).gm_authFailure = () => {
      authFailed = true;
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=${callback}&language=pt-BR&region=BR`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new GeoUnavailableError());
    };
    document.head.appendChild(script);
  });
  return loading;
}

const component = (result: google.maps.GeocoderResult, type: string) =>
  result.address_components.find((c) => c.types.includes(type))?.long_name;

export function fromGoogleResult(result: google.maps.GeocoderResult): GeocodeCandidate {
  const type = result.geometry.location_type;
  let precision: GeoPrecision;
  if (type === 'ROOFTOP' || type === 'RANGE_INTERPOLATED') precision = 'number';
  else if (result.types.includes('route') || result.types.includes('street_address')) precision = 'street';
  else if (result.types.includes('postal_code')) precision = 'cep';
  else precision = 'city';
  return {
    location: { lat: result.geometry.location.lat(), lng: result.geometry.location.lng() },
    precision,
    provider: 'google',
    label: result.formatted_address,
    city: component(result, 'administrative_area_level_2') ?? component(result, 'locality'),
    street: component(result, 'route'),
    placeId: result.place_id,
  };
}

export class GoogleGeocoder implements Geocoder {
  readonly id = 'google' as const;
  private geocoder: google.maps.Geocoder | null = null;

  constructor(private readonly apiKey: string) {}

  private async get(): Promise<google.maps.Geocoder> {
    if (this.geocoder) return this.geocoder;
    await loadMapsApi(this.apiKey);
    const { Geocoder } = (await google.maps.importLibrary('geocoding')) as google.maps.GeocodingLibrary;
    this.geocoder = new Geocoder();
    return this.geocoder;
  }

  private async run(request: google.maps.GeocoderRequest): Promise<GeocodeCandidate[]> {
    const geocoder = await this.get();
    if (authFailed) throw new GeoUnavailableError(KEY_REJECTED);
    try {
      const { results } = await geocoder.geocode({ ...request, region: 'br' });
      return results.map(fromGoogleResult);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'ZERO_RESULTS') return [];
      if (code === 'REQUEST_DENIED' || authFailed) throw new GeoUnavailableError(KEY_REJECTED);
      if (code === 'OVER_QUERY_LIMIT') {
        throw new GeoUnavailableError('Limite de consultas do Google atingido. Tente de novo mais tarde.');
      }
      throw new GeoUnavailableError();
    }
  }

  geocode(address: Address): Promise<GeocodeCandidate[]> {
    const line = [
      [address.street, address.number].filter(Boolean).join(', '),
      address.neighborhood,
      [address.city, address.state].filter(Boolean).join(' - '),
      address.cep ? formatCep(address.cep) : '',
      'Brasil',
    ]
      .filter((part) => part.trim())
      .join(', ');
    return this.run({ address: line, componentRestrictions: { country: 'BR' } });
  }

  search(query: string): Promise<GeocodeCandidate[]> {
    return this.run({ address: query, componentRestrictions: { country: 'BR' } });
  }
}
