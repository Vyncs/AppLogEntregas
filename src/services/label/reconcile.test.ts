import { describe, expect, it } from 'vitest';
import type { AddressField } from '../../types/package';
import type { CepInfo } from '../cep/cepService';
import type { ParsedField } from './labelParser';
import { reconcileAddress } from './reconcile';

// Endereços fictícios.
const read = (overrides: Partial<Record<AddressField, string>> = {}) => {
  const base: Record<AddressField, string> = {
    cep: '06454-000',
    street: 'Rua das Flores',
    number: '539',
    complement: 'Apto 14',
    neighborhood: '',
    city: 'Barueri',
    state: 'SP',
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, { value: v, confidence: 'medium' } as ParsedField]),
  ) as Record<AddressField, ParsedField>;
};

const info = (overrides: Partial<CepInfo> = {}): CepInfo => ({
  cep: '06454000',
  street: 'Rua das Flores',
  neighborhood: 'Centro Fictício',
  city: 'Barueri',
  state: 'SP',
  generic: false,
  ...overrides,
});

describe('reconcileAddress', () => {
  it('CEP coerente: usa os dados do ViaCEP e corrige erro de OCR no logradouro', () => {
    const r = reconcileAddress(read({ street: 'R. das Fl0res' }), 'Barueri', { kind: 'found', info: info() });
    expect(r.cepStatus).toBe('ok');
    expect(r.conflicts).toEqual([]);
    expect(r.fields.street).toEqual({ value: 'Rua das Flores', confidence: 'high' });
    expect(r.fields.neighborhood).toEqual({ value: 'Centro Fictício', confidence: 'high' });
    expect(r.fields.city.confidence).toBe('high');
  });

  it('não mexe em número e complemento: o CEP não resolve esses campos', () => {
    const r = reconcileAddress(read(), 'Barueri', { kind: 'found', info: info() });
    expect(r.fields.number).toEqual({ value: '539', confidence: 'medium' });
    expect(r.fields.complement.confidence).toBe('medium');
  });

  it('tira do complemento o trecho que é o bairro do CEP', () => {
    const r = reconcileAddress(read({ complement: 'casa 2, Centro Ficticio' }), 'Barueri', { kind: 'found', info: info() });
    expect(r.fields.complement.value).toBe('casa 2');
    expect(r.fields.neighborhood.value).toBe('Centro Fictício');
  });

  it('tira do complemento a cidade e o estado que o OCR deixou ali', () => {
    const r = reconcileAddress(read({ complement: 'ponto comercial, Barueri, São Paulo' }), 'Barueri', {
      kind: 'found',
      info: info(),
    });
    expect(r.fields.complement.value).toBe('ponto comercial');
  });

  it('mantém o nome do condomínio mesmo parecido com o bairro', () => {
    const r = reconcileAddress(read({ complement: 'Apto 14, Condomínio Centro Fictício' }), 'Barueri', {
      kind: 'found',
      info: info(),
    });
    expect(r.fields.complement.value).toBe('Apto 14, Condomínio Centro Fictício');
  });

  it('separa complemento grudado na cidade ("Bloco B Barueri")', () => {
    const r = reconcileAddress(read({ city: 'Bloco B Barueri' }), 'Bloco B Barueri', { kind: 'found', info: info() });
    expect(r.fields.city.value).toBe('Barueri');
    expect(r.fields.complement.value).toBe('Apto 14, Bloco B');
  });

  it('CEP geral da cidade: mantém o logradouro lido para revisão', () => {
    const r = reconcileAddress(read({ street: 'Rua Lida no OCR' }), 'Barueri', {
      kind: 'found',
      info: info({ street: '', neighborhood: '', generic: true }),
    });
    expect(r.cepStatus).toBe('generic');
    expect(r.fields.street).toEqual({ value: 'Rua Lida no OCR', confidence: 'medium' });
  });

  it('logradouro divergente vira conflito com sugestão, sem trocar sozinho', () => {
    const r = reconcileAddress(read({ street: 'Avenida Totalmente Outra' }), 'Barueri', {
      kind: 'found',
      info: info(),
    });
    expect(r.fields.street).toEqual({ value: 'Avenida Totalmente Outra', confidence: 'low' });
    expect(r.conflicts).toEqual([
      expect.objectContaining({ field: 'street', suggestion: 'Rua das Flores' }),
    ]);
  });

  it('cidade e estado divergentes também viram conflito', () => {
    const r = reconcileAddress(read({ city: 'Campinas', state: 'RJ' }), 'Campinas', {
      kind: 'found',
      info: info(),
    });
    expect(r.conflicts.map((c) => c.field).sort()).toEqual(['city', 'state']);
  });

  it('CEP inexistente e formato inválido são sinalizados', () => {
    expect(reconcileAddress(read(), '', { kind: 'not-found' }).cepStatus).toBe('not-found');
    const invalid = reconcileAddress(read({ cep: '00000-000' }), '', null);
    expect(invalid.cepStatus).toBe('invalid');
    expect(invalid.conflicts[0].field).toBe('cep');
  });

  it('sem conexão: mantém o que foi lido e marca para validar depois', () => {
    const r = reconcileAddress(read(), 'Barueri', { kind: 'unavailable' });
    expect(r.cepStatus).toBe('unavailable');
    expect(r.fields.street.value).toBe('Rua das Flores');
  });

  it('sem CEP lido: não consulta nada', () => {
    expect(reconcileAddress(read({ cep: '' }), '', null).cepStatus).toBe('missing');
  });
});
