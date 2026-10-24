import type { OcrProviderId } from '../../types/package';

export interface OcrResult {
  text: string;
  /** 0 a 100, como o provedor informa */
  confidence: number;
  provider: OcrProviderId;
}

/**
 * Leitura de texto da etiqueta. Hoje: Tesseract.js no aparelho. Na Etapa 7
 * entra o Google Cloud Vision como reserva opcional, via Edge Function (a
 * chave nunca vem para o navegador).
 */
export interface OcrProvider {
  readonly id: OcrProviderId;
  recognize(image: HTMLCanvasElement): Promise<OcrResult>;
  /** Libera o worker/recursos */
  dispose(): Promise<void>;
}
