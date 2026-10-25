import type { Worker } from 'tesseract.js';
import type { OcrLine, OcrProvider, OcrResult, RecognizeOptions } from './ocrProvider';

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

  async recognize(image: HTMLCanvasElement, options: RecognizeOptions = {}): Promise<OcrResult> {
    const worker = await this.getWorker();
    const { PSM } = await import('tesseract.js');
    // Um worker só, uma leitura por vez (a fila de fotos é sequencial): dá para trocar o modo e voltar
    if (options.singleBlock) await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    try {
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const lines: OcrLine[] = (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.map((line) => ({ text: line.text.replace(/\n$/, ''), box: line.bbox })),
        ),
      );
      return { text: data.text, confidence: data.confidence, provider: this.id, lines };
    } finally {
      if (options.singleBlock) await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    }
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await (await worker).terminate();
  }
}
