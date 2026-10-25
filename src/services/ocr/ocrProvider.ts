import type { OcrProviderId } from '../../types/package';

/** Uma linha lida e onde ela está na imagem (em pixels). */
export interface OcrLine {
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  /** 0 a 100, como o provedor informa */
  confidence: number;
  provider: OcrProviderId;
  /** Linhas com posição, quando o provedor informa (para recortar o destinatário) */
  lines?: OcrLine[];
}

export interface RecognizeOptions {
  /**
   * A imagem é um bloco só de texto (o recorte do destinatário): o leitor não
   * procura colunas nem tabelas, e lê as linhas em ordem.
   */
  singleBlock?: boolean;
}

/**
 * Leitura de texto da etiqueta. Hoje: Tesseract.js no aparelho. Na Etapa 7
 * entra o Google Cloud Vision como reserva opcional, via Edge Function (a
 * chave nunca vem para o navegador).
 */
export interface OcrProvider {
  readonly id: OcrProviderId;
  recognize(image: HTMLCanvasElement, options?: RecognizeOptions): Promise<OcrResult>;
  /** Libera o worker/recursos */
  dispose(): Promise<void>;
}
