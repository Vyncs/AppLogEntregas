import type { LatLng } from '../../types/package';
import { haversineMeters } from '../geo/distance';
import type { Matrix, MatrixProvider } from './types';

/** As ruas não são retas: o caminho real costuma ser ~40% maior que a linha reta. */
export const ROAD_FACTOR = 1.4;
/** Velocidade média urbana com paradas (km/h), só para estimar. */
export const URBAN_SPEED_KMH = 25;

export const straightLineMeters = (a: LatLng, b: LatLng) => haversineMeters(a, b) * ROAD_FACTOR;
export const straightLineSeconds = (a: LatLng, b: LatLng) => straightLineMeters(a, b) / ((URBAN_SPEED_KMH * 1000) / 3600);

/**
 * Último recurso, sem serviço de rotas: linha reta × fator de ruas. A tela
 * avisa que a ordem é menos precisa.
 */
export class StraightLineMatrixProvider implements MatrixProvider {
  readonly source = 'straight-line' as const;

  async table(points: LatLng[], sources: number[], destinations: number[]): Promise<Matrix> {
    return {
      durations: sources.map((s) => destinations.map((d) => straightLineSeconds(points[s], points[d]))),
      distances: sources.map((s) => destinations.map((d) => straightLineMeters(points[s], points[d]))),
    };
  }
}
