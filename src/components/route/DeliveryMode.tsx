import { useMemo, useState } from 'react';
import type { PackagesApi } from '../../hooks/usePackages';
import type { RouteApi } from '../../hooks/useRoute';
import { googleMapsDirectionsUrl, routeProgress } from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import type { PackageStatus } from '../../types/package';
import { addressLine, placeLine } from '../PackageCard';
import { Button, Spinner, StatusBadge } from '../ui';

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

  const skip = (id: string) => {
    onAt(nextPendingAfter(id));
    route.skip(id);
  };

  const header = (
    <header className="flex items-center gap-2">
      <Button variant="ghost" onClick={onBack} aria-label="Voltar para a rota">
        ← Rota
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
            Voltar para a rota
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
          <div className="flex items-center gap-2">
            {!pending && <StatusBadge status={pkg.status} />}
            <Button variant="ghost" className="min-h-9 px-3" disabled={saving} onClick={() => onEdit(pkg.id)}>
              Editar
            </Button>
          </div>
        </div>
        <h2 className="mt-1 text-2xl font-bold">{pkg.recipientName || 'Sem nome'}</h2>
        <p className="mt-1 text-base text-slate-800">{addressLine(pkg)}</p>
        <p className="text-sm text-slate-500">{placeLine(pkg)}</p>
        {pkg.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{pkg.notes}</p>}
        {pkg.trackingCode && <p className="mt-2 font-mono text-xs text-slate-500">{pkg.trackingCode}</p>}

        {pkg.geo || pkg.address.street ? (
          <a
            href={googleMapsDirectionsUrl(pkg.address, pkg.geo)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex min-h-14 items-center justify-center rounded-xl bg-brand-700 text-lg font-semibold text-white"
          >
            Abrir no Google Maps
          </a>
        ) : (
          <Button variant="secondary" block className="mt-4" onClick={() => onEdit(pkg.id)}>
            Sem localização — corrigir endereço
          </Button>
        )}

        {pending ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="success" size="lg" disabled={saving} onClick={() => void mark(pkg.id, 'delivered')}>
                {saving ? <Spinner /> : 'Entregue'}
              </Button>
              <Button variant="warning" size="lg" disabled={saving} onClick={() => void mark(pkg.id, 'problem')}>
                Problema
              </Button>
            </div>
            <Button variant="ghost" block className="mt-2" disabled={saving} onClick={() => skip(pkg.id)}>
              Pular para depois
            </Button>
          </>
        ) : (
          // Resolvida: desfaz ou troca o resultado
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => void mark(pkg.id, 'pending')}>
              {saving ? <Spinner /> : 'Voltar para pendente'}
            </Button>
            {pkg.status === 'problem' ? (
              <Button variant="success" disabled={saving} onClick={() => void mark(pkg.id, 'delivered')}>
                Entregue
              </Button>
            ) : (
              <Button variant="warning" disabled={saving} onClick={() => void mark(pkg.id, 'problem')}>
                Problema
              </Button>
            )}
          </div>
        )}
        {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}
      </article>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Navegar entre as paradas">
        <Button variant="secondary" disabled={saving || index === 0} onClick={() => onAt(stops[index - 1].packageId)}>
          ← Anterior
        </Button>
        <Button
          variant="secondary"
          disabled={saving || index === stops.length - 1}
          onClick={() => onAt(stops[index + 1].packageId)}
        >
          Próxima →
        </Button>
      </div>

      {upcomingPkg && (
        <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
          Depois: <strong>{upcomingPkg.recipientName || 'Sem nome'}</strong> — {addressLine(upcomingPkg)}
        </p>
      )}

      <Button variant="secondary" block className="mt-3" disabled={!!route.busy} onClick={() => void route.recalcFromHere()}>
        {route.busy ? (
          <>
            <Spinner /> {route.busy}
          </>
        ) : (
          'Recalcular as restantes a partir daqui'
        )}
      </Button>
      {route.error && (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {route.error}
        </p>
      )}
    </div>
  );
}
