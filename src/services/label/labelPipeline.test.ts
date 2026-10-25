import { describe, expect, it } from 'vitest';
import type { OcrLine } from '../ocr/ocrProvider';
import { recipientBlock } from './labelPipeline';

const line = (text: string, y: number): OcrLine => ({ text, box: { x0: 100, y0: y, x1: 700, y1: y + 20 } });

describe('recipientBlock', () => {
  // Linhas como o Tesseract devolve uma etiqueta inteira (dados fictícios)
  const lines = [
    line('TikTok Shop 13300-000', 0),
    line('Remetente: Loja Exemplo Rua Beta 10 São Paulo, SP, 01000-000', 40),
    line('IM2024000012345BR', 80),
    line('ro) Ana Exemplo Souza [=] [5]', 200),
    line('Rua das Flores, 979 $obrado', 230),
    line('Itu, SP, 13300-000', 260),
    line('Nº de Ref 12345', 400),
  ];

  it('acha as linhas do destinatário e o recorte com uma linha de margem', () => {
    const block = recipientBlock(lines, ['ro) Ana Exemplo Souza', 'Rua das Flores, 979 Sobrado', 'Itu, SP, 13300-000']);
    expect(block).toEqual({ first: 3, last: 5, region: { x: 80, y: 180, width: 640, height: 120 } });
  });

  it('sem bloco ou sem linhas que batem, não recorta', () => {
    expect(recipientBlock(lines, [])).toBeNull();
    expect(recipientBlock(lines, ['Outra Pessoa Qualquer'])).toBeNull();
  });
});
