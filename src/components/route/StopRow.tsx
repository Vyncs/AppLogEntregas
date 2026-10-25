import { useState } from 'react';
import { formatDistance, formatDuration, googleMapsDirectionsUrl } from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import type { DeliveryPackage, PackageStatus } from '../../types/package';
import { addressLine, placeLine } from '../PackageCard';
import { Button, ConfirmDialog, StatusBadge } from '../ui';

interface StopRowProps {
  number: number;
  stop: PlannedStop;
  pkg: DeliveryPackage;
  onStatus: (status: PackageStatus) => Promise<void>;
  onEdit: () => void;
  onExclude: () => void;
}

/** Botão só com ícone, do tamanho de um dedo; o nome vai no `aria-label`. */
const ICON = 'w-11 px-0!';

/**
 * Uma parada da lista, com as ações sem precisar abrir as entregas. O endereço
 * vem primeiro: na rua, é ele que o entregador procura; o nome confere na porta.
 */
export function StopRow({ number, stop, pkg: p, onStatus, onEdit, onExclude }: StopRowProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const resolved = p.status !== 'pending';
  const canNavigate = !resolved && (p.geo || p.address.street);

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
    <li className="flex gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <span
        className={`flex size-6 shrink-0 items-center justify-center self-center rounded-full text-xs font-bold ${resolved ? 'bg-slate-200 text-slate-600' : 'bg-teal-700 text-white'}`}
      >
        {number}
      </span>

      <div className="min-w-0 flex-1">
        <div className={resolved ? 'opacity-60' : ''}>
          <p className="font-semibold leading-snug text-slate-900">{addressLine(p) || 'Sem endereço'}</p>
          <p className="truncate text-sm text-slate-600">{p.recipientName || 'Sem nome'}</p>
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

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {resolved ? (
            <>
              <StatusBadge status={p.status} />
              <Button variant="secondary" className={ICON} disabled={busy} onClick={() => void act('pending')} aria-label="Voltar para pendente" title="Voltar para pendente">
                <UndoIcon />
              </Button>
              {p.status === 'problem' && (
                <Button variant="success" className={ICON} disabled={busy} onClick={() => void act('delivered')} aria-label="Entregue" title="Entregue">
                  <CheckIcon />
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="success" className={ICON} disabled={busy} onClick={() => void act('delivered')} aria-label="Entregue" title="Entregue">
                <CheckIcon />
              </Button>
              <Button variant="warning" className={ICON} disabled={busy} onClick={() => void act('problem')} aria-label="Problema" title="Problema">
                <AlertIcon />
              </Button>
            </>
          )}
          <Button variant="ghost" className={ICON} disabled={busy} onClick={onEdit} aria-label="Editar" title="Editar">
            <PencilIcon />
          </Button>
          {!resolved && (
            <Button variant="ghost" className={ICON} disabled={busy} onClick={() => setConfirming(true)} aria-label="Retirar" title="Retirar da rota">
              <XIcon />
            </Button>
          )}
        </div>
        {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}
      </div>

      {canNavigate && (
        <a
          href={googleMapsDirectionsUrl(p.address, p.geo)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Maps"
          className="flex w-18 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-brand-700 text-sm font-semibold text-white hover:bg-brand-800"
        >
          <PinIcon />
          Maps
        </a>
      )}

      {confirming && (
        <ConfirmDialog
          title="Retirar da rota?"
          confirmLabel="Retirar"
          onConfirm={() => {
            setConfirming(false);
            onExclude();
          }}
          onCancel={() => setConfirming(false)}
        >
          <strong>{addressLine(p) || 'Sem endereço'}</strong> ({p.recipientName || 'sem nome'}) sai da rota de hoje. A encomenda continua
          cadastrada e pode voltar pela lista "Retiradas da rota".
        </ConfirmDialog>
      )}
    </li>
  );
}

const svg = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function CheckIcon() {
  return (
    <svg {...svg} className="size-6">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...svg} className="size-6">
      <path d="M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.01" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...svg} className="size-5">
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg {...svg} className="size-5">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg {...svg} className="size-5">
      <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg {...svg} className="size-7">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
