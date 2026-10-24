import type { Worker } from 'tesseract.js';
import type { OcrProvider, OcrResult } from './ocrProvider';

/**
 * Tesseract.js em português, rodando no próprio navegador. O worker é criado
 * uma vez e reaproveitado entre as fotos — criar a cada leitura custa segundos
 * (carregar o motor e o idioma) e o celular sente.
 *
 * Na primeira leitura ele baixa o idioma (~15 MB, uma vez; depois fica em cache
 * no navegador).
 */
export class TesseractOcrProvider implements OcrProvider {
  readonly id = 'tesseract' as const;
  private worker: Promise<Worker> | null = null;
  private progressListener: ((progress: number) => void) | null = null;

  /** Progresso (0 a 1) da leitura em andamento. */
  onProgress(listener: ((progress: number) => void) | null): void {
    this.progressListener = listener;
  }

  private getWorker(): Promise<Worker> {
    this.worker ??= (async () => {
      // Biblioteca carregada só na primeira leitura (fica fora da tela inicial)
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const worker = await createWorker('por', OEM.LSTM_ONLY, {
        logger: (message) => {
          if (message.status === 'recognizing text') this.progressListener?.(message.progress);
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        // Foto de canvas não traz DPI; sem isso ele supõe 70 e lê pior
        user_defined_dpi: '300',
      });
      return worker;
    })().catch((error: unknown) => {
      // Falhou (ex.: sem internet na primeira vez): tenta de novo na próxima foto
      this.worker = null;
      throw error;
    });
    return this.worker;
  }

  async recognize(image: HTMLCanvasElement): Promise<OcrResult> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(image);
    return { text: data.text, confidence: data.confidence, provider: this.id };
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await (await worker).terminate();
  }
}
