import { useMemo, useState } from 'react';
import type { PackagesApi } from '../hooks/usePackages';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { RouteApi } from '../hooks/useRoute';
import { normalizeText } from '../services/label/text';
import { computeStats, type DayStats } from '../services/packages/packageService';
import {
  formatDistance,
  formatDuration,
  newPendingSince,
  routeProgress,
  sameAddressCounts,
  sameAddressKey,
} from '../services/routing/navigation';
import { SOURCE_LABEL } from '../services/routing/types';
import type { DeliveryPackage, PackageStatus } from '../types/package';
import { addressLine, placeLine } from './PackageCard';
import { RouteMapModal } from './route/RouteMapModal';
import { StartPointSection } from './route/StartPoint';
import { StopRow } from './route/StopRow';
import { MapIcon, PlusIcon, RefreshIcon } from './icons';
import { Button, Spinner } from './ui';

type Filter = 'all' | PackageStatus;

const FILTERS: Array<[Filter, string]> = [
  ['all', 'Todas'],
  ['pending', 'Pendentes'],
  ['delivered', 'Entregues'],
  ['problem', 'Problemas'],
];

const matches = (pkg: DeliveryPackage, query: string) =>
  normalizeText(
    [pkg.recipientName, addressLine(pkg), placeLine(pkg), pkg.trackingCode ?? ''].join(' '),
  ).includes(query);

interface HomeScreenProps {
  packagesApi: PackagesApi;
  route: RouteApi;
  onCapture: () => void;
  onEdit: (id: string) => void;
  /** Entregas, na próxima pendente ou na parada indicada */
  onDeliver: (at?: string) => void;
  /** Fim do dia: apaga as encomendas (todas ou só as entregues) e a rota */
  onClearDay: (onlyDelivered: boolean) => Promise<void>;
}

/**
 * Tela principal: partida, a lista do dia na ordem da rota (quando calculada)
 * e as ações — fotografar, mapa, recalcular e entregas.
 */
export function HomeScreen({ packagesApi, route, onCapture, onEdit, onDeliver, onClearDay }: HomeScreenProps) {
  const { packages, loading, error, setStatus } = packagesApi;
  const { settings, saved, busy, excludedSet } = route;
  const online = useOnlineStatus();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showMap, setShowMap] = useState(false);

  const stats = computeStats(packages);
  const byId = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);
  const plan = saved.plan;
  const stops = useMemo(
    () => (plan ? plan.stops.filter((s) => byId.has(s.packageId) && !excludedSet.has(s.packageId)) : []),
    [plan, byId, excludedSet],
  );
  const progress = plan ? routeProgress(plan, byId, excludedSet) : null;
  const fresh = plan ? newPendingSince(plan, packages, excludedSet) : [];
  const pendingCount = packages.filter((p) => p.status === 'pending' && !excludedSet.has(p.id)).length;
  const approximate = stops.filter((s) => {
    const precision = byId.get(s.packageId)?.geo?.precision;
    return precision && precision !== 'number';
  }).length;

  const shown = useMemo(() => {
    const query = normalizeText(search);
    return (pkg: DeliveryPackage) => (filter === 'all' || pkg.status === filter) && (!query || matches(pkg, query));
  }, [filter, search]);

  // Na rota: numeradas na ordem; o resto (novas, sem localização) vem depois
  const inRoute = new Set(stops.map((s) => s.packageId));
  const routeRows = stops
    .map((s, i) => ({ stop: s, number: i + 1, pkg: byId.get(s.packageId)! }))
    .filter((row) => shown(row.pkg));
  const others = packages.filter((p) => !inRoute.has(p.id) && !excludedSet.has(p.id) && shown(p));
  const excluded = packages.filter((p) => excludedSet.has(p.id));
  const atAddress = useMemo(() => sameAddressCounts(packages.filter((p) => !excludedSet.has(p.id))), [packages, excludedSet]);
  const countAt = (pkg: DeliveryPackage) => atAddress.get(sameAddressKey(pkg.address) ?? '');

  // Só a primeira letra maiúscula: "Sexta-feira, 23 de outubro"
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  const canCompute = !busy && !!settings.start && pendingCount > 0;
  // Novas desde o cálculo; as que já ficaram sem localização não contam (recalcular não resolve)
  const unlocatedSet = new Set(saved.unlocated);
  const outdated = fresh.filter((p) => !unlocatedSet.has(p.id)).length;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col pb-44">
      <header className="bg-brand-700 px-4 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] text-white">
        <h1 className="text-2xl font-bold tracking-tight">Rota Fácil</h1>
        <p className="text-sm text-brand-100">{today}</p>

        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          {(
            [
              ['Total', stats.total],
              ['Pendentes', stats.pending],
              ['Entregues', stats.delivered],
              ['Problemas', stats.problem],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/10 px-1 py-2">
              <dt className="text-[11px] text-brand-100">{label}</dt>
              <dd className="text-xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-brand-100">
            <span>Progresso do dia</span>
            <span>{Math.round(stats.progress * 100)}%</span>
          </div>
          <div
            className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/20"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stats.progress * 100)}
          >
            <div className="h-full rounded-full bg-amber-300 transition-all" style={{ width: `${stats.progress * 100}%` }} />
          </div>
        </div>
      </header>

      {!online && (
        <p className="bg-amber-100 px-4 py-2 text-sm text-amber-900" role="status">
          Sem internet. A consulta de CEP volta quando a conexão voltar.
        </p>
      )}

      <main className="flex-1 space-y-3 px-4 pt-4">
        {packages.length > 0 && <StartPointSection route={route} />}

        {busy && (
          <p className="flex items-center gap-2 rounded-xl bg-white p-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200" role="status">
            <Spinner /> {busy}
          </p>
        )}
        {route.error && (
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
            {route.error}
          </p>
        )}

        {plan && !busy && (
          <RouteSummary route={route} stopCount={stops.length} done={progress?.done ?? 0} approximate={approximate} fresh={fresh.length} />
        )}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, endereço ou rastreio"
          aria-label="Buscar encomendas"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-brand-600"
        />

        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por situação">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium ring-1 transition ${
                filter === value ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="mt-10 flex items-center justify-center gap-2 text-slate-500">
            <Spinner /> Carregando…
          </p>
        ) : error ? (
          <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : packages.length === 0 ? (
          <div className="mt-10 text-center text-slate-500">
            <p className="font-medium text-slate-700">Nenhuma encomenda ainda.</p>
            <p className="mt-1 text-sm">Fotografe a primeira etiqueta para começar.</p>
          </div>
        ) : routeRows.length === 0 && others.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">Nada encontrado com esse filtro.</p>
        ) : (
          <>
            {routeRows.length > 0 && (
              <ol className="space-y-2" aria-label="Ordem das entregas">
                {routeRows.map(({ stop, number, pkg }) => (
                  <StopRow
                    key={stop.packageId}
                    number={number}
                    stop={stop}
                    pkg={pkg}
                    onStatus={(status) => setStatus(pkg.id, status)}
                    onEdit={() => onEdit(pkg.id)}
                    onExclude={() => route.exclude(pkg.id)}
                    sameAddress={countAt(pkg)}
                    onOpen={() => onDeliver(pkg.id)}
                  />
                ))}
                {plan?.backLeg && filter === 'all' && !search && (
                  <li className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                    ↩ Volta para {plan.returnTo?.label}: +{formatDuration(plan.backLeg.seconds)}
                    {plan.backLeg.meters !== null && ` · ${formatDistance(plan.backLeg.meters)}`}
                  </li>
                )}
              </ol>
            )}
            {others.length > 0 && (
              <section aria-label={plan ? 'Fora da rota' : 'Encomendas'}>
                {plan && <p className="mb-2 mt-2 text-sm font-semibold text-slate-600">Fora da rota ({others.length})</p>}
                <ul className="space-y-2">
                  {others.map((pkg) => (
                    <StopRow
                      key={pkg.id}
                      pkg={pkg}
                      onStatus={(status) => setStatus(pkg.id, status)}
                      onEdit={() => onEdit(pkg.id)}
                      onExclude={() => route.exclude(pkg.id)}
                      sameAddress={countAt(pkg)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {excluded.length > 0 && (
          <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200" aria-label="Retiradas da rota">
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

        {!loading && !error && packages.length > 0 && <ClearDay stats={stats} onClear={onClearDay} />}

        <p className="pt-3 text-center text-xs text-slate-400">
          As encomendas ficam salvas neste aparelho. Login e sincronização chegam na próxima etapa.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" className="px-2" onClick={onCapture} aria-label="Fotografar etiqueta (adicionar à rota)">
              <PlusIcon /> Rota
            </Button>
            <Button
              variant="secondary"
              className="px-2"
              disabled={!plan || stops.length === 0}
              onClick={() => setShowMap(true)}
              aria-label="Ver mapa da rota"
            >
              <MapIcon /> Mapa
            </Button>
            <Button
              variant={outdated > 0 ? 'info' : 'secondary'}
              className="relative px-2"
              disabled={!canCompute}
              onClick={() => void route.compute()}
              aria-label={
                !plan ? 'Calcular rota' : outdated > 0 ? `Recalcular rota (${outdated} ${outdated === 1 ? 'nova' : 'novas'})` : 'Recalcular rota'
              }
            >
              <RefreshIcon /> {plan ? 'Recalcular' : 'Calcular'}
              {outdated > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-sky-600 px-1 text-xs font-bold text-white ring-2 ring-white">
                  {outdated}
                </span>
              )}
            </Button>
          </div>
          <Button size="lg" block className="mt-2" disabled={!!busy || !progress?.next} onClick={() => onDeliver()}>
            {progress && progress.done > 0 && progress.next ? 'Continuar entregas' : 'Iniciar entregas'}
          </Button>
        </div>
      </div>

      {showMap && plan && (
        <RouteMapModal
          plan={plan}
          stops={stops}
          byId={byId}
          onStatus={setStatus}
          onOpen={(id) => {
            setShowMap(false);
            onDeliver(id);
          }}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}

interface RouteSummaryProps {
  route: RouteApi;
  stopCount: number;
  done: number;
  approximate: number;
  fresh: number;
}

/** Totais da rota e os avisos: tempos estimados, localização aproximada, encomendas novas. */
function RouteSummary({ route, stopCount, done, approximate, fresh }: RouteSummaryProps) {
  const { saved, settings } = route;
  const plan = saved.plan!;
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Resumo da rota">
      <p className="text-lg font-bold">
        {stopCount} {stopCount === 1 ? 'parada' : 'paradas'}
        {plan.totalMeters !== null && ` · ${formatDistance(plan.totalMeters)}`} · ~{formatDuration(plan.totalSeconds)}
      </p>
      <p className="text-xs text-slate-500">
        Partindo de {plan.origin.label}
        {plan.returnTo ? ', com volta' : ', terminando na última entrega'}
        {settings.byStreet ? ', rua a rua' : ''}. Tempos: {SOURCE_LABEL[plan.source]} — não considera o trânsito em tempo
        real.
      </p>
      {stopCount > 0 && (
        <p className="mt-1 text-xs font-medium text-teal-800">
          {done} de {stopCount} resolvidas
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
          {approximate === stopCount ? 'Todas as paradas foram localizadas' : `${approximate} de ${stopCount} paradas foram localizadas`} só pela
          rua (o mapa gratuito não tem o número das casas). A navegação no Google Maps vai pelo endereço completo e acerta o
          número.
        </p>
      )}
      {fresh > 0 && (
        <p className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">
          {fresh} {fresh === 1 ? 'encomenda nova ficou' : 'encomendas novas ficaram'} fora desta rota. Recalcule para incluir.
        </p>
      )}
    </section>
  );
}

/** Fim do dia, com confirmação: não tem lixeira. */
function ClearDay({ stats, onClear }: { stats: DayStats; onClear: (onlyDelivered: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const others = stats.total - stats.delivered;

  const run = async (onlyDelivered: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await onClear(onlyDelivered);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="destructive" block className="mt-3 tracking-wide" onClick={() => setOpen(true)}>
        APAGAR TUDO
      </Button>
    );
  }

  return (
    <section aria-label="Apagar tudo" className="mt-3 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
      <p className="font-semibold text-red-900">Apagar tudo?</p>
      <p className="mt-1 text-sm text-red-900">
        As encomendas e a rota calculada saem deste aparelho, e não dá para desfazer. O ponto de partida continua salvo.
      </p>
      <div className="mt-3 space-y-2">
        <Button variant="destructive" block disabled={busy} onClick={() => void run(false)}>
          Apagar todas ({stats.total})
        </Button>
        {stats.delivered > 0 && others > 0 && (
          <>
            <Button variant="danger" block disabled={busy} onClick={() => void run(true)}>
              Apagar só as entregues ({stats.delivered})
            </Button>
            <p className="text-xs text-red-900">
              Só as entregues: {others === 1 ? 'a pendente ou com problema fica' : `as ${others} pendentes ou com problema ficam`}{' '}
              para o próximo dia.
            </p>
          </>
        )}
        <Button variant="ghost" block disabled={busy} onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
      {failed && (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          Não foi possível apagar. Tente de novo.
        </p>
      )}
    </section>
  );
}
