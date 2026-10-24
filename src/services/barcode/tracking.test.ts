import { describe, expect, it } from 'vitest';
import { pickTrackingCode } from './tracking';

// Códigos fictícios.
describe('pickTrackingCode', () => {
  it('usa o código de barras e confirma com o texto impresso', () => {
    const pick = pickTrackingCode(
      [
        { value: 'IM2024000012345BR', format: 'code_128' },
        { value: 'IM2024000012345BR', format: 'qr_code' },
      ],
      ['IM2024000012345BR'],
    );
    expect(pick).toEqual({ code: 'IM2024000012345BR', source: 'barcode', confirmed: true });
  });

  it('prefere o código que também aparece impresso', () => {
    const pick = pickTrackingCode(
      [
        { value: '1234567890', format: 'code_128' },
        { value: 'IM2024000099999BR', format: 'qr_code' },
      ],
      ['IM2024000099999BR'],
    );
    expect(pick?.code).toBe('IM2024000099999BR');
  });

  it('ignora leituras implausíveis (URL, curtas)', () => {
    expect(pickTrackingCode([{ value: 'https://exemplo.test/x', format: 'qr_code' }, { value: '123', format: 'ean_8' }])).toBeNull();
  });

  it('sem código de barras: sugere o rastreio impresso, sem dar como confirmado', () => {
    expect(pickTrackingCode([], ['IM2024000012345BR'])).toEqual({
      code: 'IM2024000012345BR',
      source: 'printed',
      confirmed: false,
    });
  });
});
