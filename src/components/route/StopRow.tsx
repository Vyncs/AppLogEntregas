import { useState } from 'react';
import { formatDistance, formatDuration, googleMapsDirectionsUrl } from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import type { DeliveryPackage, PackageStatus } from '../../types/package';
import { addressLine, placeLine } from '../PackageCard';
import { Button, StatusBadge } from '../ui';

interface StopRowProps {
  number: number;
  stop: PlannedStop;
  pkg: DeliveryPackage;
  onStatus: (status: PackageStatus) => Promise<void>;
  onEdit: () => void;
  onExclude: () => void;
}

/** Uma parada da lista, com as ações sem precisar abrir as entregas. */
export function StopRow({ number, stop, pkg: p, onStatus, onEdit, onExclude }: StopRowProps) {
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
