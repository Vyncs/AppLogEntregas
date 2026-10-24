/**
 * Preparação da foto para leitura. Etiqueta térmica costuma estar apagada, com
 * letra pequena e foto tirada na mão: reduzir/rotacionar, passar para tons de
 * cinza e esticar o contraste.
 */

/**
 * Maior lado da foto de trabalho (código de barras e recorte). Maior que o do
 * OCR porque a etiqueta é só um pedaço da foto: recortar de uma imagem
 * reduzida demais perde a letra pequena.
 */
const WORK_MAX_SIDE = 3200;
/** Maior lado da imagem que vai para o OCR: acima disso fica lento sem ganhar leitura. */
const MAX_SIDE = 2400;
/**
 * Foto pequena (recorte, print) é ampliada até este tamanho: letra pequena
 * demais o Tesseract erra — numa etiqueta real de 448 px, o nome só saiu
 * certo ampliado 3x.
 */
const MIN_LONG_SIDE = 1600;
const MAX_UPSCALE = 3;

export async function loadImage(file: Blob): Promise<ImageBitmap> {
  // "from-image" respeita a orientação EXIF da câmera
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

export type Rotation = 0 | 90 | 180 | 270;

export function scaleFor(longSide: number, maxSide = MAX_SIDE): number {
  if (longSide > maxSide) return maxSide / longSide;
  if (longSide < MIN_LONG_SIDE) return Math.min(MAX_UPSCALE, MIN_LONG_SIDE / longSide);
  return 1;
}

/** A foto, já girada, num canvas de trabalho (só reduz; ampliar é na hora do OCR). */
export function drawToCanvas(bitmap: ImageBitmap, rotation: Rotation = 0, maxSide = WORK_MAX_SIDE): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const sideways = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? h : w;
  canvas.height = sideways ? w : h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  return canvas;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Papel branco: claro e quase sem cor (o saco costuma ser azulado, cinza ou estampado). */
const isPaper = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  return max >= 150 && max - Math.min(r, g, b) <= max * 0.08;
};

/** Média móvel, para uma linha de texto ou de código de barras não partir a faixa de papel. */
export function smooth(values: ArrayLike<number>, window: number): Float64Array {
  const out = new Float64Array(values.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(values.length - 1, i + half); k++) {
      sum += values[k];
      n++;
    }
    out[i] = sum / n;
  }
  return out;
}

/** Maior trecho contínuo com densidade de pelo menos `ratio` do máximo. */
export function densestRun(density: ArrayLike<number>, ratio = 0.5): [number, number] {
  let max = 0;
  for (let i = 0; i < density.length; i++) max = Math.max(max, density[i]);
  const threshold = max * ratio;
  let best: [number, number] = [0, 0];
  let start = -1;
  for (let i = 0; i <= density.length; i++) {
    if (i < density.length && density[i] >= threshold && max > 0) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start > best[1] - best[0]) best = [start, i];
      start = -1;
    }
  }
  return best;
}

/**
 * Onde está a etiqueta na foto: a faixa de colunas e depois de linhas com mais
 * papel branco. Na foto de uma etiqueta real sobre o saco plástico, o OCR da
 * foto inteira não leu nem o nome; recortada, leu o bloco do destinatário todo.
 * `null` quando não há papel ou quando ele já ocupa a foto (nada a recortar).
 */
export function findPaperRegion(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  /** Janela da média móvel, em fração do tamanho (0 = sem suavizar) */
  smoothing = 0.04,
): Region | null {
  const paper = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < paper.length; p++, i += 4) {
    paper[p] = isPaper(rgba[i], rgba[i + 1], rgba[i + 2]) ? 1 : 0;
  }
  const cols = new Float64Array(width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cols[x] += paper[y * width + x];
  const [x0, x1] = densestRun(smoothing > 0 ? smooth(cols, Math.round(width * smoothing)) : cols);
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y++) for (let x = x0; x < x1; x++) rows[y] += paper[y * width + x];
  const [y0, y1] = densestRun(smoothing > 0 ? smooth(rows, Math.round(height * smoothing)) : rows);

  const w = x1 - x0;
  const h = y1 - y0;
  if (w < width * 0.2 || h < height * 0.1) return null;
  if (w * h > width * height * 0.9) return null;
  return { x: x0, y: y0, width: w, height: h };
}

/** Recorta e deixa no tamanho bom para o OCR (amplia recorte pequeno, reduz o grande). */
export function cropCanvas(source: HTMLCanvasElement, region: Region): HTMLCanvasElement {
  const scale = scaleFor(Math.max(region.width, region.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A foto inteira no tamanho do OCR. */
export const fitForOcr = (source: HTMLCanvasElement): HTMLCanvasElement =>
  cropCanvas(source, { x: 0, y: 0, width: source.width, height: source.height });

const ANALYSIS_WIDTH = 360;
const CROP_MARGIN = 0.04;

/** Onde está a etiqueta, já na escala da foto e com margem; `null` sem papel. */
export function paperRegionOf(source: HTMLCanvasElement, smoothing: number): Region | null {
  const scale = Math.min(1, ANALYSIS_WIDTH / source.width);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(source.width * scale));
  small.height = Math.max(1, Math.round(source.height * scale));
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, small.width, small.height);
  const region = findPaperRegion(
    ctx.getImageData(0, 0, small.width, small.height).data,
    small.width,
    small.height,
    smoothing,
  );
  if (!region) return null;

  // De volta à escala da foto, com uma margem para não cortar letra da borda
  const mx = region.width * CROP_MARGIN;
  const my = region.height * CROP_MARGIN;
  const x = Math.max(0, (region.x - mx) / scale);
  const y = Math.max(0, (region.y - my) / scale);
  const right = Math.min(source.width, (region.x + region.width + mx) / scale);
  const bottom = Math.min(source.height, (region.y + region.height + my) / scale);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(right - x), height: Math.round(bottom - y) };
}

/**
 * Estica o contraste: os tons entre os percentis 2 e 98 passam a ocupar de 0 a
 * 255. Impressão térmica apagada (cinza-claro sobre branco) volta a ter tinta
 * escura. Altera o array recebido.
 */
export function stretchContrast(gray: Uint8ClampedArray): Uint8ClampedArray {
  const histogram = new Uint32Array(256);
  for (const v of gray) histogram[v]++;
  const low = percentile(histogram, gray.length, 0.02);
  const high = percentile(histogram, gray.length, 0.98);
  const range = Math.max(1, high - low);
  for (let i = 0; i < gray.length; i++) gray[i] = ((gray[i] - low) * 255) / range;
  return gray;
}

/**
 * Tons de cinza + contraste esticado. Sem binarizar: medimos com etiquetas
 * borradas e a binarização (Otsu) derrubava a leitura do Tesseract de 92% para
 * 77% de confiança — ele binariza por dentro, e melhor.
 */
export function enhanceForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const gray = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    gray[g] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  }
  stretchContrast(gray);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    px[i] = px[i + 1] = px[i + 2] = gray[g];
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = total * fraction;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += histogram[i];
    if (acc >= target) return i;
  }
  return 255;
}
