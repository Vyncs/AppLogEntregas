import type { DeliveryPackage } from '../../types/package';
import { openRotaFacilDb } from './db';

/**
 * Onde as encomendas ficam guardadas. Hoje: IndexedDB do aparelho. Na Etapa 3
 * entra a implementação do Supabase (com login e RLS), e a local passa a ser o
 * cache offline com fila de sincronização — por isso a interface.
 */
export interface PackageRepository {
  list(): Promise<DeliveryPackage[]>;
  get(id: string): Promise<DeliveryPackage | null>;
  findByTracking(trackingCode: string): Promise<DeliveryPackage | null>;
  /** Cria ou substitui (pelo `id`). */
  save(pkg: DeliveryPackage): Promise<void>;
  /** Apaga de vez (não tem lixeira). */
  remove(ids: string[]): Promise<void>;
}

export class IndexedDbPackageRepository implements PackageRepository {
  private open = openRotaFacilDb;

  async list(): Promise<DeliveryPackage[]> {
    return (await this.open()).getAll('packages');
  }

  async get(id: string): Promise<DeliveryPackage | null> {
    return (await (await this.open()).get('packages', id)) ?? null;
  }

  async findByTracking(trackingCode: string): Promise<DeliveryPackage | null> {
    return (await (await this.open()).getFromIndex('packages', 'byTracking', trackingCode)) ?? null;
  }

  async save(pkg: DeliveryPackage): Promise<void> {
    await (await this.open()).put('packages', pkg);
  }

  /** Numa transação só: ou apaga todas, ou nenhuma. */
  async remove(ids: string[]): Promise<void> {
    const tx = (await this.open()).transaction('packages', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }
}

/** Para testes e para rodar sem IndexedDB. */
export class MemoryPackageRepository implements PackageRepository {
  private readonly items = new Map<string, DeliveryPackage>();

  async list(): Promise<DeliveryPackage[]> {
    return [...this.items.values()].map((p) => structuredClone(p));
  }

  async get(id: string): Promise<DeliveryPackage | null> {
    const pkg = this.items.get(id);
    return pkg ? structuredClone(pkg) : null;
  }

  async findByTracking(trackingCode: string): Promise<DeliveryPackage | null> {
    const pkg = [...this.items.values()].find((p) => p.trackingCode === trackingCode);
    return pkg ? structuredClone(pkg) : null;
  }

  async save(pkg: DeliveryPackage): Promise<void> {
    this.items.set(pkg.id, structuredClone(pkg));
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) this.items.delete(id);
  }
}
