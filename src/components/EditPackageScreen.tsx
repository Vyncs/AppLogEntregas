import { useState } from 'react';
import type { PackagesApi } from '../hooks/usePackages';
import type { DeliveryPackage } from '../types/package';
import { ReviewForm } from './review/ReviewForm';
import { initialFromPackage } from './review/reviewModel';
import { Button } from './ui';

interface EditPackageScreenProps {
  pkg: DeliveryPackage;
  packagesApi: PackagesApi;
  onClose: () => void;
}

/** Corrigir uma encomenda já salva (nome lido errado, endereço sem localização…) ou excluí-la. */
export function EditPackageScreen({ pkg, packagesApi, onClose }: EditPackageScreenProps) {
  // Fotografia da encomenda ao abrir: o formulário não reinicia se a lista atualizar
  const [initial] = useState(() => initialFromPackage(pkg));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const remove = async () => {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await packagesApi.remove([pkg.id]);
      onClose();
    } catch {
      setDeleteFailed(true);
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="mb-3 flex items-center gap-2">
        <Button variant="ghost" onClick={onClose} aria-label="Voltar sem salvar">
          ← Voltar
        </Button>
        <h1 className="flex-1 text-lg font-bold">Editar encomenda</h1>
        <Button variant="danger" className="min-h-9" disabled={confirmDelete} onClick={() => setConfirmDelete(true)}>
          Excluir
        </Button>
      </header>

      {confirmDelete && (
        <section aria-label="Excluir encomenda" className="mb-3 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
          <p className="font-semibold text-red-900">Excluir esta encomenda?</p>
          <p className="mt-1 text-sm text-red-900">
            Ela sai da lista e da rota, e não dá para desfazer. Para só tirar da rota, use “Retirar” na tela da rota.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Manter
            </Button>
            <Button variant="destructive" className="flex-1" disabled={deleting} onClick={() => void remove()}>
              Excluir de vez
            </Button>
          </div>
          {deleteFailed && (
            <p className="mt-2 text-xs font-medium text-red-700" role="alert">
              Não foi possível excluir. Tente de novo.
            </p>
          )}
        </section>
      )}
      <ReviewForm
        initial={initial}
        packages={packagesApi.packages}
        ignoreId={pkg.id}
        submitLabel="Salvar alterações"
        discardLabel="Cancelar"
        onSubmit={async (draft) => {
          await packagesApi.update(pkg.id, draft);
          onClose();
        }}
        onDiscard={onClose}
      />
    </div>
  );
}
