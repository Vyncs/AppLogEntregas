import type { Address } from '../../types/package';
import type { CepService } from '../cep/cepService';
import { findCeps } from '../label/cep';
import { decideCandidates } from './candidates';
import type { GeocodeCandidate, Geocoder } from './types';

/**
 * Endereço digitado ou colado (ex.: copiado do Google Maps:
 * "R. Fulano, 80 - Bairro, Cidade - SP, 11400-000"). A busca livre do
 * OpenStreetMap falha com abreviação, bairro e CEP no texto; então, com CEP,
 * o ViaCEP dá rua e cidade oficiais e a busca é estruturada (como nas
 * encomendas). Sem CEP, vai um texto simplificado.
 */

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bR\.\s*/gi, 'Rua '],
  [/\bAv\.?\s+/gi, 'Avenida '],
  [/\bAl\.\s*/gi, 'Alameda '],
  [/\b(?:Trav|Tv)\.\s*/gi, 'Travessa '],
  [/\bEstr\.\s*/gi, 'Estrada '],
  [/\bRod\.\s*/gi, 'Rodovia '],
  [/\bP(?:ç|c)a\.?\s+/gi, 'Praça '],
];

const withoutCep = (text: string) => text.replace(/\b\d{5}\s?[-.]?\s?\d{3}\b/g, ' ');

/** Número do imóvel: o primeiro depois de vírgula; senão, o primeiro número solto. */
export function numberFromText(text: string): string {
  const clean = withoutCep(text);
  return (
    /,\s*(\d{1,6}[A-Za-z]?)(?=$|[\s,\-])/.exec(clean)?.[1] ??
    /(?:^|[\s,])(\d{1,6}[A-Za-z]?)(?=$|[\s,\-])/.exec(clean)?.[1] ??
    ''
  );
}

/** "R. Fulano, 80 - Bairro, Cidade - SP, CEP" → "Rua Fulano, 80, Cidade". */
export function simplifyTypedAddress(text: string): string {
  let clean = withoutCep(text);
  for (const [pattern, full] of ABBREVIATIONS) clean = clean.replace(pattern, full);
  return clean
    .split(',')
    .map((part) => part.split(/\s+-\s+/)[0].trim())
    .filter((part) => part && !/^[A-Z]{2}$/.test(part))
    .join(', ');
}

export interface TypedAddressResult {
  candidates: GeocodeCandidate[];
  /** O endereço entendido pelo CEP (para centralizar o mapa na cidade, se não achar) */
  address: Address | null;
}

export async function locateTypedAddress(
  text: string,
  deps: { cep: CepService; geocoder: Geocoder },
  signal?: AbortSignal,
): Promise<TypedAddressResult> {
  let address: Address | null = null;
  const cep = findCeps(text).at(-1)?.cep;
  if (cep) {
    try {
      const info = await deps.cep.lookup(cep, signal);
      if (info) {
        address = {
          cep: info.cep,
          street: info.street || simplifyTypedAddress(text).split(',')[0],
          number: numberFromText(text),
          complement: '',
          neighborhood: info.neighborhood,
          city: info.city,
          state: info.state,
        };
      }
    } catch {
      // Sem ViaCEP agora: segue pela busca de texto
    }
  }
  if (address) {
    const outcome = decideCandidates(address, await deps.geocoder.geocode(address, signal));
    if (outcome.kind === 'found') return { candidates: [outcome.best, ...outcome.alternatives], address };
  }
  const query = simplifyTypedAddress(text);
  return { candidates: query ? await deps.geocoder.search(query, signal) : [], address };
}
