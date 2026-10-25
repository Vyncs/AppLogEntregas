import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PackagesApi } from '../hooks/usePackages';
import { useCaptureQueue, type QueueItem } from '../hooks/useCaptureQueue';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { ocrProvider, readLabelFile } from '../lib/services';
import type { ReadingStage } from '../services/label/labelPipeline';
import { recordReading } from '../services/metrics';
import { DuplicateTrackingError } from '../services/packages/packageService';
import type { DeliveryPackage, PackageDraft } from '../types/package';
import { CameraIcon, FolderIcon } from './icons';
import { addressLine, placeLine } from './PackageCard';
import { ReviewForm } from './review/ReviewForm';
import { initialBlank, initialFromPackage, initialFromReading, type ReviewInitial } from './review/reviewModel';
import { Button, Spinner, StatusBadge } from './ui';

const STAGE_LABEL: Record<ReadingStage, string> = {
  barcode: 'Lendo o código de barras…',
  ocr: 'Lendo o texto da etiqueta…',
  cep: 'Conferindo o CEP…',
};

interface Session {
  saved: number;
  duplicates: number;
  failures: number;
}

/** Edição fora da fila: digitação manual ou atualização de uma encomenda existente. */
type Editing =
  | { kind: 'manual'; initial: ReviewInitial }
  | { kind: 'update'; initial: ReviewInitial; pkg: DeliveryPackage; itemId?: string };

interface CaptureScreenProps {
  packagesApi: PackagesApi;
  onClose: () => void;
}

export function CaptureScreen({ packagesApi, onClose }: CaptureScreenProps) {
  const queue = useCaptureQueue(readLabelFile);
  const online = useOnlineStatus();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session>({ saved: 0, duplicates: 0, failures: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  /** Rastreio digitado que já existia: mostra a encomenda existente */
  const [typedDuplicate, setTypedDuplicate] = useState<DeliveryPackage | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  /** Troca a cada salvamento manual: o formulário sem foto volta em branco */
  const [blankKey, setBlankKey] = useState(0);

  useEffect(() => {
    ocrProvider.onProgress(setOcrProgress);
    return () => ocrProvider.onProgress(null);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(timer);
  }, [flash]);

  const bump = (key: keyof Session) => setSession((s) => ({ ...s, [key]: s[key] + 1 }));

  const addFiles = (list: FileList | null) => {
    if (list && list.length > 0) queue.add([...list]);
  };

  const openCamera = () => cameraInput.current?.click();

  const finishItem = useCallback(
    (item: QueueItem | undefined, message: string) => {
      if (item) queue.remove(item.id);
      setFlash(message);
    },
    [queue],
  );

  const handleCreate = async (draft: PackageDraft, item?: QueueItem) => {
    try {
      await packagesApi.create(draft);
    } catch (error) {
      if (error instanceof DuplicateTrackingError) {
        bump('duplicates');
        if (item) queue.remove(item.id);
        setEditing(null);
        setTypedDuplicate(error.existing);
        return;
      }
      throw error;
    }
    if (draft.ocrProvider !== 'manual') recordReading(draft.ocrProvider, draft.correctedFields);
    bump('saved');
    setEditing(null);
    if (!item) setBlankKey((k) => k + 1);
    finishItem(item, '✓ Encomenda salva');
  };

  const handleUpdate = async (pkg: DeliveryPackage, draft: PackageDraft, itemId?: string) => {
    await packagesApi.update(pkg.id, draft);
    setEditing(null);
    if (itemId) queue.remove(itemId);
    setFlash('✓ Dados atualizados');
  };

  const current = queue.current;

  const renderBody = () => {
    if (editing) {
      return (
        <ReviewForm
          key={editing.kind === 'update' ? `upd-${editing.pkg.id}` : 'manual'}
          initial={editing.initial}
          packages={packagesApi.packages}
          ignoreId={editing.kind === 'update' ? editing.pkg.id : undefined}
          submitLabel={editing.kind === 'update' ? 'Salvar alterações' : 'Salvar encomenda'}
          discardLabel="Cancelar"
          onSubmit={(draft) =>
            editing.kind === 'update' ? handleUpdate(editing.pkg, draft, editing.itemId) : handleCreate(draft)
          }
          onDiscard={() => setEditing(null)}
        />
      );
    }

    if (typedDuplicate) {
      return (
        <DuplicateCard
          existing={typedDuplicate}
          onReopen={async () => {
            await packagesApi.reopen(typedDuplicate.id);
            setTypedDuplicate(null);
            setFlash('✓ Encomenda reaberta');
          }}
          onEdit={() => {
            setEditing({ kind: 'update', initial: initialFromPackage(typedDuplicate), pkg: typedDuplicate });
            setTypedDuplicate(null);
          }}
          onDiscard={() => setTypedDuplicate(null)}
        />
      );
    }

    if (!current) {
      // Sem foto na fila: câmera e galeria em cima; os campos para digitar logo abaixo
      return (
        <ReviewForm
          key={`blank-${blankKey}`}
          initial={initialBlank()}
          packages={packagesApi.packages}
          submitLabel="Salvar encomenda"
          discardLabel="Limpar"
          onSubmit={(draft) => handleCreate(draft)}
          onDiscard={() => setBlankKey((k) => k + 1)}
        >
          <div className="mb-4">
            <div className="grid grid-cols-2 gap-3">
              <PhotoButton label="Câmera" aria-label="Tirar foto" onClick={openCamera}>
                <CameraIcon className="size-8" />
              </PhotoButton>
              <PhotoButton label="Galeria" aria-label="Escolher da galeria" onClick={() => galleryInput.current?.click()}>
                <FolderIcon />
              </PhotoButton>
            </div>
            <p className="mt-4 text-center text-xs font-medium text-slate-500">ou digite os dados</p>
          </div>
        </ReviewForm>
      );
    }

    if (current.state === 'queued' || current.state === 'processing') {
      return (
        <div className="mt-4 rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200">
          <img src={current.previewUrl} alt="Foto da etiqueta" className="mx-auto max-h-48 rounded-lg object-contain" />
          <p className="mt-4 flex items-center justify-center gap-2 font-medium text-slate-700" role="status">
            <Spinner /> {current.stage ? STAGE_LABEL[current.stage] : 'Na fila…'}
          </p>
          {current.stage === 'ocr' && (
            <div className="mx-auto mt-3 h-2 max-w-xs overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round(ocrProgress * 100)}%` }} />
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Na primeira leitura o leitor de texto é baixado (uma vez só).</p>
        </div>
      );
    }

    if (current.state === 'error' || !current.reading) {
      return (
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <img src={current.previewUrl} alt="Foto da etiqueta" className="mx-auto max-h-48 rounded-lg object-contain" />
          <p className="mt-3 text-sm text-red-800" role="alert">
            {current.error ?? 'Não foi possível ler esta foto.'}
          </p>
          <div className="mt-3 grid gap-2">
            <Button variant="secondary" onClick={() => queue.retryRotated(current.id)}>
              Girar e ler de novo
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                queue.remove(current.id);
                setEditing({ kind: 'manual', initial: initialBlank() });
              }}
            >
              Digitar os dados
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                bump('failures');
                queue.remove(current.id);
              }}
            >
              Descartar foto
            </Button>
          </div>
        </div>
      );
    }

    const reading = current.reading;
    if (reading.kind === 'duplicate') {
      return (
        <DuplicateCard
          existing={reading.existing}
          previewUrl={current.previewUrl}
          onReopen={async () => {
            await packagesApi.reopen(reading.existing.id);
            bump('duplicates');
            finishItem(current, '✓ Encomenda reaberta');
          }}
          onEdit={() =>
            setEditing({
              kind: 'update',
              initial: initialFromPackage(reading.existing),
              pkg: reading.existing,
              itemId: current.id,
            })
          }
          onDiscard={() => {
            bump('duplicates');
            queue.remove(current.id);
          }}
        />
      );
    }

    return (
      <ReviewForm
        key={`${current.id}-${current.rotation}`}
        initial={initialFromReading(reading)}
        previewUrl={current.previewUrl}
        packages={packagesApi.packages}
        submitLabel={queue.items.length > 1 ? 'Confirmar e próxima' : 'Confirmar'}
        onSubmit={(draft) => handleCreate(draft, current)}
        onDiscard={() => {
          bump('failures');
          queue.remove(current.id);
        }}
        onRetryRotated={() => queue.retryRotated(current.id)}
      />
    );
  };

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClose} aria-label="Voltar para as encomendas">
          ← Voltar
        </Button>
        <h1 className="flex-1 text-lg font-bold">Cadastrar etiquetas</h1>
        {(current || editing) && (
          <Button variant="secondary" onClick={openCamera} aria-label="Fotografar a próxima etiqueta">
            + Foto
          </Button>
        )}
      </header>

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs" aria-label="Resumo desta sessão">
        {(
          [
            ['Na fila', queue.waiting, 'text-slate-700'],
            ['Salvas', session.saved, 'text-emerald-700'],
            ['Repetidas', session.duplicates, 'text-amber-700'],
            ['Falhas', session.failures, 'text-red-700'],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-xl bg-white py-2 ring-1 ring-slate-200">
            <dt className="text-slate-500">{label}</dt>
            <dd className={`text-lg font-bold ${tone}`}>{value}</dd>
          </div>
        ))}
      </dl>

      {!online && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
          Sem internet: dá para ler a etiqueta, mas o CEP não será conferido agora.
        </p>
      )}

      {flash && (
        <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-800" role="status">
          {flash}
        </p>
      )}

      <div className="mt-3">{renderBody()}</div>

      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

interface PhotoButtonProps {
  label: string;
  'aria-label': string;
  onClick: () => void;
  children: ReactNode;
}

function PhotoButton({ label, onClick, children, ...rest }: PhotoButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rest['aria-label']}
      className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white text-sm font-semibold text-brand-700 ring-1 ring-slate-300 transition hover:bg-brand-50 active:bg-brand-50"
    >
      {children}
      {label}
    </button>
  );
}

interface DuplicateCardProps {
  existing: DeliveryPackage;
  previewUrl?: string;
  onReopen: () => Promise<void>;
  onEdit: () => void;
  onDiscard: () => void;
}

function DuplicateCard({ existing, previewUrl, onReopen, onEdit, onDiscard }: DuplicateCardProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const reopen = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onReopen();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-amber-300">
      <p className="text-sm font-semibold text-amber-800">Essa encomenda já está cadastrada.</p>
      {previewUrl && <img src={previewUrl} alt="Foto da etiqueta" className="mx-auto mt-3 max-h-32 rounded-lg object-contain" />}
      <div className="mt-3 rounded-xl bg-slate-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">{existing.recipientName || 'Sem nome'}</p>
          <StatusBadge status={existing.status} />
        </div>
        <p className="text-sm text-slate-700">{addressLine(existing)}</p>
        <p className="text-xs text-slate-500">{placeLine(existing)}</p>
        {existing.trackingCode && <p className="mt-1 font-mono text-xs text-slate-500">{existing.trackingCode}</p>}
      </div>
      <div className="mt-3 grid gap-2">
        {existing.status !== 'pending' && (
          <Button onClick={() => void reopen()} disabled={busy}>
            Reabrir como pendente
          </Button>
        )}
        <Button variant="secondary" onClick={onEdit} disabled={busy}>
          Atualizar os dados
        </Button>
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>
          {existing.status === 'pending' ? 'Já está pendente — continuar' : 'Descartar esta leitura'}
        </Button>
      </div>
      {failed && <p className="mt-2 text-xs font-medium text-red-700">Não foi possível reabrir. Tente de novo.</p>}
    </div>
  );
}
