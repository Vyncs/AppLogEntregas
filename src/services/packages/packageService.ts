import type {
  Address,
  DeliveryPackage,
  GeoProblem,
  PackageDraft,
  PackageGeo,
  PackageStatus,
} from '../../types/package';
import { normalizeText } from '../label/text';
import { newId } from '../../lib/id';
import type { PackageRepository } from '../storage/packageRepository';

/** Código de rastreio comparável: sem espaços, maiúsculo. */
export function normalizeTracking(code: string | null | undefined): string | null {
  const clean = (code ?? '').replace(/\s+/g, '').toUpperCase();
  return clean.length > 0 ? clean : null;
}

export class DuplicateTrackingError extends Error {
  constructor(readonly existing: DeliveryPackage) {
    super(`Já existe uma encomenda com o rastreio ${existing.trackingCode}.`);
    this.name = 'DuplicateTrackingError';
  }
}

export class PackageNotFoundError extends Error {
  constructor(id: string) {
    super(`Encomenda ${id} não encontrada.`);
    this.name = 'PackageNotFoundError';
  }
}

export interface Clock {
  now: () => Date;
  newId: () => string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  newId,
};

/** Duplicidade principal: o mesmo código de rastreio. */
export async function findByTracking(
  repo: PackageRepository,
  code: string | null | undefined,
): Promise<DeliveryPackage | null> {
  const tracking = normalizeTracking(code);
  return tracking ? repo.findByTracking(tracking) : null;
}

/** Endereço comparável: CEP + logradouro + número + complemento, sem acento nem caixa. */
export const addressKey = (a: Address): string =>
  normalizeText([a.cep.replace(/\D/g, ''), a.street, a.number, a.complement].join('|'));

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Verificação secundária, só para avisar: mesmo destinatário e mesmo endereço
 * no mesmo dia. Não bloqueia — duas encomendas legítimas podem ir para o mesmo
 * lugar.
 */
export function findSameDaySimilar(
  packages: DeliveryPackage[],
  draft: Pick<PackageDraft, 'recipientName' | 'address'>,
  now: Date,
  ignoreId?: string,
): DeliveryPackage[] {
  const key = addressKey(draft.address);
  const name = normalizeText(draft.recipientName);
  if (!name || !draft.address.street) return [];
  return packages.filter(
    (p) =>
      p.id !== ignoreId &&
      sameLocalDay(new Date(p.createdAt), now) &&
      normalizeText(p.recipientName) === name &&
      addressKey(p.address) === key,
  );
}

export async function createPackage(
  repo: PackageRepository,
  draft: PackageDraft,
  clock: Clock = systemClock,
): Promise<DeliveryPackage> {
  const trackingCode = normalizeTracking(draft.trackingCode);
  if (trackingCode) {
    const existing = await repo.findByTracking(trackingCode);
    if (existing) throw new DuplicateTrackingError(existing);
  }
  const at = clock.now().toISOString();
  const pkg: DeliveryPackage = {
    id: clock.newId(),
    trackingCode,
    recipientName: draft.recipientName.trim(),
    address: draft.address,
    status: 'pending',
    notes: draft.notes.trim(),
    createdAt: at,
    updatedAt: at,
    ocrProvider: draft.ocrProvider,
    correctedFields: draft.correctedFields,
    history: [{ status: 'pending', at, note: 'Cadastrada' }],
    geo: draft.geo ?? null,
    geoProblem: draft.geo ? null : (draft.geoProblem ?? null),
  };
  await repo.save(pkg);
  return pkg;
}

async function load(repo: PackageRepository, id: string): Promise<DeliveryPackage> {
  const pkg = await repo.get(id);
  if (!pkg) throw new PackageNotFoundError(id);
  return pkg;
}

/** Atualiza os dados de uma encomenda existente (ex.: a mesma etiqueta lida de novo). */
export async function updatePackage(
  repo: PackageRepository,
  id: string,
  draft: PackageDraft,
  clock: Clock = systemClock,
): Promise<DeliveryPackage> {
  const pkg = await load(repo, id);
  const trackingCode = normalizeTracking(draft.trackingCode);
  if (trackingCode && trackingCode !== pkg.trackingCode) {
    const other = await repo.findByTracking(trackingCode);
    if (other && other.id !== id) throw new DuplicateTrackingError(other);
  }
  const updated: DeliveryPackage = {
    ...pkg,
    trackingCode,
    recipientName: draft.recipientName.trim(),
    address: draft.address,
    notes: draft.notes.trim(),
    correctedFields: [...new Set([...pkg.correctedFields, ...draft.correctedFields])],
    updatedAt: clock.now().toISOString(),
    // Localização: só muda quando o rascunho traz uma (endereço mexido)
    ...(draft.geo !== undefined ? { geo: draft.geo, geoProblem: draft.geo ? null : (draft.geoProblem ?? null) } : {}),
  };
  await repo.save(updated);
  return updated;
}

export async function changeStatus(
  repo: PackageRepository,
  id: string,
  status: PackageStatus,
  note?: string,
  clock: Clock = systemClock,
): Promise<DeliveryPackage> {
  const pkg = await load(repo, id);
  if (pkg.status === status && !note) return pkg;
  const at = clock.now().toISOString();
  const updated: DeliveryPackage = {
    ...pkg,
    status,
    updatedAt: at,
    history: [...pkg.history, { status, at, ...(note ? { note } : {}) }],
  };
  await repo.save(updated);
  return updated;
}

/** Grava a localização encontrada depois do cadastro (ex.: ao calcular a rota). */
export async function setPackageGeo(
  repo: PackageRepository,
  id: string,
  geo: PackageGeo | null,
  problem: GeoProblem | null,
  clock: Clock = systemClock,
): Promise<DeliveryPackage> {
  const pkg = await load(repo, id);
  const updated: DeliveryPackage = {
    ...pkg,
    geo,
    geoProblem: geo ? null : problem,
    updatedAt: clock.now().toISOString(),
  };
  await repo.save(updated);
  return updated;
}

/** Apaga de vez: fim do dia ou encomenda cadastrada por engano. */
export const deletePackages = (repo: PackageRepository, ids: string[]): Promise<void> =>
  ids.length > 0 ? repo.remove(ids) : Promise.resolve();

/** Encomenda que volta (ex.: entrega que falhou ontem): de novo pendente, com histórico. */
export const reopenPackage = (
  repo: PackageRepository,
  id: string,
  clock: Clock = systemClock,
): Promise<DeliveryPackage> => changeStatus(repo, id, 'pending', 'Reaberta por nova leitura da etiqueta', clock);

export interface DayStats {
  total: number;
  pending: number;
  delivered: number;
  problem: number;
  /** 0 a 1: entregues sobre o total */
  progress: number;
}

export function computeStats(packages: DeliveryPackage[]): DayStats {
  const count = (status: PackageStatus) => packages.filter((p) => p.status === status).length;
  const total = packages.length;
  const delivered = count('delivered');
  return {
    total,
    pending: count('pending'),
    delivered,
    problem: count('problem'),
    progress: total > 0 ? delivered / total : 0,
  };
}
