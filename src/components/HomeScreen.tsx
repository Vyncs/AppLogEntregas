import { useMemo, useState } from 'react';
import type { PackagesApi } from '../hooks/usePackages';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { normalizeText } from '../services/label/text';
import { computeStats, type DayStats } from '../services/packages/packageService';
import type { DeliveryPackage, PackageStatus } from '../types/package';
import { addressLine, PackageCard, placeLine } from './PackageCard';
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
  onCapture: () => void;
  onRoute: () => void;
  onEdit: (id: string) => void;
  /** Rota em andamento: atalho para continuar */
  routeProgress: { done: number; total: number } | null;
  onContinue: () => void;
  /** Fim do dia: apaga as encomendas (todas ou só as entregues) e a rota */
  onClearDay: (onlyDelivered: boolean) => Promise<void>;
}

export function HomeScreen({ packagesApi, onCapture, onRoute, onEdit, routeProgress, onContinue, onClearDay }: HomeScreenProps) {
  const { packages, loading, error, setStatus } = packagesApi;
  const online = useOnlineStatus();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const stats = computeStats(packages);
  const visible = useMemo(() => {
    const query = normalizeText(search);
    return packages.filter(
      (pkg) => (filter === 'all' || pkg.status === filter) && (!query || matches(pkg, query)),
    );
  }, [packages, filter, search]);

  // Só a primeira letra maiúscula: "Sexta-feira, 23 de outubro"
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col pb-28">
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

      <main className="flex-1 px-4 pt-4">
        {routeProgress && routeProgress.done < routeProgress.total && (
          <button
            type="button"
            onClick={onContinue}
            className="mb-3 flex w-full items-center justify-between rounded-2xl bg-teal-50 p-4 text-left ring-1 ring-teal-200"
          >
            <span>
              <span className="block font-semibold text-teal-900">Continuar entregas</span>
              <span className="text-sm text-teal-800">
                {routeProgress.done} de {routeProgress.total} paradas resolvidas
              </span>
            </span>
            <span aria-hidden="true" className="text-2xl text-teal-700">
              →
            </span>
          </button>
        )}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, endereço ou rastreio"
          aria-label="Buscar encomendas"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-brand-600"
        />

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por situação">
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
        ) : visible.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">Nada encontrado com esse filtro.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {visible.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onStatus={(status) => setStatus(pkg.id, status)}
                onEdit={() => onEdit(pkg.id)}
              />
            ))}
          </ul>
        )}

        {!loading && !error && packages.length > 0 && <ClearDay stats={stats} onClear={onClearDay} />}

        <p className="mt-6 text-center text-xs text-slate-400">
          As encomendas ficam salvas neste aparelho. Login e sincronização chegam na próxima etapa.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-slate-100 via-slate-100 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        <div className="mx-auto flex max-w-md gap-2">
          <Button size="lg" className="flex-1" onClick={onCapture}>
            <CameraIcon /> Fotografar etiqueta
          </Button>
          <Button size="lg" variant="secondary" onClick={onRoute} aria-label="Rota do dia">
            Rota
          </Button>
        </div>
      </div>
    </div>
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 min-h-11 w-full rounded-xl text-sm font-semibold text-red-700 hover:bg-red-50"
      >
        Apagar o dia…
      </button>
    );
  }

  return (
    <section aria-label="Apagar o dia" className="mt-6 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
      <p className="font-semibold text-red-900">Apagar o dia?</p>
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

export function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
