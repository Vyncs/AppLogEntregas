import type { LatLng } from '../../types/package';
import { RoutingUnavailableError } from './types';

/**
 * O desenho da rota pelas ruas, para o mapa: a linha que o carro faz, e não a
 * reta entre as paradas. Vem do mesmo serviço dos tempos — OpenRouteService
 * com chave, senão OSRM — em trechos de até `MAX_WAYPOINTS` pontos (o último
 * de um trecho é o primeiro do seguinte). Só desenho: a ordem não muda.
 */

const MAX_WAYPOINTS = 25;

export interface RouteLineOptions {
  orsKey?: string;
  osrmUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Pontos seguidos no mesmo lugar (mesmo prédio) não mudam a linha e gastam consulta. */
function dedupe(points: LatLng[]): LatLng[] {
  return points.filter((p, i) => i === 0 || p.lat !== points[i - 1].lat || p.lng !== points[i - 1].lng);
}

export async function fetchRouteLine(points: LatLng[], options: RouteLineOptions = {}): Promise<LatLng[]> {
  const unique = dedupe(points);
  if (unique.length < 2) return unique;
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const line: LatLng[] = [];
  for (let start = 0; start < unique.length - 1; start += MAX_WAYPOINTS - 1) {
    const part = unique.slice(start, start + MAX_WAYPOINTS);
    const coords = options.orsKey
      ? await orsLine(part, options.orsKey, fetchImpl, options.signal)
      : await osrmLine(part, options.osrmUrl || 'https://router.project-osrm.org', fetchImpl, options.signal);
    // O primeiro ponto de cada trecho repete o último do anterior
    line.push(...(line.length ? coords.slice(1) : coords));
  }
  return line;
}

const toLatLng = ([lng, lat]: number[]): LatLng => ({ lat, lng });

async function request(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new RoutingUnavailableError();
  }
  if (!response.ok) throw new RoutingUnavailableError();
  return response.json();
}

async function osrmLine(points: LatLng[], baseUrl: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<LatLng[]> {
  const url =
    `${baseUrl}/route/v1/driving/` +
    points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';') +
    '?overview=full&geometries=geojson';
  const data = (await request(fetchImpl, url, { signal })) as {
    code: string;
    routes?: Array<{ geometry: { coordinates: number[][] } }>;
  };
  const coords = data.code === 'Ok' ? data.routes?.[0]?.geometry.coordinates : undefined;
  if (!coords?.length) throw new RoutingUnavailableError();
  return coords.map(toLatLng);
}

async function orsLine(points: LatLng[], apiKey: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<LatLng[]> {
  const data = (await request(fetchImpl, 'https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
    body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]) }),
    signal,
  })) as { features?: Array<{ geometry: { coordinates: number[][] } }> };
  const coords = data.features?.[0]?.geometry.coordinates;
  if (!coords?.length) throw new RoutingUnavailableError();
  return coords.map(toLatLng);
}
