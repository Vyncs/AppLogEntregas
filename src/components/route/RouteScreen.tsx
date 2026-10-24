import { lazy, Suspense, useMemo, useState } from 'react';
import type { PackagesApi } from '../../hooks/usePackages';
import type { RouteApi, StartPoint } from '../../hooks/useRoute';
import { currentPosition } from '../../lib/geolocation';
import { cepService, geocoder } from '../../lib/services';
import { PRECISION_LABEL } from '../../services/geo/candidates';
import { STATE_NAME } from '../../services/geo/states';
import { locateTypedAddress, simplifyTypedAddress } from '../../services/geo/typedAddress';
import type { GeocodeCandidate } from '../../services/geo/types';
import {
  formatDistance,
  formatDuration,
  googleMapsDirectionsUrl,
  newPendingSince,
  routeProgress,
} from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import { SOURCE_LABEL } from '../../services/routing/types';
import type { Address, DeliveryPackage, LatLng, PackageStatus } from '../../types/package';
import { addressLine, placeLine } from '../PackageCard';
import { Button, Field, Spinner, StatusBadge } from '../ui';

const MapView = lazy(() => import('../map/MapView'));
const MapPicker = lazy(() => import('../map/MapPicker'));

interface RouteScreenProps {
  packagesApi: PackagesApi;
  route: RouteApi;
  onBack: () => void;
  onDeliver: () => void;
  onEdit: (id: string) => void;
}

export function RouteScreen({ packagesApi, route, onBack, onDeliver, onEdit }: RouteScreenProps) {
  const { packages } = packagesApi;
  const { settings, saved, busy, error, excludedSet } = route;
  const [editingStart, setEditingStart] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const byId = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);
  const plan = saved.plan;
  const stops = plan ? plan.stops.filter((s) => byId.has(s.packageId) && !excludedSet.has(s.packageId)) : [];
  const progress = plan ? routeProgress(plan, byId, excludedSet) : null;
  const fresh = plan ? newPendingSince(plan, packages, excludedSet) : [];
  const pendingCount = packages.filter((p) => p.status === 'pending' && !excludedSet.has(p.id)).length;
  const unlocated = packages.filter((p) => p.status === 'pending' && !p.geo && !excludedSet.has(p.id));
  const excluded = packages.filter((p) => excludedSet.has(p.id));
  const askStart = editingStart || (route.loaded && !settings.start);
  const approximate = stops.filter((s) => {
    const precision = byId.get(s.packageId)?.geo?.precision;
    return precision && precision !== 'number';
  }).length;

  const markers = useMemo(() => {
    if (!plan) return [];
    return [
      { location: plan.origin.location, label: plan.origin.label, tone: 'start' as const },
      ...stops.flatMap((s, i) => {
        const p = byId.get(s.packageId);
        return p?.geo
          ? [{ location: p.geo.location, label: p.recipientName, number: i + 1, tone: p.status === 'pending' ? ('stop' as const) : ('done' as const) }]
          : [];
      }),
    ];
  }, [plan, stops, byId]);

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} aria-label="Voltar para as encomendas">
          ← Voltar
        </Button>
        <h1 className="flex-1 text-lg font-bold">Rota do dia</h1>
      </header>

      {/* Ponto de partida */}
      <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Ponto de partida">
        {askStart ? (
          <StartPointEditor
            onSave={(start) => {
              route.setSettings({ ...settings, start });
              setEditingStart(false);
            }}
            onCancel={settings.start ? () => setEditingStart(false) : undefined}
          />
        ) : settings.start ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Partida</p>
                <p className="font-semibold">{settings.start.label}</p>
              </div>
              <Button variant="secondary" className="min-h-9" onClick={() => setEditingStart(true)}>
                Alterar
              </Button>
            </div>
            <label className="mt-3 flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-teal-700"
                checked={settings.returnToStart}
                onChange={(e) => route.setSettings({ ...settings, returnToStart: e.target.checked })}
              />
              Voltar ao ponto de partida no fim
            </label>
          </>
        ) : (
          <p className="text-sm text-slate-500">Carregando…</p>
        )}
      </section>

      {busy && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-white p-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200" role="status">
          <Spinner /> {busy}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {plan && !busy && (
        <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Resumo da rota">
          <p className="text-lg font-bold">
            {stops.length} {stops.length === 1 ? 'parada' : 'paradas'}
            {plan.totalMeters !== null && ` · ${formatDistance(plan.totalMeters)}`} · ~{formatDuration(plan.totalSeconds)}
          </p>
          <p className="text-xs text-slate-500">
            Partindo de {plan.origin.label}
            {plan.returnTo ? ', com volta' : ', terminando na última entrega'}. Tempos: {SOURCE_LABEL[plan.source]} — não
            considera o trânsito em tempo real.
          </p>
          {progress && progress.total > 0 && (
            <p className="mt-1 text-xs font-medium text-teal-800">
              {progress.done} de {progress.total} resolvidas
            </p>
          )}
          {saved.fellBack && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              {saved.fallbackReason && saved.fallbackReason !== 'Serviço de rotas indisponível no momento.'
                ? `${saved.fallbackReason} Enquanto isso, a ordem saiu da distância em linha reta, menos precisa.`
                : 'O serviço de rotas não respondeu: a ordem saiu da distância em linha reta, menos precisa. Recalcule quando houver internet.'}
            </p>
          )}
          {approximate > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              {approximate === stops.length ? 'Todas as paradas foram localizadas' : `${approximate} de ${stops.length} paradas foram localizadas`} só pela
              rua (o mapa gratuito não tem o número das casas): a ordem pode não ser a melhor. A navegação no Google Maps
              vai pelo endereço completo e acerta o número. Com a chave do Google no app, a ordem também fica precisa.
            </p>
          )}
          {fresh.length > 0 && (
            <p className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">
              {fresh.length} {fresh.length === 1 ? 'encomenda nova ficou' : 'encomendas novas ficaram'} fora desta rota.
              Recalcule para incluir.
            </p>
          )}
          <Button variant="secondary" className="mt-3 min-h-9 w-full" onClick={() => setShowMap((v) => !v)}>
            {showMap ? 'Esconder mapa' : 'Ver no mapa'}
          </Button>
          {showMap && (
            <div className="mt-2">
              <Suspense fallback={<p className="text-xs text-slate-500">Carregando mapa…</p>}>
                <MapView markers={markers} height={260} />
              </Suspense>
            </div>
          )}
        </section>
      )}

      {unlocated.length > 0 && (
        <section className="mt-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200" aria-label="Sem localização">
          <p className="text-sm font-semibold text-amber-900">
            {unlocated.length} {unlocated.length === 1 ? 'encomenda sem localização' : 'encomendas sem localização'} — fora da
            rota
          </p>
          <ul className="mt-2 space-y-2">
            {unlocated.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {p.recipientName || 'Sem nome'} · {addressLine(p)}
                </span>
                <Button variant="secondary" className="min-h-9 shrink-0" onClick={() => onEdit(p.id)}>
                  Corrigir
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && stops.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label="Ordem das entregas">
          {stops.map((s, i) => (
            <StopRow
              key={s.packageId}
              number={i + 1}
              stop={s}
              pkg={byId.get(s.packageId) as DeliveryPackage}
              onStatus={(status) => packagesApi.setStatus(s.packageId, status)}
              onEdit={() => onEdit(s.packageId)}
              onExclude={() => route.exclude(s.packageId)}
            />
          ))}
          {plan.backLeg && (
            <li className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
              ↩ Volta para {plan.returnTo?.label}: +{formatDuration(plan.backLeg.seconds)}
              {plan.backLeg.meters !== null && ` · ${formatDistance(plan.backLeg.meters)}`}
            </li>
          )}
        </ol>
      )}

      {excluded.length > 0 && (
        <section className="mt-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200" aria-label="Retiradas da rota">
          <p className="text-sm font-semibold text-slate-700">Retiradas da rota ({excluded.length})</p>
          <ul className="mt-2 space-y-2">
            {excluded.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {p.recipientName || 'Sem nome'} · {addressLine(p)}
                </span>
                <Button variant="secondary" className="min-h-9 shrink-0" onClick={() => route.include(p.id)}>
                  Voltar para a rota
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-2">
          {plan && progress?.next ? (
            <>
              <Button variant="secondary" disabled={!!busy || !settings.start} onClick={() => void route.compute()}>
                Recalcular
              </Button>
              <Button size="lg" className="flex-1" onClick={onDeliver} disabled={!!busy}>
                {progress.done > 0 ? 'Continuar entregas' : 'Iniciar entregas'}
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              block
              disabled={!!busy || !settings.start || pendingCount === 0}
              onClick={() => void route.compute()}
            >
              {pendingCount === 0 ? 'Nenhuma entrega pendente' : `Calcular rota (${pendingCount})`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface StopRowProps {
  number: number;
  stop: PlannedStop;
  pkg: DeliveryPackage;
  onStatus: (status: PackageStatus) => Promise<void>;
  onEdit: () => void;
  onExclude: () => void;
}

/** Uma parada da lista, com as ações sem precisar abrir as entregas. */
function StopRow({ number, stop, pkg: p, onStatus, onEdit, onExclude }: StopRowProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolved = p.status !== 'pending';

  const act = async (status: PackageStatus) => {
    setBusy(true);
    setFailed(false);
    try {
      await onStatus(status);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const small = 'min-h-9 px-3 text-xs';
  return (
    <li className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <div className={`flex gap-3 ${resolved ? 'opacity-60' : ''}`}>
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${resolved ? 'bg-slate-200 text-slate-600' : 'bg-teal-700 text-white'}`}
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p.recipientName || 'Sem nome'}</p>
          <p className="text-sm text-slate-700">{addressLine(p)}</p>
          <p className="text-xs text-slate-500">
            {placeLine(p)} · +{formatDuration(stop.legSeconds)}
            {stop.legMeters !== null && ` · ${formatDistance(stop.legMeters)}`}
          </p>
          {p.geo && p.geo.precision !== 'number' && (
            <p className="text-xs font-medium text-amber-700">
              Localização aproximada ({p.geo.precision === 'street' ? 'pela rua' : p.geo.precision === 'cep' ? 'pelo CEP' : 'só a cidade'})
            </p>
          )}
        </div>
        {resolved && <StatusBadge status={p.status} />}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {resolved ? (
          <>
            <Button variant="secondary" className={small} disabled={busy} onClick={() => void act('pending')}>
              Voltar para pendente
            </Button>
            {p.status === 'problem' && (
              <Button variant="success" className={small} disabled={busy} onClick={() => void act('delivered')}>
                Entregue
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="success" className={small} disabled={busy} onClick={() => void act('delivered')}>
              Entregue
            </Button>
            {(p.geo || p.address.street) && (
              <a
                href={googleMapsDirectionsUrl(p.address, p.geo)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center rounded-xl bg-white px-3 text-xs font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                Maps
              </a>
            )}
          </>
        )}
        <Button variant="ghost" className={small} disabled={busy} onClick={onEdit}>
          Editar
        </Button>
        {!resolved && (
          <Button variant="ghost" className={small} disabled={busy} onClick={onExclude}>
            Retirar
          </Button>
        )}
      </div>
      {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}
    </li>
  );
}

interface StartPointEditorProps {
  onSave: (start: StartPoint) => void;
  onCancel?: () => void;
}

function StartPointEditor({ onSave, onCancel }: StartPointEditorProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeCandidate[] | null>(null);
  const [understood, setUnderstood] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ center: LatLng; zoom: number } | null>(null);

  const search = async () => {
    if (query.trim().length < 5) {
      setError('Escreva rua, número e cidade (ou cole o endereço com o CEP).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await locateTypedAddress(query.trim(), { cep: cepService, geocoder });
      setResults(found.candidates);
      setUnderstood(found.address);
      if (found.candidates.length === 0) {
        setError(
          'O mapa gratuito não encontrou esse endereço (pode não ter essa rua cadastrada). Marque no mapa ou use a localização atual.',
        );
      }
    } catch {
      setError('Sem conexão com o mapa agora.');
    } finally {
      setBusy(false);
    }
  };

  const useHere = async () => {
    setError(null);
    try {
      onSave({ label: 'Localização marcada pelo GPS', location: await currentPosition() });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Abre o mapa no resultado encontrado, senão na cidade do CEP ou do texto. */
  const openPicker = async () => {
    setError(null);
    let center = results?.[0]?.location;
    let zoom = 17;
    if (!center) {
      const city = understood
        ? `${understood.city}, ${STATE_NAME[understood.state] ?? understood.state}`
        : simplifyTypedAddress(query).split(',').at(-1)?.trim() ?? '';
      if (city) {
        try {
          center = (await geocoder.search(city))[0]?.location;
          zoom = 14;
        } catch {
          // sem mapa da cidade: abre no padrão
        }
      }
    }
    setPicker({ center: center ?? { lat: -23.5505, lng: -46.6333 }, zoom: center ? zoom : 11 });
  };

  if (picker) {
    return (
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando mapa…</p>}>
        <MapPicker
          center={picker.center}
          zoom={picker.zoom}
          onPick={(location) => onSave({ label: query.trim() || 'Ponto marcado no mapa', location })}
          onCancel={() => setPicker(null)}
        />
      </Suspense>
    );
  }

  const best = results?.[0];

  return (
    <div>
      <p className="text-sm font-semibold">De onde você sai? (normalmente sua casa)</p>
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field
          id="campo-partida"
          label="Endereço de partida"
          value={query}
          onChange={setQuery}
          placeholder="Rua, número, cidade — ou cole com o CEP"
          action={
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : 'Buscar'}
            </Button>
          }
        />
      </form>
      {results && results.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Endereços encontrados">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full rounded-lg bg-slate-50 px-3 py-2 text-left text-sm ring-1 ring-slate-200 hover:bg-teal-50"
                onClick={() => onSave({ label: query.trim(), location: r.location })}
              >
                {r.label} <span className="text-xs text-slate-500">({PRECISION_LABEL[r.precision]})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {best && best.precision !== 'number' && (
        <p className="mt-2 text-xs text-amber-800">
          Localização aproximada ({PRECISION_LABEL[best.precision]}). Para a partida exata, marque no mapa.
        </p>
      )}
      {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void useHere()}>
          Usar minha localização atual
        </Button>
        <Button variant="secondary" onClick={() => void openPicker()}>
          Marcar no mapa
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
