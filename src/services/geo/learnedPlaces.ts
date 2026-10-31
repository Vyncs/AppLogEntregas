import type { Address, DeliveryPackage, LatLng, PackageGeo } from '../../types/package';
import { houseNumber, streetKey } from '../routing/streetOrder';
import { GEO_VERSION } from './candidates';
import { haversineMeters } from './distance';
import type { GeocodeCandidate, Geocoder } from './types';

/**
 * Locais aprendidos nas entregas. O mapa gratuito costuma acertar a rua e
 * errar o número; quando o entregador marca "Entregue", ele está na porta: o
 * GPS daquele momento é o lugar certo daquele endereço. Fica guardado e, da
 * próxima vez que o endereço aparecer, vale ele — e não o mapa.
 */

export interface LearnedPlace {
  location: LatLng;
  /** Raio de incerteza do GPS na hora, em metros */
  accuracy: number;
  /** ISO 8601 */
  at: string;
}

export interface LearnedStore {
  get(key: string): Promise<LearnedPlace | undefined>;
  set(key: string, place: LearnedPlace): Promise<void>;
}

/** Mesmo endereço: rua (sem tipo de via e acento), número e cidade; o complemento não muda o lugar. */
export function learnedKey(a: Address): string | null {
  const street = streetKey(a.street, a.city);
  const number = houseNumber(a.number);
  return street && number !== null ? `${street}|${number}` : null;
}

export const LEARNED_LABEL = 'Local confirmado numa entrega';

export const learnedGeo = (place: LearnedPlace, now = new Date()): PackageGeo => ({
  location: place.location,
  precision: 'number',
  provider: 'learned',
  label: LEARNED_LABEL,
  at: now.toISOString(),
  version: GEO_VERSION,
});

/** O local aprendido para o endereço, se houver. */
export async function findLearned(store: LearnedStore, address: Address): Promise<LearnedPlace | undefined> {
  const key = learnedKey(address);
  return key ? store.get(key) : undefined;
}

/** Antes de perguntar ao mapa, vê se o endereço já foi confirmado numa entrega. */
export class LearningGeocoder implements Geocoder {
  constructor(
    private readonly inner: Geocoder,
    private readonly store: LearnedStore,
  ) {}

  get id() {
    return this.inner.id;
  }

  async geocode(address: Address, signal?: AbortSignal): Promise<GeocodeCandidate[]> {
    const place = await findLearned(this.store, address).catch(() => undefined);
    if (place) return [{ location: place.location, precision: 'number', provider: 'learned', label: LEARNED_LABEL }];
    return this.inner.geocode(address, signal);
  }

  search(query: string, signal?: AbortSignal): Promise<GeocodeCandidate[]> {
    return this.inner.search(query, signal);
  }
}

/** GPS ruim demais para dizer qual casa (mais que uns três lotes) */
export const MAX_ACCURACY_M = 50;
/**
 * Longe demais de onde o mapa pôs o endereço: provavelmente marcou "Entregue"
 * depois, de outro lugar (em casa, no fim do dia). O mapa erra o número, não o
 * bairro.
 */
export const MAX_SHIFT_M = 1500;

export type LearnOutcome =
  | { kind: 'learned'; place: LearnedPlace }
  | { kind: 'skipped'; reason: 'no-address' | 'inaccurate' | 'too-far' };

/**
 * Decide se a posição na hora da entrega vira o local do endereço. Não
 * aprende sem rua e número, com GPS impreciso ou longe demais do endereço.
 */
export function decideLearning(
  pkg: DeliveryPackage,
  fix: { location: LatLng; accuracy: number },
  now = new Date(),
): LearnOutcome {
  if (!learnedKey(pkg.address)) return { kind: 'skipped', reason: 'no-address' };
  if (fix.accuracy > MAX_ACCURACY_M) return { kind: 'skipped', reason: 'inaccurate' };
  if (pkg.geo && haversineMeters(pkg.geo.location, fix.location) > MAX_SHIFT_M) return { kind: 'skipped', reason: 'too-far' };
  return { kind: 'learned', place: { location: fix.location, accuracy: fix.accuracy, at: now.toISOString() } };
}
