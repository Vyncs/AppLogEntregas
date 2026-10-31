import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { watchPosition, type LivePosition } from '../../lib/geolocation';
import { routeLine } from '../../lib/services';
import { googleMapsDirectionsUrl } from '../../services/routing/navigation';
import type { PlannedStop, RoutePlan } from '../../services/routing/planner';
import type { DeliveryPackage, LatLng, PackageStatus } from '../../types/package';
import type { MapMarker } from '../map/MapView';
import { LocateIcon } from '../icons';
import { addressLine } from '../PackageCard';
import { ProblemDialog, problemNote } from '../ProblemDialog';
import { Button, StatusBadge } from '../ui';

const MapView = lazy(() => import('../map/MapView'));

interface RouteMapModalProps {
  plan: RoutePlan;
  /** Paradas da rota, já sem as retiradas */
  stops: PlannedStop[];
  byId: Map<string, DeliveryPackage>;
  onStatus: (id: string, status: PackageStatus, note?: string) => Promise<void>;
  /** Abre a parada nas entregas */
  onOpen: (id: string) => void;
  onClose: () => void;
}

interface Spot {
  location: LatLng;
  /** Paradas neste ponto, com o número na rota */
  items: Array<{ number: number; pkg: DeliveryPackage }>;
}

/**
 * Mapa da rota em tela cheia: um círculo numerado por parada. Paradas no mesmo
 * ponto (mesmo prédio, ou localizadas só pela rua) viram um círculo só, com
 * "+N" — senão uma tampa a outra e não dá para tocar. Tocar no círculo mostra
 * as paradas dali, com Entregue, Problema e Maps.
 */
export function RouteMapModal({ plan, stops, byId, onStatus, onOpen, onClose }: RouteMapModalProps) {
  const [selected, setSelected] = useState<number | null>(null);
  // Onde você está, acompanhado enquanto o mapa está aberto
  const [me, setMe] = useState<LivePosition | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  useEffect(
    () =>
      watchPosition(
        (p) => {
          setMe(p);
          setMeError(null);
        },
        setMeError,
      ),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const spots = useMemo(() => {
    const at = new Map<string, Spot>();
    stops.forEach((s, i) => {
      const pkg = byId.get(s.packageId);
      if (!pkg?.geo) return;
      const key = `${pkg.geo.location.lat.toFixed(5)},${pkg.geo.location.lng.toFixed(5)}`;
      const spot = at.get(key) ?? { location: pkg.geo.location, items: [] };
      spot.items.push({ number: i + 1, pkg });
      at.set(key, spot);
    });
    return [...at.values()];
  }, [stops, byId]);

  const markers = useMemo<MapMarker[]>(
    () => [
      { location: plan.origin.location, label: plan.origin.label, tone: 'start' },
      ...spots.map((spot, i): MapMarker => {
        const pending = spot.items.find((item) => item.pkg.status === 'pending');
        const first = pending ?? spot.items[0];
        return {
          location: spot.location,
          label: spot.items.map((item) => `${item.number}. ${item.pkg.recipientName || 'Sem nome'}`).join('\n'),
          number: first.number,
          more: spot.items.length > 1 ? spot.items.length - 1 : undefined,
          tone: selected === i ? 'selected' : !pending ? 'done' : pending.pkg.geo?.provider === 'learned' ? 'learned' : 'stop',
        };
      }),
    ],
    [plan.origin, spots, selected],
  );

  const path = useMemo(() => [plan.origin.location, ...spots.map((s) => s.location)], [plan.origin, spots]);
  // Marcar uma entrega recria `spots` com os mesmos pontos: só busca de novo se a sequência mudar
  const pathKey = path.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
  const [streets, setStreets] = useState<{ key: string; line: LatLng[] } | null>(null);
  const [streetsFailed, setStreetsFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setStreetsFailed(false);
    routeLine(path, controller.signal)
      .then((line) => setStreets({ key: pathKey, line }))
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') setStreetsFailed(true);
      });
    return () => controller.abort();
    // `path` acompanha `pathKey`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);
  const streetLine = streets?.key === pathKey ? streets.line : null;
  const spot = selected !== null ? spots[selected] : null;
  const missing = stops.length - spots.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="fixed inset-0 z-1000 flex flex-col bg-slate-100" role="dialog" aria-modal="true" aria-label="Mapa da rota">
      <header className="flex items-center gap-2 bg-white px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-sm">
        <h2 className="flex-1 text-lg font-bold">Mapa da rota</h2>
        <Button variant="secondary" className="min-h-9" onClick={onClose}>
          Fechar
        </Button>
      </header>
      {meError && <p className="bg-slate-50 px-4 py-1.5 text-xs text-slate-600">{meError}</p>}
      {streetsFailed && (
        <p className="bg-slate-50 px-4 py-1.5 text-xs text-slate-600">
          Sem o desenho pelas ruas agora: a linha tracejada liga as paradas em linha reta.
        </p>
      )}
      {missing > 0 && (
        <p className="bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          {missing} {missing === 1 ? 'parada sem localização não aparece' : 'paradas sem localização não aparecem'} no mapa.
        </p>
      )}

      <div className="relative flex-1">
        <Suspense fallback={<p className="p-4 text-sm text-slate-500">Carregando mapa…</p>}>
          <MapView
            markers={markers}
            path={streetLine ?? path}
            pathKind={streetLine ? 'streets' : 'straight'}
            height="100%"
            keepView
            onSelect={(index) => setSelected(index === 0 ? null : index - 1)}
            me={me}
            follow={follow}
            onUserMove={() => setFollow(false)}
          />
        </Suspense>
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          disabled={!me}
          aria-pressed={follow}
          aria-label={follow ? 'Parar de seguir minha posição' : 'Seguir minha posição'}
          title={follow ? 'Parar de seguir' : 'Seguir minha posição'}
          className={`absolute right-3 top-3 z-1000 flex size-12 items-center justify-center rounded-full shadow-lg ring-1 transition disabled:opacity-50 ${
            follow ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-blue-600 ring-slate-300'
          }`}
        >
          <LocateIcon className="size-6" />
        </button>
        {!spot && (
          <p className="pointer-events-none absolute inset-x-4 bottom-4 z-1000 rounded-xl bg-white/95 p-3 text-center text-sm text-slate-600 shadow">
            Toque num círculo para ver a parada.
          </p>
        )}
      </div>

      {spot && (
        <section
          className="max-h-[50dvh] overflow-y-auto bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
          aria-label="Paradas neste ponto"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-600">
              {spot.items.length === 1 ? 'Parada' : `${spot.items.length} paradas neste ponto`}
            </p>
            <Button variant="ghost" className="min-h-9 px-3" onClick={() => setSelected(null)}>
              ✕
            </Button>
          </div>
          <ul className="space-y-3">
            {spot.items.map(({ number, pkg }) => (
              <SpotItem key={pkg.id} number={number} pkg={pkg} onStatus={(status, note) => onStatus(pkg.id, status, note)} onOpen={() => onOpen(pkg.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface SpotItemProps {
  number: number;
  pkg: DeliveryPackage;
  onStatus: (status: PackageStatus, note?: string) => Promise<void>;
  onOpen: () => void;
}

function SpotItem({ number, pkg, onStatus, onOpen }: SpotItemProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = pkg.status === 'pending';
  const [askingProblem, setAskingProblem] = useState(false);
  const reason = problemNote(pkg);

  const act = async (status: PackageStatus, note?: string) => {
    setBusy(true);
    setFailed(false);
    try {
      await onStatus(status, note);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex gap-3">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${pending ? 'bg-teal-700 text-white' : 'bg-slate-200 text-slate-600'}`}
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{pkg.recipientName || 'Sem nome'}</p>
          <p className="text-sm text-slate-700">{addressLine(pkg)}</p>
        </div>
        {!pending && <StatusBadge status={pkg.status} />}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {pending ? (
          <>
            <Button variant="success" disabled={busy} onClick={() => void act('delivered')}>
              Entregue
            </Button>
            <Button variant="warning" disabled={busy} onClick={() => setAskingProblem(true)}>
              Problema
            </Button>
          </>
        ) : (
          <Button variant="secondary" className="col-span-2" disabled={busy} onClick={() => void act('pending')}>
            Voltar para pendente
          </Button>
        )}
        {(pkg.geo || pkg.address.street) && (
          <a
            href={googleMapsDirectionsUrl(pkg.address, pkg.geo)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white text-sm font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            Maps
          </a>
        )}
        <Button variant="secondary" disabled={busy} onClick={onOpen}>
          Abrir parada
        </Button>
      </div>
      {reason && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Problema:</span> {reason}
        </p>
      )}
      {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}
      {askingProblem && (
        <ProblemDialog
          address={addressLine(pkg) || 'Sem endereço'}
          onConfirm={(note) => {
            setAskingProblem(false);
            void act('problem', note);
          }}
          onCancel={() => setAskingProblem(false)}
        />
      )}
    </li>
  );
}
