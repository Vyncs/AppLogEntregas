import { describe, expect, it } from 'vitest';
import { densestRun, findPaperRegion, scaleFor, stretchContrast } from './preprocess';

/** Imagem RGBA sintética: fundo de uma cor e, opcionalmente, um retângulo de outra. */
function image(
  width: number,
  height: number,
  background: [number, number, number],
  rect?: { x: number; y: number; w: number; h: number; color: [number, number, number] },
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      // Linhas de "texto" preto dentro da etiqueta, como numa impressão
      const text = inside && y % 6 === 0 && x % 3 !== 0;
      const [r, g, b] = text ? [20, 20, 20] : inside ? rect.color : background;
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return data;
}

describe('findPaperRegion', () => {
  it('acha a etiqueta branca sobre o saco azulado', () => {
    const data = image(100, 160, [175, 198, 225], { x: 20, y: 50, w: 60, h: 80, color: [238, 240, 241] });
    const region = findPaperRegion(data, 100, 160);
    expect(region).not.toBeNull();
    expect(region!.x).toBeGreaterThanOrEqual(18);
    expect(region!.x + region!.width).toBeLessThanOrEqual(82);
    expect(region!.y).toBeGreaterThanOrEqual(48);
    expect(region!.y + region!.height).toBeLessThanOrEqual(132);
  });

  it('foto que já é só a etiqueta (papel em tudo) não é recortada', () => {
    expect(findPaperRegion(image(80, 40, [240, 240, 240]), 80, 40)).toBeNull();
  });

  it('sem papel branco, não recorta', () => {
    expect(findPaperRegion(image(80, 80, [90, 120, 160]), 80, 80)).toBeNull();
  });
});

describe('densestRun', () => {
  it('pega o trecho contínuo mais longo acima da metade do máximo', () => {
    expect(densestRun([0, 9, 9, 1, 8, 8, 8, 0])).toEqual([4, 7]);
    expect(densestRun([0, 0, 0])).toEqual([0, 0]);
  });
});

describe('scaleFor', () => {
  it('reduz foto grande, amplia recorte pequeno (até 3x) e mantém o meio-termo', () => {
    expect(scaleFor(4000)).toBeCloseTo(0.6);
    expect(scaleFor(448)).toBe(3);
    expect(scaleFor(1000)).toBeCloseTo(1.6);
    expect(scaleFor(2000)).toBe(1);
  });
});

describe('stretchContrast', () => {
  it('impressão apagada (cinza-claro sobre branco) volta a ter tinta escura', () => {
    // 30% "tinta" apagada em 170, 70% papel em 235
    const gray = new Uint8ClampedArray(100).map((_, i) => (i < 30 ? 170 : 235));
    stretchContrast(gray);
    expect(gray[0]).toBe(0);
    expect(gray[99]).toBe(255);
  });

  it('imagem de um tom só não quebra (sem divisão por zero)', () => {
    const gray = new Uint8ClampedArray(10).fill(128);
    expect([...stretchContrast(gray)].every((v) => Number.isFinite(v))).toBe(true);
  });
});
