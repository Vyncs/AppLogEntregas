import type { Address, GeocoderId, GeoPrecision, LatLng } from '../../types/package';

export interface GeocodeCandidate {
  location: LatLng;
  precision: GeoPrecision;
  provider: GeocoderId;
  /** O endereço como o provedor o entendeu */
  label: string;
  /** Cidade que o provedor devolveu, para descartar resultado de outra cidade */
  city?: string;
  /** Nome da rua, para juntar os trechos de uma mesma rua */
  street?: string;
  /** Identificador do lugar no Google */
  placeId?: string;
}

/** Sem internet ou serviço fora do ar — diferente de "endereço não encontrado". */
export class GeoUnavailableError extends Error {
  constructor(message = 'Serviço de mapas indisponível no momento.') {
    super(message);
    this.name = 'GeoUnavailableError';
  }
}

/**
 * Endereço → coordenadas. Hoje: OpenStreetMap (Nominatim) sem chave, ou Google
 * quando houver `VITE_GOOGLE_MAPS_API_KEY`.
 */
export interface Geocoder {
  readonly id: GeocoderId;
  /** Candidatos do mais provável para o menos; `[]` quando não acha. */
  geocode(address: Address, signal?: AbortSignal): Promise<GeocodeCandidate[]>;
  /** Busca por texto livre (ponto de partida). */
  search(query: string, signal?: AbortSignal): Promise<GeocodeCandidate[]>;
}
