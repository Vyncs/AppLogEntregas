import { useCallback, useEffect, useState } from 'react';
import { repository } from '../lib/services';
import {
  changeStatus,
  createPackage,
  deletePackages,
  reopenPackage,
  setPackageGeo,
  updatePackage,
} from '../services/packages/packageService';
import type { DeliveryPackage, GeoProblem, PackageDraft, PackageGeo, PackageStatus } from '../types/package';

const ORDER: Record<PackageStatus, number> = { pending: 0, problem: 1, delivered: 2 };

/** Pendentes primeiro, depois problemas, depois entregues; mais recentes no topo. */
const sortPackages = (list: DeliveryPackage[]) =>
  [...list].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt),
  );

export interface PackagesApi {
  packages: DeliveryPackage[];
  loading: boolean;
  error: string | null;
  create: (draft: PackageDraft) => Promise<DeliveryPackage>;
  update: (id: string, draft: PackageDraft) => Promise<DeliveryPackage>;
  setStatus: (id: string, status: PackageStatus, note?: string) => Promise<void>;
  reopen: (id: string) => Promise<DeliveryPackage>;
  setGeo: (id: string, geo: PackageGeo | null, problem: GeoProblem | null) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
}

export function usePackages(): PackagesApi {
  const [packages, setPackages] = useState<DeliveryPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPackages(sortPackages(await repository.list()));
      setError(null);
    } catch {
      setError('Não foi possível abrir as encomendas salvas neste aparelho.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (draft: PackageDraft) => {
      const pkg = await createPackage(repository, draft);
      await refresh();
      return pkg;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, draft: PackageDraft) => {
      const pkg = await updatePackage(repository, id, draft);
      await refresh();
      return pkg;
    },
    [refresh],
  );

  const setStatus = useCallback(
    async (id: string, status: PackageStatus, note?: string) => {
      await changeStatus(repository, id, status, note);
      await refresh();
    },
    [refresh],
  );

  const reopen = useCallback(
    async (id: string) => {
      const pkg = await reopenPackage(repository, id);
      await refresh();
      return pkg;
    },
    [refresh],
  );

  const setGeo = useCallback(
    async (id: string, geo: PackageGeo | null, problem: GeoProblem | null) => {
      await setPackageGeo(repository, id, geo, problem);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (ids: string[]) => {
      await deletePackages(repository, ids);
      await refresh();
    },
    [refresh],
  );

  return { packages, loading, error, create, update, setStatus, reopen, setGeo, remove };
}
