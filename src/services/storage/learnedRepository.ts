import type { LearnedPlace, LearnedStore } from '../geo/learnedPlaces';
import { kvGet, kvSet } from './db';

const KEY = 'learned-places';

/**
 * Locais aprendidos, guardados neste aparelho (junto com as configurações).
 * Ficam de um dia para o outro: "Apagar tudo" apaga as encomendas, não o que
 * o app aprendeu sobre os endereços.
 */
export class KvLearnedStore implements LearnedStore {
  private all: Promise<Record<string, LearnedPlace>> | null = null;

  private load() {
    this.all ??= kvGet<Record<string, LearnedPlace>>(KEY).then((v) => v ?? {});
    return this.all;
  }

  async get(key: string): Promise<LearnedPlace | undefined> {
    return (await this.load())[key];
  }

  async set(key: string, place: LearnedPlace): Promise<void> {
    const next = { ...(await this.load()), [key]: place };
    this.all = Promise.resolve(next);
    await kvSet(KEY, next);
  }
}

/** Em memória, para os testes. */
export class MemoryLearnedStore implements LearnedStore {
  readonly places = new Map<string, LearnedPlace>();
  async get(key: string) {
    return this.places.get(key);
  }
  async set(key: string, place: LearnedPlace) {
    this.places.set(key, place);
  }
}
