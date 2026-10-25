import { useState } from 'react';
import { formatDistance, formatDuration, googleMapsDirectionsUrl } from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import type { DeliveryPackage, PackageStatus } from '../../types/package';
import { addressLine } from '../PackageCard';
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
const ICON = 'size-12 px-0!';
/** Ações secundárias no canto: discretas, mas com área de toque de 40 px */
const CORNER =
  'inline-flex size-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50';

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
    <li className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      {/* Cabeçalho: número, endereço e as ações secundárias (editar, retirar) no canto */}
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${resolved ? 'bg-slate-200 text-slate-600' : 'bg-teal-700 text-white'}`}
        >
          {number}
        </span>
        <div className={`min-w-0 flex-1 ${resolved ? 'opacity-60' : ''}`}>
          <p className="font-semibold leading-snug text-slate-900">{addressLine(p) || 'Sem endereço'}</p>
          <p className="truncate text-sm text-slate-600">{p.recipientName || 'Sem nome'}</p>
          <p className="truncate text-xs text-slate-500">
            {[p.address.neighborhood, `+${formatDuration(stop.legSeconds)}`, stop.legMeters !== null ? formatDistance(stop.legMeters) : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
          {p.geo && p.geo.precision !== 'number' && (
            <p className="text-xs font-medium text-amber-700">
              Localização aproximada ({p.geo.precision === 'street' ? 'pela rua' : p.geo.precision === 'cep' ? 'pelo CEP' : 'só a cidade'})
            </p>
          )}
        </div>
        <div className="-mr-1 -mt-1 flex shrink-0">
          <button type="button" className={CORNER} disabled={busy} onClick={onEdit} aria-label="Editar" title="Editar">
            <PencilIcon />
          </button>
          {!resolved && (
            <button type="button" className={CORNER} disabled={busy} onClick={() => setConfirming(true)} aria-label="Retirar" title="Retirar da rota">
              <XIcon />
            </button>
          )}
        </div>
      </div>

      {/* Ações principais, na altura do polegar: resultado à esquerda, navegação ocupando o resto */}
      <div className="mt-3 flex items-center gap-2">
        {resolved ? (
          <>
            <StatusBadge status={p.status} />
            <span className="flex-1" />
            {p.status === 'problem' && (
              <Button variant="successSoft" className={ICON} disabled={busy} onClick={() => void act('delivered')} aria-label="Entregue" title="Entregue">
                <CheckIcon />
              </Button>
            )}
            <Button variant="secondary" className="min-h-10 px-3 text-xs" disabled={busy} onClick={() => void act('pending')}>
              <UndoIcon /> Voltar para pendente
            </Button>
          </>
        ) : (
          <>
            <Button variant="successSoft" className={ICON} disabled={busy} onClick={() => void act('delivered')} aria-label="Entregue" title="Entregue">
              <CheckIcon />
            </Button>
            <Button variant="warningSoft" className={ICON} disabled={busy} onClick={() => void act('problem')} aria-label="Problema" title="Problema">
              <AlertIcon />
            </Button>
            {canNavigate && (
              <a
                href={googleMapsDirectionsUrl(p.address, p.geo)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 font-semibold text-white hover:bg-brand-800 active:bg-brand-800"
              >
                <PinIcon />
                Maps
              </a>
            )}
          </>
        )}
      </div>
      {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível salvar. Tente de novo.</p>}

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
    <svg {...svg} className="size-5">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
