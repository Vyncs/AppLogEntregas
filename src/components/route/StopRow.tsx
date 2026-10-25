import { useState, type KeyboardEvent } from 'react';
import { formatDistance, formatDuration, googleMapsDirectionsUrl } from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import type { DeliveryPackage, PackageStatus } from '../../types/package';
import { addressLine } from '../PackageCard';
import { ProblemDialog, problemNote } from '../ProblemDialog';
import { AlertIcon, CheckIcon, PencilIcon, PinIcon, UndoIcon, XIcon } from '../icons';
import { Button, ConfirmDialog, StatusBadge } from '../ui';

interface StopRowProps {
  /** Posição na rota; sem rota calculada (ou fora dela), sem número */
  number?: number;
  /** Trecho desde a parada anterior; sem rota, não aparece */
  stop?: PlannedStop;
  pkg: DeliveryPackage;
  /** `note`: a justificativa, quando é "com problema" */
  onStatus: (status: PackageStatus, note?: string) => Promise<void>;
  onEdit: () => void;
  onExclude: () => void;
  /** Quantas encomendas há neste endereço (contando esta), quando mais de uma */
  sameAddress?: number;
  /** Tocar no card abre a parada nas entregas (só as que estão na rota) */
  onOpen?: () => void;
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
export function StopRow({ number, stop, pkg: p, onStatus, onEdit, onExclude, sameAddress, onOpen }: StopRowProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [askingProblem, setAskingProblem] = useState(false);
  const reason = problemNote(p);
  const resolved = p.status !== 'pending';
  const canNavigate = !resolved && (p.geo || p.address.street);

  const act = async (status: PackageStatus, note?: string) => {
    setBusy(true);
    setFailed(false);
    try {
      await onStatus(status, note);
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
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${resolved || number === undefined ? 'bg-slate-200 text-slate-600' : 'bg-teal-700 text-white'}`}
          aria-hidden={number === undefined}
        >
          {number ?? '–'}
        </span>
        <div
          className={`min-w-0 flex-1 ${resolved ? 'opacity-60' : ''} ${onOpen ? '-m-1 cursor-pointer rounded-lg p-1 active:bg-slate-100' : ''}`}
          {...(onOpen && {
            role: 'button',
            tabIndex: 0,
            'aria-label': `Abrir a parada ${number ?? ''}: ${addressLine(p) || 'sem endereço'}`,
            onClick: onOpen,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            },
          })}
        >
          <p className="font-semibold leading-snug text-slate-900">{addressLine(p) || 'Sem endereço'}</p>
          <p className="truncate text-sm text-slate-600">{p.recipientName || 'Sem nome'}</p>
          <p className="truncate text-xs text-slate-500">
            {[
              p.address.neighborhood,
              stop ? `+${formatDuration(stop.legSeconds)}` : '',
              stop && stop.legMeters !== null ? formatDistance(stop.legMeters) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {p.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-600">📝 {p.notes}</p>}
          {sameAddress && sameAddress > 1 && (
            <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
              📦 {sameAddress} encomendas neste endereço
            </p>
          )}
          {!resolved && !p.geo && (
            <p className="text-xs font-medium text-amber-700">
              {p.geoProblem === 'not-found' ? 'Endereço não localizado no mapa — fica fora da rota' : 'Ainda sem localização'}
            </p>
          )}
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

      {reason && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Problema:</span> {reason}
        </p>
      )}

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
            <Button variant="warningSoft" className={ICON} disabled={busy} onClick={() => setAskingProblem(true)} aria-label="Problema" title="Problema">
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

      {askingProblem && (
        <ProblemDialog
          address={addressLine(p) || 'Sem endereço'}
          onConfirm={(note) => {
            setAskingProblem(false);
            void act('problem', note);
          }}
          onCancel={() => setAskingProblem(false)}
        />
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
