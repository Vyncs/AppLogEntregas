import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { PackageDraft } from '../../types/package';
import { IndexedDbPackageRepository, MemoryPackageRepository } from '../storage/packageRepository';
import {
  changeStatus,
  computeStats,
  createPackage,
  deletePackages,
  DuplicateTrackingError,
  findByTracking,
  findSameDaySimilar,
  normalizeTracking,
  reopenPackage,
  updatePackage,
  type Clock,
} from './packageService';

// Dados fictícios.
const draft = (overrides: Partial<PackageDraft> = {}): PackageDraft => ({
  trackingCode: 'IM2024000012345BR',
  recipientName: 'Maria Exemplo',
  address: {
    cep: '06454-000',
    street: 'Rua das Flores',
    number: '539',
    complement: 'Apto 14',
    neighborhood: 'Centro',
    city: 'Barueri',
    state: 'SP',
  },
  notes: '',
  ocrProvider: 'tesseract',
  correctedFields: [],
  ...overrides,
});

const clockAt = (iso: string): Clock => {
  let n = 0;
  return { now: () => new Date(iso), newId: () => `id-${++n}` };
};

describe('cadastro e duplicidade por rastreio', () => {
  it('cria a encomenda pendente, com histórico e rastreio normalizado', async () => {
    const repo = new MemoryPackageRepository();
    const pkg = await createPackage(repo, draft({ trackingCode: ' im2024000012345br ' }), clockAt('2026-10-23T10:00:00Z'));
    expect(pkg).toMatchObject({ id: 'id-1', status: 'pending', trackingCode: 'IM2024000012345BR' });
    expect(pkg.history).toEqual([{ status: 'pending', at: '2026-10-23T10:00:00.000Z', note: 'Cadastrada' }]);
    expect(await findByTracking(repo, 'IM2024000012345BR')).toMatchObject({ id: 'id-1' });
  });

  it('o mesmo rastreio não cria outro registro: devolve a existente', async () => {
    const repo = new MemoryPackageRepository();
    const first = await createPackage(repo, draft(), clockAt('2026-10-23T10:00:00Z'));
    await expect(createPackage(repo, draft(), clockAt('2026-10-24T09:00:00Z'))).rejects.toMatchObject({
      name: 'DuplicateTrackingError',
      existing: { id: first.id },
    });
    expect(await repo.list()).toHaveLength(1);
  });

  it('sem rastreio cadastra normalmente (duas encomendas podem ir ao mesmo endereço)', async () => {
    const repo = new MemoryPackageRepository();
    const clock = clockAt('2026-10-23T10:00:00Z');
    await createPackage(repo, draft({ trackingCode: null }), clock);
    await createPackage(repo, draft({ trackingCode: '' }), clock);
    expect(await repo.list()).toHaveLength(2);
    expect(normalizeTracking('  ')).toBeNull();
  });

  it('entrega que volta: reabre a existente como pendente, registrando no histórico', async () => {
    const repo = new MemoryPackageRepository();
    const pkg = await createPackage(repo, draft(), clockAt('2026-10-22T10:00:00Z'));
    await changeStatus(repo, pkg.id, 'problem', 'Ninguém em casa', clockAt('2026-10-22T15:00:00Z'));
    const reopened = await reopenPackage(repo, pkg.id, clockAt('2026-10-23T08:00:00Z'));
    expect(reopened.status).toBe('pending');
    expect(reopened.history.map((h) => h.status)).toEqual(['pending', 'problem', 'pending']);
  });

  it('atualizar não pode roubar o rastreio de outra encomenda', async () => {
    const repo = new MemoryPackageRepository();
    const clock = clockAt('2026-10-23T10:00:00Z');
    await createPackage(repo, draft({ trackingCode: 'AAA1234567890' }), clock);
    const b = await createPackage(repo, draft({ trackingCode: 'BBB1234567890' }), clock);
    await expect(updatePackage(repo, b.id, draft({ trackingCode: 'AAA1234567890' }), clock)).rejects.toBeInstanceOf(
      DuplicateTrackingError,
    );
  });
});

describe('mudança de status', () => {
  it('registra cada mudança e calcula o progresso do dia', async () => {
    const repo = new MemoryPackageRepository();
    const clock = clockAt('2026-10-23T10:00:00Z');
    const a = await createPackage(repo, draft({ trackingCode: 'A0000000001' }), clock);
    await createPackage(repo, draft({ trackingCode: 'B0000000001' }), clock);
    const c = await createPackage(repo, draft({ trackingCode: 'C0000000001' }), clock);
    const done = await changeStatus(repo, a.id, 'delivered', undefined, clock);
    await changeStatus(repo, c.id, 'problem', 'Endereço não encontrado', clock);

    expect(done.history.at(-1)).toEqual({ status: 'delivered', at: '2026-10-23T10:00:00.000Z' });
    expect(computeStats(await repo.list())).toEqual({ total: 3, pending: 1, delivered: 1, problem: 1, progress: 1 / 3 });
  });
});

describe('exclusão', () => {
  it('apaga de vez só as escolhidas; o rastreio apagado pode ser cadastrado de novo', async () => {
    const repo = new MemoryPackageRepository();
    const clock = clockAt('2026-10-23T10:00:00Z');
    const a = await createPackage(repo, draft({ trackingCode: 'A0000000001' }), clock);
    const b = await createPackage(repo, draft({ trackingCode: 'B0000000001' }), clock);
    const c = await createPackage(repo, draft({ trackingCode: 'C0000000001' }), clock);
    await deletePackages(repo, [a.id, c.id]);
    expect((await repo.list()).map((p) => p.id)).toEqual([b.id]);
    await expect(createPackage(repo, draft({ trackingCode: 'A0000000001' }), clock)).resolves.toMatchObject({
      status: 'pending',
    });
  });
});

describe('aviso de possível duplicidade sem rastreio', () => {
  it('avisa mesmo destinatário e endereço no mesmo dia, ignorando acento e caixa', async () => {
    const repo = new MemoryPackageRepository();
    await createPackage(repo, draft({ trackingCode: null }), clockAt('2026-10-23T10:00:00Z'));
    const list = await repo.list();
    const similar = draft({ trackingCode: null, recipientName: 'MARIA EXEMPLO', address: { ...draft().address, street: 'RUA DAS FLORES' } });
    expect(findSameDaySimilar(list, similar, new Date('2026-10-23T18:00:00Z'))).toHaveLength(1);
    expect(findSameDaySimilar(list, similar, new Date('2026-10-25T18:00:00Z'))).toHaveLength(0);
  });
});

describe('IndexedDbPackageRepository', () => {
  it('salva, lista e acha pelo rastreio', async () => {
    const repo = new IndexedDbPackageRepository();
    const pkg = await createPackage(repo, draft({ trackingCode: 'IDB0000000001' }), clockAt('2026-10-23T10:00:00Z'));
    expect(await repo.get(pkg.id)).toMatchObject({ recipientName: 'Maria Exemplo' });
    expect(await repo.findByTracking('IDB0000000001')).toMatchObject({ id: pkg.id });
    expect(await repo.findByTracking('NAOEXISTE000')).toBeNull();
  });

  it('apaga várias de uma vez', async () => {
    const repo = new IndexedDbPackageRepository();
    let n = 0;
    const clock: Clock = { now: () => new Date('2026-10-23T10:00:00Z'), newId: () => `apagar-${++n}` };
    const a = await createPackage(repo, draft({ trackingCode: 'DEL0000000001' }), clock);
    const b = await createPackage(repo, draft({ trackingCode: 'DEL0000000002' }), clock);
    await deletePackages(repo, [a.id, b.id]);
    expect(await repo.get(a.id)).toBeNull();
    expect(await repo.findByTracking('DEL0000000002')).toBeNull();
  });
});
