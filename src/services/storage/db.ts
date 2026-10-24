import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DeliveryPackage } from '../../types/package';

export interface RotaFacilDb extends DBSchema {
  packages: {
    key: string;
    value: DeliveryPackage;
    indexes: { byTracking: string };
  };
  /** Configurações e rota do dia */
  kv: {
    key: string;
    value: unknown;
  };
}

let db: Promise<IDBPDatabase<RotaFacilDb>> | null = null;

/** O banco local do aparelho. v1: encomendas; v2: configurações e rota. */
export function openRotaFacilDb(): Promise<IDBPDatabase<RotaFacilDb>> {
  db ??= openDB<RotaFacilDb>('rota-facil', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore('packages', { keyPath: 'id' });
        // Não é único no banco: encomenda sem rastreio fica fora do índice e
        // a regra de duplicidade mora no serviço, que oferece reabrir.
        store.createIndex('byTracking', 'trackingCode');
      }
      if (oldVersion < 2) database.createObjectStore('kv');
    },
  });
  return db;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await openRotaFacilDb()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await openRotaFacilDb()).put('kv', value, key);
}
