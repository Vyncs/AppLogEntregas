import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../lib/id';
import type { LabelReading, ReadingStage } from '../services/label/labelPipeline';
import type { Rotation } from '../services/ocr/preprocess';

export type QueueItemState = 'queued' | 'processing' | 'ready' | 'error';

export interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  state: QueueItemState;
  rotation: Rotation;
  stage?: ReadingStage;
  reading?: LabelReading;
  error?: string;
}

type ReadFn = (
  file: File,
  options: { rotation: Rotation; onStage: (stage: ReadingStage) => void },
) => Promise<LabelReading>;

const messageOf = (error: unknown): string => {
  const name = (error as Error)?.name;
  if (name === 'InvalidStateError' || name === 'EncodingError') {
    return 'Não foi possível abrir essa imagem. Tente outra foto.';
  }
  if (!navigator.onLine) {
    return 'Sem internet na primeira leitura: o leitor de texto precisa baixar o idioma uma vez.';
  }
  return 'Não conseguimos ler esta foto. Tente de novo, gire a imagem ou digite os dados.';
};

/**
 * Fila de fotos: uma leitura por vez (o OCR é pesado no celular), na ordem em
 * que as fotos entraram. O usuário confere a primeira enquanto as próximas
 * esperam ou já estão sendo lidas.
 */
export function useCaptureQueue(read: ReadFn) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const busy = useRef(false);

  const patch = useCallback((id: string, changes: Partial<QueueItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  useEffect(() => {
    if (busy.current) return;
    const next = items.find((item) => item.state === 'queued');
    if (!next) return;

    busy.current = true;
    patch(next.id, { state: 'processing', stage: 'barcode', error: undefined });
    read(next.file, { rotation: next.rotation, onStage: (stage) => patch(next.id, { stage }) })
      .then((reading) => patch(next.id, { state: 'ready', reading }))
      .catch((error: unknown) => patch(next.id, { state: 'error', error: messageOf(error) }))
      .finally(() => {
        busy.current = false;
        // Reavalia a fila para começar a próxima
        setItems((list) => [...list]);
      });
  }, [items, patch, read]);

  // Libera as prévias ao sair da tela
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);

  const add = useCallback((files: File[]) => {
    const fresh = files
      .filter((file) => file.type.startsWith('image/') || file.type === '')
      .map<QueueItem>((file) => ({
        id: newId(),
        file,
        previewUrl: URL.createObjectURL(file),
        state: 'queued',
        rotation: 0,
      }));
    setItems((list) => [...list, ...fresh]);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((list) => {
      const item = list.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return list.filter((i) => i.id !== id);
    });
  }, []);

  /** Lê de novo, girando a foto 90° a cada tentativa. */
  const retryRotated = useCallback((id: string) => {
    setItems((list) =>
      list.map((item) =>
        item.id === id
          ? {
              ...item,
              state: 'queued',
              reading: undefined,
              error: undefined,
              rotation: (((item.rotation + 90) % 360) as Rotation),
            }
          : item,
      ),
    );
  }, []);

  return {
    items,
    current: items[0] ?? null,
    waiting: items.filter((item) => item.state === 'queued' || item.state === 'processing').length,
    add,
    remove,
    retryRotated,
  };
}
