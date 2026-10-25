import { useCallback, useEffect, useMemo, useState } from 'react';
import { currentPosition } from '../lib/geolocation';
import { geocoder, matrixProvider } from '../lib/services';
import { decideCandidates, needsGeocode, toPackageGeo } from '../services/geo/candidates';
import { moveStopToEnd } from '../services/routing/navigation';
import { planRoute, type CachedMatrix, type NamedPoint, type RoutePlan, type RoutePoint } from '../services/routing/planner';
import { kvGet, kvSet } from '../services/storage/db';
import type { LatLng } from '../types/package';
import type { PackagesApi } from './usePackages';

export interface StartPoint {
  label: string;
  location: LatLng;
}

export interface RouteSettings {
  start: StartPoint | null;
  /** Voltar ao ponto de partida no fim (padrão: não) */
  returnToStart: boolean;
  /** Rua a rua, da mais perto para a seguinte (padrão), em vez da ordem mais rápida */
  byStreet: boolean;
}

export interface SavedRoute {
  plan: RoutePlan | null;
  cache: CachedMatrix | null;
  /** Encomendas retiradas da rota pelo usuário (continuam cadastradas) */
  excluded: string[];
  /** Pendentes que ficaram fora por falta de localização */
  unlocated: string[];
  /** A ordem saiu da linha reta (serviço de rotas falhou) */
  fellBack: boolean;
  fallbackReason?: string;
}

const SETTINGS_KEY = 'route-settings';
const ROUTE_KEY = 'route-plan';
const DEFAULT_SETTINGS: RouteSettings = { start: null, returnToStart: false, byStreet: true };
const EMPTY: SavedRoute = { plan: null, cache: null, excluded: [], unlocated: [], fellBack: false };

/** Rota do dia: ponto de partida, cálculo, recálculo e ajustes, salvos no aparelho. */
export function useRoute(packagesApi: PackagesApi) {
  const [settings, setSettingsState] = useState<RouteSettings>(DEFAULT_SETTINGS);
  const [saved, setSavedState] = useState<SavedRoute>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([kvGet<RouteSettings>(SETTINGS_KEY), kvGet<SavedRoute>(ROUTE_KEY)])
      .then(([s, r]) => {
        if (s) setSettingsState({ ...DEFAULT_SETTINGS, ...s });
        if (r) setSavedState({ ...EMPTY, ...r });
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const setSettings = useCallback((next: RouteSettings) => {
    setSettingsState(next);
    void kvSet(SETTINGS_KEY, next).catch(() => undefined);
  }, []);

  const setSaved = useCallback((update: (current: SavedRoute) => SavedRoute) => {
    setSavedState((current) => {
      const next = update(current);
      void kvSet(ROUTE_KEY, next).catch(() => undefined);
      return next;
    });
  }, []);

  /**
   * Calcula (ou recalcula) a rota das encomendas pendentes. Antes, localiza as
   * que ainda não têm coordenadas. `origin` troca a partida (ex.: localização
   * atual ou a última entrega feita).
   */
  const compute = useCallback(
    async (origin?: NamedPoint) => {
      const start = settings.start;
      const from: NamedPoint | null = origin ?? (start ? { id: 'start', label: start.label, location: start.location } : null);
      if (!from) {
        setError('Defina o ponto de partida.');
        return;
      }
      setError(null);
      const excluded = new Set(saved.excluded);
      const pending = packagesApi.packages.filter((p) => p.status === 'pending' && !excluded.has(p.id));
      const missing = pending.filter((p) => needsGeocode(p.geo, geocoder.id));

      const located: RoutePoint[] = [];
      const unlocated: string[] = [];
      let done = 0;
      for (const p of pending) {
        const street = { street: p.address.street, number: p.address.number, city: p.address.city };
        if (p.geo && !needsGeocode(p.geo, geocoder.id)) {
          located.push({ id: p.id, location: p.geo.location, street });
          continue;
        }
        done += 1;
        setBusy(`Localizando endereços (${done} de ${missing.length})…`);
        try {
          const outcome = decideCandidates(p.address, await geocoder.geocode(p.address));
          if (outcome.kind === 'found') {
            const geo = toPackageGeo(outcome.best);
            await packagesApi.setGeo(p.id, geo, null);
            located.push({ id: p.id, location: geo.location, street });
          } else {
            await packagesApi.setGeo(p.id, null, 'not-found');
            unlocated.push(p.id);
          }
        } catch {
          // Sem conexão: fica com o ponto que já tinha, se tinha
          if (p.geo) {
            located.push({ id: p.id, location: p.geo.location, street });
          } else {
            await packagesApi.setGeo(p.id, null, 'unavailable');
            unlocated.push(p.id);
          }
        }
      }

      if (located.length === 0) {
        setBusy(null);
        setError(
          pending.length === 0
            ? 'Não há encomendas pendentes para montar a rota.'
            : 'Nenhuma encomenda pendente foi localizada no mapa. Confira os endereços.',
        );
        return;
      }

      setBusy(`Calculando tempos entre ${located.length} paradas…`);
      const returnTo = settings.returnToStart && start ? { id: 'start', label: start.label, location: start.location } : null;
      try {
        const result = await planRoute({
          origin: from,
          stops: located,
          returnTo,
          provider: matrixProvider,
          cache: saved.cache,
          byStreet: settings.byStreet,
        });
        setSaved((current) => ({
          ...current,
          plan: result.plan,
          cache: result.cache,
          unlocated,
          fellBack: result.fellBack,
          fallbackReason: result.fallbackReason,
        }));
      } catch {
        setError('Não foi possível calcular a rota. Tente de novo.');
      } finally {
        setBusy(null);
      }
    },
    [settings, saved.excluded, saved.cache, packagesApi, setSaved],
  );

  /** Recalcula as restantes a partir de onde o entregador está (GPS) ou da última entrega feita. */
  const recalcFromHere = useCallback(async () => {
    const plan = saved.plan;
    try {
      const here = await currentPosition();
      await compute({ id: 'gps', label: 'Sua localização', location: here });
      return;
    } catch {
      // Sem GPS: parte da última parada resolvida (já está na matriz guardada)
    }
    const byId = new Map(packagesApi.packages.map((p) => [p.id, p]));
    const lastDone = [...(plan?.stops ?? [])]
      .reverse()
      .map((s) => byId.get(s.packageId))
      .find((p) => p && p.status !== 'pending' && p.geo);
    await compute(
      lastDone?.geo ? { id: lastDone.id, label: lastDone.recipientName || 'Última entrega', location: lastDone.geo.location } : undefined,
    );
  }, [saved.plan, packagesApi.packages, compute]);

  const exclude = useCallback(
    (id: string) => setSaved((c) => ({ ...c, excluded: [...new Set([...c.excluded, id])] })),
    [setSaved],
  );
  const include = useCallback(
    (id: string) => setSaved((c) => ({ ...c, excluded: c.excluded.filter((e) => e !== id) })),
    [setSaved],
  );
  const skip = useCallback(
    (id: string) => setSaved((c) => (c.plan ? { ...c, plan: moveStopToEnd(c.plan, id) } : c)),
    [setSaved],
  );
  const clear = useCallback(() => setSaved(() => EMPTY), [setSaved]);

  const excludedSet = useMemo(() => new Set(saved.excluded), [saved.excluded]);

  return { loaded, settings, setSettings, saved, excludedSet, busy, error, compute, recalcFromHere, exclude, include, skip, clear };
}

export type RouteApi = ReturnType<typeof useRoute>;
