import type { LatLng } from '../../types/package';
import { chunk, RoutingUnavailableError, type Matrix, type MatrixProvider } from './types';

/**
 * OSRM (https://project-osrm.org). Sem configuração, usa o servidor de
 * demonstração — sem garantia e sem uso intenso: serve para testar. Com
 * `VITE_OSRM_URL`, usa um OSRM próprio. O servidor aceita até ~100 pontos por
 * consulta; acima disso a matriz é pedida em blocos.
 */
export class OsrmMatrixProvider implements MatrixProvider {
  readonly source = 'osrm' as const;

  constructor(
    private readonly baseUrl = 'https://router.project-osrm.org',
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly maxCoordinates = 100,
  ) {}

  async table(points: LatLng[], sources: number[], destinations: number[], signal?: AbortSignal): Promise<Matrix> {
    const durations = sources.map(() => destinations.map(() => NaN));
    const distances = sources.map(() => destinations.map(() => NaN));
    const together = new Set([...sources, ...destinations]).size <= this.maxCoordinates;
    const blockSize = together ? Math.max(sources.length, destinations.length) : Math.floor(this.maxCoordinates / 2);

    const sourceBlocks = chunk(sources.map((p, row) => ({ p, row })), blockSize);
    const destBlocks = chunk(destinations.map((p, col) => ({ p, col })), blockSize);
    for (const sBlock of sourceBlocks) {
      for (const dBlock of destBlocks) {
        const coords = [...new Set([...sBlock.map((s) => s.p), ...dBlock.map((d) => d.p)])];
        const at = (p: number) => coords.indexOf(p);
        const url =
          `${this.baseUrl}/table/v1/driving/` +
          coords.map((p) => `${points[p].lng.toFixed(6)},${points[p].lat.toFixed(6)}`).join(';') +
          `?annotations=duration,distance` +
          `&sources=${sBlock.map((s) => at(s.p)).join(';')}` +
          `&destinations=${dBlock.map((d) => at(d.p)).join(';')}`;

        let response: Response;
        try {
          response = await this.fetchImpl(url, { signal });
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') throw error;
          throw new RoutingUnavailableError();
        }
        if (!response.ok) throw new RoutingUnavailableError();
        const data = (await response.json()) as {
          code: string;
          durations?: (number | null)[][];
          distances?: (number | null)[][];
        };
        if (data.code !== 'Ok' || !data.durations) throw new RoutingUnavailableError();

        sBlock.forEach((s, r) =>
          dBlock.forEach((d, c) => {
            durations[s.row][d.col] = data.durations?.[r]?.[c] ?? NaN;
            distances[s.row][d.col] = data.distances?.[r]?.[c] ?? NaN;
          }),
        );
      }
    }
    return { durations, distances };
  }
}
