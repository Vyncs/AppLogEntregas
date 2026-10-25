import type { DeliveryPackage, OcrProviderId } from '../../types/package';
import type { BarcodeReader } from '../barcode/barcodeReader';
import { pickTrackingCode, type TrackingPick } from '../barcode/tracking';
import { CepUnavailableError, type CepService } from '../cep/cepService';
import type { OcrLine, OcrProvider, OcrResult } from '../ocr/ocrProvider';
import { cropCanvas, drawToCanvas, enhanceForOcr, fitForOcr, loadImage, paperRegionOf, type Region, type Rotation } from '../ocr/preprocess';
import { isValidCepFormat } from './cep';
import { isCompleteLabel, parseLabelText, scoreLabel, type ParsedLabel } from './labelParser';
import { reconcileAddress, type CepLookup, type ReviewAddress } from './reconcile';
import { normalizeText } from './text';

/** Etapas de uma leitura, para mostrar o progresso. */
export type ReadingStage = 'barcode' | 'ocr' | 'cep';

export interface LabelPipelineDeps {
  barcode: BarcodeReader;
  ocr: OcrProvider;
  cep: CepService;
  findByTracking: (code: string) => Promise<DeliveryPackage | null>;
}

export type LabelReading =
  | { kind: 'duplicate'; tracking: TrackingPick; existing: DeliveryPackage }
  | {
      kind: 'review';
      tracking: TrackingPick | null;
      parsed: ParsedLabel;
      review: ReviewAddress;
      /** 0 a 100 */
      ocrConfidence: number;
      provider: OcrProviderId;
      /** Texto lido, só para mostrar na revisão — nunca é salvo */
      ocrText: string;
    };

const wordsOf = (text: string) => normalizeText(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

/**
 * Onde está o bloco do destinatário na imagem: as linhas lidas (com posição)
 * que batem com as linhas que o parser usou para o nome e o endereço. Fica o
 * maior trecho seguido de linhas que batem — uma linha solta parecida (o
 * "Rua" do remetente) não estica o recorte. `null` sem posição ou sem bloco.
 */
export function recipientBlock(
  lines: OcrLine[],
  recipientLines: string[],
): { first: number; last: number; region: Region } | null {
  const target = new Set(recipientLines.flatMap(wordsOf));
  if (target.size === 0) return null;
  const hits = lines
    .map((line, i) => ({ i, words: wordsOf(line.text) }))
    .filter(({ words }) => words.length > 0 && words.filter((w) => target.has(w)).length / words.length >= 0.6)
    .map(({ i }) => i);
  if (hits.length === 0) return null;

  // Trechos seguidos (tolerando uma linha que não bateu no meio); fica o com mais linhas
  let best: number[] = [];
  let run: number[] = [];
  for (const i of hits) {
    if (run.length && i - run[run.length - 1] > 2) run = [];
    run.push(i);
    if (run.length > best.length) best = [...run];
  }
  const first = best[0];
  const last = best[best.length - 1];
  const boxes = lines.slice(first, last + 1).map((l) => l.box);
  const heights = boxes.map((b) => b.y1 - b.y0).sort((a, b) => a - b);
  // Margem de uma linha: o ícone "TO" e o fim do CEP ficam dentro
  const margin = heights[Math.floor(heights.length / 2)] ?? 0;
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x0)) - margin);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y0)) - margin);
  const x1 = Math.max(...boxes.map((b) => b.x1)) + margin;
  const y1 = Math.max(...boxes.map((b) => b.y1)) + margin;
  return { first, last, region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

interface Reading {
  ocr: OcrResult;
  parsed: ParsedLabel;
  score: number;
}

/**
 * Segunda leitura só do destinatário: a primeira acha onde ele está; o bloco
 * é recortado da foto de trabalho (mais resolução que a do OCR), ampliado e
 * lido como um bloco só de texto. Na etiqueta inteira, o leitor gasta
 * resolução e atenção em códigos de barras, logo e remetente, e o nome sai com
 * sujeira ("Ana Souza [=] [5]", "ro) Ana Souza", "$obrado"). O texto do bloco
 * entra no lugar das linhas do bloco, e o resto (CEP grande, remetente,
 * rastreio) continua da primeira leitura.
 */
async function focusOnRecipient(
  canvas: HTMLCanvasElement,
  source: Region,
  first: Reading,
  ocrProvider: OcrProvider,
  /** Largura da imagem que foi para o OCR (as posições das linhas estão nela) */
  ocrWidth: number,
): Promise<Reading | null> {
  const lines = first.ocr.lines;
  if (!lines?.length) return null;
  const block = recipientBlock(lines, first.parsed.recipientLines);
  if (!block) return null;

  // Das posições na imagem do OCR para a foto de trabalho
  const k = source.width / ocrWidth;
  const x = Math.max(0, Math.round(source.x + block.region.x * k));
  const y = Math.max(0, Math.round(source.y + block.region.y * k));
  const region: Region = {
    x,
    y,
    width: Math.min(canvas.width - x, Math.round(block.region.width * k)),
    height: Math.min(canvas.height - y, Math.round(block.region.height * k)),
  };
  if (region.width < 20 || region.height < 10) return null;

  const focused = await ocrProvider.recognize(enhanceForOcr(cropCanvas(canvas, region)), { singleBlock: true });
  const blockText = focused.text.trim();
  if (!blockText) return null;
  const text = [
    ...lines.slice(0, block.first).map((l) => l.text),
    blockText,
    ...lines.slice(block.last + 1).map((l) => l.text),
  ].join('\n');
  const parsed = parseLabelText(text);
  return { ocr: { ...focused, text, lines: undefined }, parsed, score: scoreLabel(parsed) };
}

/**
 * A etiqueta é só um pedaço da foto (o resto é saco plástico, mesa, mão), e o
 * recorte muda muito o resultado: numa etiqueta real, a foto inteira não rendeu
 * nem o nome, e o recorte com o código de barras da nota fiscal leu 1 de 7
 * trechos. Por isso até três leituras — recorte suavizado, recorte justo, foto
 * inteira — parando na primeira com CEP, rua e número, e fica a de melhor nota.
 * Depois, o bloco do destinatário é lido de novo, sozinho e ampliado.
 */
async function bestReading(canvas: HTMLCanvasElement, ocrProvider: OcrProvider) {
  const whole: Region = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const regions: Array<Region | null> = [paperRegionOf(canvas, 0.04), paperRegionOf(canvas, 0), null];
  const tried = new Set<string>();
  let best: (Reading & { source: Region; ocrWidth: number }) | null = null;
  for (const region of regions) {
    const key = JSON.stringify(region);
    if (tried.has(key)) continue;
    tried.add(key);
    const image = region ? cropCanvas(canvas, region) : fitForOcr(canvas);
    const ocr = await ocrProvider.recognize(enhanceForOcr(image));
    const parsed = parseLabelText(ocr.text);
    const score = scoreLabel(parsed);
    if (!best || score > best.score) best = { ocr, parsed, score, source: region ?? whole, ocrWidth: image.width };
    if (isCompleteLabel(parsed)) break;
  }
  // A foto inteira sempre entra na lista: `best` nunca fica vazio
  const first = best!;
  const focused = await focusOnRecipient(canvas, first.source, first, ocrProvider, first.ocrWidth).catch(() => null);
  // Empate fica com a leitura do bloco: mesma informação, letra lida com mais resolução
  return focused && focused.score >= first.score ? focused : first;
}

/** Abaixo disso a foto provavelmente está ruim (borrada, escura, torta). */
export const POOR_OCR_CONFIDENCE = 45;

export async function lookupCep(service: CepService, cep: string): Promise<CepLookup | null> {
  if (!isValidCepFormat(cep)) return null;
  try {
    const info = await service.lookup(cep);
    return info ? { kind: 'found', info } : { kind: 'not-found' };
  } catch (error) {
    if (error instanceof CepUnavailableError) return { kind: 'unavailable' };
    throw error;
  }
}

/**
 * Uma foto → dados para conferir. O código de barras é lido primeiro: se o
 * rastreio já existe, a encomenda existente volta na hora, sem gastar OCR.
 */
export async function readLabel(
  file: Blob,
  deps: LabelPipelineDeps,
  options: { rotation?: Rotation; onStage?: (stage: ReadingStage) => void } = {},
): Promise<LabelReading> {
  const { rotation = 0, onStage } = options;
  const bitmap = await loadImage(file);
  try {
    onStage?.('barcode');
    const canvas = drawToCanvas(bitmap, rotation);
    const codes = await deps.barcode.read(canvas).catch(() => []);
    const fromBarcode = pickTrackingCode(codes);
    if (fromBarcode) {
      const existing = await deps.findByTracking(fromBarcode.code);
      if (existing) return { kind: 'duplicate', tracking: fromBarcode, existing };
    }

    onStage?.('ocr');
    const { ocr, parsed } = await bestReading(canvas, deps.ocr);

    // Com o texto em mãos, o código de barras é conferido com o rastreio impresso
    const tracking = pickTrackingCode(codes, parsed.trackingCandidates);
    if (tracking && tracking.source === 'printed') {
      const existing = await deps.findByTracking(tracking.code);
      if (existing) return { kind: 'duplicate', tracking, existing };
    }

    onStage?.('cep');
    const lookup = await lookupCep(deps.cep, parsed.address.cep.value);
    const review = reconcileAddress(parsed.address, parsed.afterNumber, lookup);

    return {
      kind: 'review',
      tracking,
      parsed,
      review,
      ocrConfidence: ocr.confidence,
      provider: ocr.provider,
      ocrText: ocr.text,
    };
  } finally {
    bitmap.close();
  }
}
