import { normalizeCep } from '../label/cep';

export interface CepInfo {
  /** 8 dígitos */
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  /** CEP geral da cidade: o ViaCEP não traz logradouro nem bairro */
  generic: boolean;
}

/** Sem internet ou serviço fora do ar — diferente de "CEP não existe". */
export class CepUnavailableError extends Error {
  constructor(message = 'Consulta de CEP indisponível no momento.') {
    super(message);
    this.name = 'CepUnavailableError';
  }
}

export interface CepService {
  /** `null` quando o CEP não existe. Lança `CepUnavailableError` sem conexão. */
  lookup(cep: string, signal?: AbortSignal): Promise<CepInfo | null>;
}

interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

/**
 * ViaCEP (https://viacep.com.br) — gratuito e sem chave. Resultados ficam em
 * memória durante a sessão: a mesma rua aparece em várias etiquetas do dia.
 */
export class ViaCepService implements CepService {
  private readonly cache = new Map<string, CepInfo | null>();

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  async lookup(cep: string, signal?: AbortSignal): Promise<CepInfo | null> {
    const digits = normalizeCep(cep);
    if (!digits) return null;
    if (this.cache.has(digits)) return this.cache.get(digits) ?? null;

    let response: Response;
    try {
      response = await this.fetchImpl(`https://viacep.com.br/ws/${digits}/json/`, { signal });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      throw new CepUnavailableError();
    }
    // 400 = formato inválido; o resto (5xx, limite) é indisponibilidade
    if (response.status === 400) return null;
    if (!response.ok) throw new CepUnavailableError();

    const data = (await response.json()) as ViaCepResponse;
    const info: CepInfo | null =
      data.erro === true || data.erro === 'true'
        ? null
        : {
            cep: digits,
            street: data.logradouro?.trim() ?? '',
            neighborhood: data.bairro?.trim() ?? '',
            city: data.localidade?.trim() ?? '',
            state: data.uf?.trim() ?? '',
            generic: !data.logradouro?.trim(),
          };
    this.cache.set(digits, info);
    return info;
  }
}
