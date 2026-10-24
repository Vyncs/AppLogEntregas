import type { LatLng } from '../../types/package';
import { chunk, RoutingUnavailableError, type Matrix, type MatrixProvider } from './types';

/**
 * OpenRouteService (https://openrouteservice.org), plano gratuito: 500 matrizes
 * por dia, 40 por minuto, até ~3.500 pares origem→destino por consulta. Com 151
 * pontos (casa + 150 entregas) são 7 consultas por cálculo. Não considera
 * trânsito em tempo real.
 *
 * A chave fica visível no navegador; quando o Supabase entrar, a chamada passa
 * para uma Edge Function.
 */
export class OrsMatrixProvider implements MatrixProvider {
  readonly source = 'ors' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly maxPairs = 3500,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async table(points: LatLng[], sources: number[], destinations: number[], signal?: AbortSignal): Promise<Matrix> {
    const durations: number[][] = [];
    const distances: number[][] = [];
    const rowsPerRequest = Math.max(1, Math.floor(this.maxPairs / destinations.length));

    for (const rows of chunk(sources, rowsPerRequest)) {
      const body = JSON.stringify({
        locations: points.map((p) => [p.lng, p.lat]),
        sources: rows,
        destinations,
        metrics: ['duration', 'distance'],
        units: 'm',
      });
      const data = await this.post(body, signal);
      for (let r = 0; r < rows.length; r++) {
        durations.push((data.durations?.[r] ?? []).map((v) => v ?? NaN));
        distances.push((data.distances?.[r] ?? []).map((v) => v ?? NaN));
      }
    }
    return { durations, distances };
  }

  private async post(body: string, signal?: AbortSignal, attempt = 0): Promise<{ durations?: (number | null)[][]; distances?: (number | null)[][] }> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.openrouteservice.org/v2/matrix/driving-car', {
        method: 'POST',
        headers: { Authorization: this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        signal,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      throw new RoutingUnavailableError();
    }
    // Limite por minuto: espera e tenta de novo, algumas vezes
    if (response.status === 429 && attempt < 3) {
      await this.sleep(2000 * (attempt + 1));
      return this.post(body, signal, attempt + 1);
    }
    if (response.status === 401 || response.status === 403) {
      throw new RoutingUnavailableError('A chave do OpenRouteService foi recusada: confira a VITE_ORS_API_KEY no .env.local.');
    }
    if (!response.ok) throw new RoutingUnavailableError();
    return response.json();
  }
}
