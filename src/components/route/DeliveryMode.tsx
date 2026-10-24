import { useMemo, useState } from 'react';
import type { PackagesApi } from '../../hooks/usePackages';
import type { RouteApi } from '../../hooks/useRoute';
import { googleMapsDirectionsUrl, routeProgress } from '../../services/routing/navigation';
import type { PackageStatus } from '../../types/package';
import { addressLine, placeLine } from '../PackageCard';
import { Button, Spinner } from '../ui';

interface DeliveryModeProps {
  packagesApi: PackagesApi;
  route: RouteApi;
  onBack: () => void;
  onEdit: (id: string) => void;
}

/**
 * Uma parada por vez, na ordem da rota: abre a navegação no Google Maps,
 * marca o resultado e já mostra a próxima.
 */
export function DeliveryMode({ packagesApi, route, onBack, onEdit }: DeliveryModeProps) {
  const { packages } = packagesApi;
  const plan = route.saved.plan;
  const byId = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const progress = plan ? routeProgress(plan, byId, route.excludedSet) : null;
  const stops = plan?.stops.filter((s) => byId.has(s.packageId) && !route.excludedSet.has(s.packageId)) ?? [];

  const mark = async (id: string, status: PackageStatus) => {
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

  if (!progress.next) {
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
        </div>
      </div>
    );
  }

  const pkg = byId.get(progress.next.packageId)!;
  const upcoming = stops.slice(progress.nextNumber).find((s) => byId.get(s.packageId)?.status === 'pending');
  const upcomingPkg = upcoming ? byId.get(upcoming.packageId) : undefined;

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-3">
      {header}
      {bar}

      <article className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200" aria-label="Próxima entrega">
        <p className="text-sm font-semibold text-teal-700">
          Parada {progress.nextNumber} de {progress.total}
        </p>
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

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="success" size="lg" disabled={saving} onClick={() => void mark(pkg.id, 'delivered')}>
            {saving ? <Spinner /> : 'Entregue'}
          </Button>
          <Button variant="warning" size="lg" disabled={saving} onClick={() => void mark(pkg.id, 'problem')}>
            Problema
          </Button>
        </div>
        <Button variant="ghost" block className="mt-2" disabled={saving} onClick={() => route.skip(pkg.id)}>
          Pular para depois
        </Button>
        {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}
      </article>

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
