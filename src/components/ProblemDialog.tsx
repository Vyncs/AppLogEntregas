import { useState } from 'react';
import type { DeliveryPackage } from '../types/package';
import { Button, Modal } from './ui';

/** Os motivos mais comuns, para marcar com um toque na rua */
export const PROBLEM_REASONS = [
  'Destinatário ausente',
  'Endereço não encontrado',
  'Endereço incompleto',
  'Local fechado',
  'Recusou a encomenda',
  'Outro',
] as const;

/** A justificativa do problema atual: a observação do último "com problema" no histórico. */
export function problemNote(pkg: DeliveryPackage): string | null {
  if (pkg.status !== 'problem') return null;
  const last = [...pkg.history].reverse().find((h) => h.status === 'problem');
  return last?.note ?? null;
}

interface ProblemDialogProps {
  /** Para o título: qual endereço está com problema */
  address: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

/**
 * Ao marcar "Problema", pede o motivo: um toque num dos comuns, e uma
 * observação opcional (obrigatória em "Outro"). Vai para o histórico da
 * encomenda e aparece no card.
 */
export function ProblemDialog({ address, onConfirm, onCancel }: ProblemDialogProps) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const text = details.trim();
  const note = reason === 'Outro' ? text : [reason, text].filter(Boolean).join(' — ');
  const ready = reason !== null && (reason !== 'Outro' || text.length > 0);

  return (
    <Modal title="Qual foi o problema?" onClose={onCancel}>
      <p className="-mt-2 mb-3 truncate text-sm text-slate-500">{address}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Motivo">
        {PROBLEM_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={`min-h-12 rounded-xl px-2 text-sm font-medium ring-1 transition ${
              reason === r ? 'bg-amber-500 text-white ring-amber-500' : 'bg-white text-slate-700 ring-slate-300 hover:bg-amber-50'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <label htmlFor="problema-observacao" className="mt-4 mb-1 block text-xs font-medium text-slate-600">
        Observação {reason === 'Outro' ? '' : '(opcional)'}
      </label>
      <textarea
        id="problema-observacao"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        rows={2}
        placeholder="Ex.: deixei aviso na portaria"
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-600"
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="warning" disabled={!ready} onClick={() => onConfirm(note)}>
          Confirmar
        </Button>
      </div>
    </Modal>
  );
}
