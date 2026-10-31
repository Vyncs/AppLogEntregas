import { decideLearning, learnedGeo, learnedKey, type LearnedStore, type LearnOutcome } from '../services/geo/learnedPlaces';
import type { DeliveryPackage, GeoProblem, PackageGeo } from '../types/package';
import type { LivePosition } from './geolocation';

interface LearnDeps {
  store: LearnedStore;
  /** Posição atual do celular */
  fix: () => Promise<LivePosition>;
  setGeo: (id: string, geo: PackageGeo | null, problem: GeoProblem | null) => Promise<void>;
}

/**
 * Depois de "Entregue": guarda onde o celular está como o local do endereço e
 * já corrige as outras encomendas do mesmo endereço. Sem GPS, nada muda — a
 * entrega já foi salva antes, isto é só um extra.
 */
export async function learnFromDelivery(
  pkg: DeliveryPackage,
  packages: DeliveryPackage[],
  deps: LearnDeps,
): Promise<LearnOutcome | null> {
  const key = learnedKey(pkg.address);
  if (!key) return null;
  let fix: LivePosition;
  try {
    fix = await deps.fix();
  } catch {
    return null;
  }
  const outcome = decideLearning(pkg, fix);
  if (outcome.kind !== 'learned') return outcome;
  await deps.store.set(key, outcome.place);
  const geo = learnedGeo(outcome.place);
  const same = packages.filter((p) => p.id === pkg.id || (p.status === 'pending' && learnedKey(p.address) === key));
  for (const p of same) await deps.setGeo(p.id, geo, null);
  return outcome;
}
