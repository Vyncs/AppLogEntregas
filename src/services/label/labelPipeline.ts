import type { DeliveryPackage, OcrProviderId } from '../../types/package';
import type { BarcodeReader } from '../barcode/barcodeReader';
import { pickTrackingCode, type TrackingPick } from '../barcode/tracking';
import { CepUnavailableError, type CepService } from '../cep/cepService';
import type { OcrProvider, OcrResult } from '../ocr/ocrProvider';
import { cropCanvas, drawToCanvas, enhanceForOcr, fitForOcr, loadImage, paperRegionOf, type Region, type Rotation } from '../ocr/preprocess';
import { isValidCepFormat } from './cep';
import { isCompleteLabel, parseLabelText, scoreLabel, type ParsedLabel } from './labelParser';
import { reconcileAddress, type CepLookup, type ReviewAddress } from './reconcile';

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

/**
 * A etiqueta é só um pedaço da foto (o resto é saco plástico, mesa, mão), e o
 * recorte muda muito o resultado: numa etiqueta real, a foto inteira não rendeu
 * nem o nome, e o recorte com o código de barras da nota fiscal leu 1 de 7
 * trechos. Por isso até três leituras — recorte suavizado, recorte justo, foto
 * inteira — parando na primeira com CEP, rua e número, e fica a de melhor nota.
 */
async function bestReading(canvas: HTMLCanvasElement, ocrProvider: OcrProvider) {
  const regions: Array<Region | null> = [paperRegionOf(canvas, 0.04), paperRegionOf(canvas, 0), null];
  const tried = new Set<string>();
  let best: { ocr: OcrResult; parsed: ParsedLabel; score: number } | null = null;
  for (const region of regions) {
    const key = JSON.stringify(region);
    if (tried.has(key)) continue;
    tried.add(key);
    const image = region ? cropCanvas(canvas, region) : fitForOcr(canvas);
    const ocr = await ocrProvider.recognize(enhanceForOcr(image));
    const parsed = parseLabelText(ocr.text);
    const score = scoreLabel(parsed);
    if (!best || score > best.score) best = { ocr, parsed, score };
    if (isCompleteLabel(parsed)) break;
  }
  // A foto inteira sempre entra na lista: `best` nunca fica vazio
  return best!;
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
