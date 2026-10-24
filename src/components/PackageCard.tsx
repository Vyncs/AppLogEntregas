import { useState } from 'react';
import type { DeliveryPackage, PackageStatus } from '../types/package';
import { Button, StatusBadge } from './ui';

export const addressLine = (pkg: DeliveryPackage) => {
  const a = pkg.address;
  const first = [a.street, a.number].filter(Boolean).join(', ');
  return [first, a.complement].filter(Boolean).join(' — ');
};

export const placeLine = (pkg: DeliveryPackage) => {
  const a = pkg.address;
  return [a.neighborhood, [a.city, a.state].filter(Boolean).join('/'), a.cep].filter(Boolean).join(' · ');
};

interface PackageCardProps {
  pkg: DeliveryPackage;
  onStatus: (status: PackageStatus) => Promise<void>;
  onEdit: () => void;
}

export function PackageCard({ pkg, onStatus, onEdit }: PackageCardProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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

  return (
    <li className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{pkg.recipientName || 'Sem nome'}</p>
          <p className="mt-0.5 text-sm text-slate-700">{addressLine(pkg)}</p>
          <p className="text-xs text-slate-500">{placeLine(pkg)}</p>
          {pkg.trackingCode && <p className="mt-1 font-mono text-xs text-slate-500">{pkg.trackingCode}</p>}
          {pkg.status === 'pending' && !pkg.geo && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              📍 {pkg.geoProblem === 'not-found' ? 'Endereço não localizado no mapa' : 'Ainda sem localização'}
            </p>
          )}
        </div>
        <StatusBadge status={pkg.status} />
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="ghost" className="px-3" disabled={busy} onClick={onEdit}>
          Editar
        </Button>
        {pkg.status === 'pending' ? (
          <>
            <Button variant="success" className="flex-1" disabled={busy} onClick={() => void act('delivered')}>
              Entregue
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void act('problem')}>
              Problema
            </Button>
          </>
        ) : (
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => void act('pending')}>
            Voltar para pendente
          </Button>
        )}
      </div>
      {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}
    </li>
  );
}
