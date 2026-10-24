import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import type { BarcodeReader, DetectedCode } from './barcodeReader';

/** Alternativa quando a API nativa não existe (iPhone, Firefox, desktop). */
export class ZxingBarcodeReader implements BarcodeReader {
  private readonly reader: BrowserMultiFormatReader;

  constructor() {
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.TRY_HARDER, true],
      [
        DecodeHintType.POSSIBLE_FORMATS,
        [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.ITF],
      ],
    ]);
    this.reader = new BrowserMultiFormatReader(hints);
  }

  async read(source: HTMLCanvasElement): Promise<DetectedCode[]> {
    try {
      const result = this.reader.decodeFromCanvas(source);
      return [{ value: result.getText(), format: BarcodeFormat[result.getBarcodeFormat()] }];
    } catch {
      // NotFoundException: nenhum código na imagem
      return [];
    }
  }
}
