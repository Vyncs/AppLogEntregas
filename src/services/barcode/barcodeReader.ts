/**
 * Leitura do código de barras / QR da etiqueta. Nas etiquetas atuais eles só
 * trazem o código de rastreio — nada de endereço —, então servem para
 * identificar o pacote e evitar cadastro duplicado.
 */

export interface DetectedCode {
  value: string;
  format: string;
}

export interface BarcodeReader {
  read(source: HTMLCanvasElement): Promise<DetectedCode[]>;
}

// API nativa (Chrome/Android). Não está nos tipos padrão do TypeScript.
interface NativeBarcode {
  rawValue: string;
  format: string;
}
interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<NativeBarcode[]>;
}
interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}
const nativeCtor = (): NativeBarcodeDetectorCtor | undefined =>
  (globalThis as { BarcodeDetector?: NativeBarcodeDetectorCtor }).BarcodeDetector;

const WANTED = ['code_128', 'code_39', 'code_93', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'pdf417'];

export class NativeBarcodeReader implements BarcodeReader {
  private detector: Promise<NativeBarcodeDetector | null> | null = null;

  static async isSupported(): Promise<boolean> {
    const Ctor = nativeCtor();
    if (!Ctor) return false;
    try {
      return (await Ctor.getSupportedFormats()).length > 0;
    } catch {
      return false;
    }
  }

  private getDetector(): Promise<NativeBarcodeDetector | null> {
    this.detector ??= (async () => {
      const Ctor = nativeCtor();
      if (!Ctor) return null;
      const supported = await Ctor.getSupportedFormats();
      const formats = WANTED.filter((f) => supported.includes(f));
      return new Ctor(formats.length ? { formats } : undefined);
    })();
    return this.detector;
  }

  async read(source: HTMLCanvasElement): Promise<DetectedCode[]> {
    const detector = await this.getDetector();
    if (!detector) return [];
    const codes = await detector.detect(source);
    return codes.map((c) => ({ value: c.rawValue, format: c.format }));
  }
}

/** Nativa primeiro; se ela não achar nada (ou não existir), tenta o ZXing. */
export class FallbackBarcodeReader implements BarcodeReader {
  constructor(private readonly readers: BarcodeReader[]) {}

  async read(source: HTMLCanvasElement): Promise<DetectedCode[]> {
    for (const reader of this.readers) {
      try {
        const codes = await reader.read(source);
        if (codes.length > 0) return codes;
      } catch {
        // tenta o próximo leitor
      }
    }
    return [];
  }
}

export async function createBarcodeReader(): Promise<BarcodeReader> {
  const readers: BarcodeReader[] = [];
  if (await NativeBarcodeReader.isSupported()) readers.push(new NativeBarcodeReader());
  // ZXing é grande: só é baixado quando a câmera é usada pela primeira vez
  const { ZxingBarcodeReader } = await import('./zxingReader');
  readers.push(new ZxingBarcodeReader());
  return new FallbackBarcodeReader(readers);
}
