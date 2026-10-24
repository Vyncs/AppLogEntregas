import { describe, expect, it } from 'vitest';
import { BLANK_VALUES, correctedFields, initialBlank, toDraft, validateValues, type FormValues } from './reviewModel';

// Dados fictícios.
const values = (overrides: Partial<FormValues> = {}): FormValues => ({
  ...BLANK_VALUES,
  recipientName: 'Maria Exemplo',
  cep: '06454000',
  street: 'Rua das Flores',
  number: '539',
  complement: 'Apto 14',
  neighborhood: 'Centro',
  city: 'Barueri',
  state: 'sp',
  ...overrides,
});

describe('validação do cadastro', () => {
  it('aceita um endereço completo', () => {
    expect(validateValues(values())).toEqual({});
  });

  it('aponta o que falta sem bloquear o rastreio vazio', () => {
    const errors = validateValues(values({ recipientName: '', number: '', state: 'XX', cep: '123', trackingCode: '' }));
    expect(Object.keys(errors).sort()).toEqual(['cep', 'number', 'recipientName', 'state']);
  });
});

describe('rascunho e métrica de correções', () => {
  it('formata CEP e UF e registra só os nomes dos campos corrigidos', () => {
    const initial = { ...initialBlank(), provider: 'tesseract' as const, values: values({ number: '53' }) };
    const draft = toDraft(values({ trackingCode: ' IM1 ', number: '539' }), initial);
    expect(draft.address).toMatchObject({ cep: '06454-000', state: 'SP', number: '539' });
    expect(draft.trackingCode).toBe('IM1');
    expect(draft.correctedFields).toEqual(['trackingCode', 'number']);
  });

  it('digitação manual não conta como correção de OCR', () => {
    expect(toDraft(values(), initialBlank()).correctedFields).toEqual([]);
    expect(correctedFields(values(), values())).toEqual([]);
  });
});
