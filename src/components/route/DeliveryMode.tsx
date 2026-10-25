import { useMemo, useState } from 'react';
import type { PackagesApi } from '../../hooks/usePackages';
import type { RouteApi } from '../../hooks/useRoute';
import { googleMapsDirectionsUrl, routeProgress, sameAddressKey } from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import type { DeliveryPackage, PackageStatus } from '../../types/package';
import {
  AlertIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PinIcon,
  RefreshIcon,
  UndoIcon,
} from '../icons';
import { addressLine, placeLine } from '../PackageCard';
import { Button, Spinner, StatusBadge } from '../ui';

/** Entregue / Problema / Voltar: quadrados grandes, só ícone (o nome vai no aria-label) */
const BIG_ICON = 'size-16 shrink-0 px-0!';

interface DeliveryModeProps {
  packagesApi: PackagesApi;
  route: RouteApi;
  /** Parada aberta com Anterior/Próxima; null = a próxima pendente */
  at: string | null;
  onAt: (id: string | null) => void;
  onBack: () => void;
  onEdit: (id: string) => void;
}

/**
 * Uma parada por vez, na ordem da rota: abre a navegação no Google Maps,
 * marca o resultado e já mostra a próxima. Anterior/Próxima passam pelas
 * paradas, inclusive as resolvidas — para desfazer um toque errado.
 */
export function DeliveryMode({ packagesApi, route, at, onAt, onBack, onEdit }: DeliveryModeProps) {
  const { packages } = packagesApi;
  const plan = route.saved.plan;
  const byId = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const progress = plan ? routeProgress(plan, byId, route.excludedSet) : null;
  const stops = plan?.stops.filter((s) => byId.has(s.packageId) && !route.excludedSet.has(s.packageId)) ?? [];
  const isPending = (s: PlannedStop) => byId.get(s.packageId)?.status === 'pending';
  const chosen = at ? stops.findIndex((s) => s.packageId === at) : -1;
  const index = chosen >= 0 ? chosen : stops.findIndex(isPending);

  /** A pendente depois desta (ou a primeira que sobrou), sem contar `id`. */
  const nextPendingAfter = (id: string) => {
    const other = (s: PlannedStop) => s.packageId !== id && isPending(s);
    return (stops.slice(index + 1).find(other) ?? stops.find(other))?.packageId ?? null;
  };

  const mark = async (id: string, status: PackageStatus) => {
    setSaving(true);
    setFailed(false);
    try {
      await packagesApi.setStatus(id, status);
      // Resolveu: segue para a próxima pendente. Voltou para pendente: fica nela.
      onAt(status === 'pending' ? id : nextPendingAfter(id));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  /** Outra encomenda do mesmo endereço: marca sem sair da parada aberta */
  const markHere = async (id: string, status: PackageStatus) => {
    setSaving(true);
    setFailed(false);
    try {
      await packagesApi.setStatus(id, status);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <header className="flex items-center gap-2">
      <Button variant="ghost" onClick={onBack} aria-label="Voltar para a lista">
        ← Lista
      </Button>
      <h1 className="flex-1 text-lg font-bold">Entregas</h1>
    </header>
  );

  if (!plan || !progress) {
    return (
      <div className="mx-auto min-h-dvh max-w-md px-4 pt-3">
        {header}
        <p className="mt-6 text-center text-slate-600">Calcule a rota primeiro.</p>
      </div>
    );
  }

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const bar = (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-slate-600">
        <span>
          {progress.done} de {progress.total} resolvidas
        </span>
        <span>{percent}%</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );

  if (index < 0) {
    const delivered = stops.filter((s) => byId.get(s.packageId)?.status === 'delivered').length;
    const problems = stops.filter((s) => byId.get(s.packageId)?.status === 'problem').length;
    return (
      <div className="mx-auto min-h-dvh max-w-md px-4 pt-3">
        {header}
        {bar}
        <div className="mt-6 rounded-2xl bg-emerald-50 p-6 text-center ring-1 ring-emerald-200">
          <p className="text-2xl font-bold text-emerald-800">Rota concluída</p>
          <p className="mt-2 text-sm text-emerald-900">
            {delivered} {delivered === 1 ? 'entregue' : 'entregues'}
            {problems > 0 && ` · ${problems} com problema`}
          </p>
          <Button className="mt-4" onClick={onBack}>
            Voltar para a lista
          </Button>
          {stops.length > 0 && (
            <Button variant="ghost" block className="mt-2" onClick={() => onAt(stops[stops.length - 1].packageId)}>
              ← Rever as paradas
            </Button>
          )}
        </div>
      </div>
    );
  }

  const pkg = byId.get(stops[index].packageId)!;
  const pending = pkg.status === 'pending';
  // Outras encomendas da rota no mesmo endereço (mesmo prédio, mesma casa)
  const addressKey = sameAddressKey(pkg.address);
  const sameAddress = addressKey
    ? stops
        .map((s) => byId.get(s.packageId)!)
        .filter((p) => p.id !== pkg.id && sameAddressKey(p.address) === addressKey)
    : [];
  const upcoming = stops.slice(index + 1).find(isPending);
  const upcomingPkg = upcoming ? byId.get(upcoming.packageId) : undefined;

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-3">
      {header}
      {bar}

      <article className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200" aria-label="Parada">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-teal-700">
            Parada {index + 1} de {stops.length}
          </p>
          <div className="-mr-2 flex items-center gap-1">
            {!pending && <StatusBadge status={pkg.status} />}
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              disabled={saving}
              onClick={() => onEdit(pkg.id)}
              aria-label="Editar"
              title="Editar"
            >
              <PencilIcon />
            </button>
          </div>
        </div>
        {/* O endereço é o que se procura na rua; o nome confere na porta */}
        <h2 className="mt-1 text-2xl font-bold leading-tight">{addressLine(pkg) || 'Sem endereço'}</h2>
        <p className="mt-1 text-lg text-slate-700">{pkg.recipientName || 'Sem nome'}</p>
        <p className="text-sm text-slate-500">{placeLine(pkg)}</p>
        {pkg.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{pkg.notes}</p>}

        {sameAddress.length > 0 && (
          <section aria-label="Mesmo endereço" className="mt-3 rounded-xl bg-amber-50 p-3 ring-2 ring-amber-300">
            <p className="font-semibold text-amber-900">
              📦 {sameAddress.length === 1 ? 'Mais 1 encomenda' : `Mais ${sameAddress.length} encomendas`} neste endereço
            </p>
            <p className="text-xs text-amber-800">Entregue tudo de uma vez: confira os nomes nos pacotes.</p>
            <ul className="mt-2 space-y-2">
              {sameAddress.map((other) => (
                <li key={other.id} className="flex items-center gap-2 rounded-lg bg-white p-2 ring-1 ring-amber-200">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{other.recipientName || 'Sem nome'}</p>
                    {other.address.complement && <p className="truncate text-xs text-slate-600">{other.address.complement}</p>}
                  </div>
                  {other.status === 'pending' ? (
                    <Button
                      variant="successSoft"
                      className="size-10 shrink-0 px-0!"
                      disabled={saving}
                      onClick={() => void markHere(other.id, 'delivered')}
                      aria-label={`Marcar ${other.recipientName || 'encomenda'} como entregue`}
                      title="Entregue"
                    >
                      <CheckIcon className="size-5" />
                    </Button>
                  ) : (
                    <StatusBadge status={other.status} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {pkg.trackingCode && <p className="mt-2 font-mono text-xs text-slate-500">{pkg.trackingCode}</p>}

        {pending ? (
          <>
            {/* Mesma linha de ações do card da lista, maior: resultado à esquerda, navegação no resto */}
            <div className="mt-4 flex gap-2">
              <Button variant="success" className={BIG_ICON} disabled={saving} onClick={() => void mark(pkg.id, 'delivered')} aria-label="Entregue" title="Entregue">
                {saving ? <Spinner /> : <CheckIcon className="size-8" />}
              </Button>
              <Button variant="warning" className={BIG_ICON} disabled={saving} onClick={() => void mark(pkg.id, 'problem')} aria-label="Problema" title="Problema">
                <AlertIcon className="size-8" />
              </Button>
              <MapsButton pkg={pkg} onFix={() => onEdit(pkg.id)} />
            </div>
          </>
        ) : (
          // Resolvida: desfaz ou troca o resultado
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className={BIG_ICON} disabled={saving} onClick={() => void mark(pkg.id, 'pending')} aria-label="Voltar para pendente" title="Voltar para pendente">
              {saving ? <Spinner /> : <UndoIcon className="size-7" />}
            </Button>
            {pkg.status === 'problem' ? (
              <Button variant="success" className={BIG_ICON} disabled={saving} onClick={() => void mark(pkg.id, 'delivered')} aria-label="Entregue" title="Entregue">
                <CheckIcon className="size-8" />
              </Button>
            ) : (
              <Button variant="warning" className={BIG_ICON} disabled={saving} onClick={() => void mark(pkg.id, 'problem')} aria-label="Problema" title="Problema">
                <AlertIcon className="size-8" />
              </Button>
            )}
            <MapsButton pkg={pkg} onFix={() => onEdit(pkg.id)} />
          </div>
        )}
        {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}
      </article>

      <div className="mt-3 flex gap-2" role="group" aria-label="Navegar entre as paradas">
        <Button
          variant="secondary"
          className="size-12 shrink-0 px-0!"
          disabled={saving || index === 0}
          onClick={() => onAt(stops[index - 1].packageId)}
          aria-label="Parada anterior"
          title="Parada anterior"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="secondary"
          className="min-h-12 min-w-0 flex-1 px-2"
          disabled={!!route.busy}
          onClick={() => void route.recalcFromHere()}
          aria-label="Recalcular as restantes a partir daqui"
          title="Recalcular as restantes a partir daqui"
        >
          {route.busy ? (
            <>
              <Spinner /> <span className="truncate">{route.busy}</span>
            </>
          ) : (
            <>
              <RefreshIcon /> Recalcular daqui
            </>
          )}
        </Button>
        <Button
          variant="secondary"
          className="size-12 shrink-0 px-0!"
          disabled={saving || index === stops.length - 1}
          onClick={() => onAt(stops[index + 1].packageId)}
          aria-label="Próxima parada"
          title="Próxima parada"
        >
          <ChevronRightIcon />
        </Button>
      </div>

      {upcomingPkg && (
        <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
          Depois: <strong>{addressLine(upcomingPkg) || 'Sem endereço'}</strong> — {upcomingPkg.recipientName || 'Sem nome'}
        </p>
      )}

      {route.error && (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {route.error}
        </p>
      )}
    </div>
  );
}

/** Navegação até a parada; sem rua nem ponto, leva para corrigir o endereço. */
function MapsButton({ pkg, onFix }: { pkg: DeliveryPackage; onFix: () => void }) {
  if (!pkg.geo && !pkg.address.street) {
    return (
      <Button variant="secondary" className="min-h-16 flex-1" onClick={onFix}>
        Sem localização — corrigir
      </Button>
    );
  }
  return (
    <a
      href={googleMapsDirectionsUrl(pkg.address, pkg.geo)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir no Google Maps"
      className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 text-lg font-semibold text-white hover:bg-brand-800 active:bg-brand-800"
    >
      <PinIcon className="size-6" />
      Maps
    </a>
  );
}
