import type { Address, AddressField } from '../../types/package';
import type { CepInfo } from '../cep/cepService';
import { formatCep, isValidCepFormat } from './cep';
import type { Confidence, ParsedField } from './labelParser';
import { normalizeText, similarity, toUf } from './text';

/**
 * Junta o que o OCR leu com o que o ViaCEP sabe do CEP.
 *
 * - CEP coerente com o texto: logradouro, bairro, cidade e UF vêm do ViaCEP
 *   (que corrige os erros do OCR) com confiança alta.
 * - CEP geral da cidade (sem logradouro): o logradouro lido fica, para revisão.
 * - CEP inexistente ou que não bate com o texto: vira conflito para o usuário
 *   decidir — nunca uma troca silenciosa.
 * Número e complemento o CEP não resolve: continuam pedindo conferência.
 */

export type CepStatus =
  | 'ok'
  | 'generic'
  | 'not-found'
  | 'invalid'
  | 'missing'
  | 'unavailable';

export interface Conflict {
  field: AddressField;
  message: string;
  /** Valor sugerido pela outra fonte, aplicável com um toque */
  suggestion?: string;
}

export interface ReviewAddress {
  fields: Record<AddressField, ParsedField>;
  conflicts: Conflict[];
  cepStatus: CepStatus;
}

export type CepLookup =
  | { kind: 'found'; info: CepInfo }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

const STREET_TYPE_PREFIX =
  /^(rua|r|avenida|av|travessa|tv|alameda|al|estrada|estr|rodovia|rod|praca|pca|largo|viela|ladeira|beco|servidao|passagem|via)\b\.?\s*/;

/** "R. das Flores" e "Rua das Flores" comparam igual. */
const streetCore = (street: string) => normalizeText(street).replace(STREET_TYPE_PREFIX, '');

const STREET_MATCH = 0.6;
const CITY_MATCH = 0.75;
const NEIGHBORHOOD_MATCH = 0.85;

export function reconcileAddress(
  parsed: Record<AddressField, ParsedField>,
  afterNumber: string,
  lookup: CepLookup | null,
): ReviewAddress {
  const fields = { ...parsed };
  const conflicts: Conflict[] = [];
  const cep = parsed.cep.value;

  if (!cep) return { fields, conflicts, cepStatus: 'missing' };
  if (!isValidCepFormat(cep)) {
    fields.cep = { value: cep, confidence: 'low' };
    conflicts.push({ field: 'cep', message: 'CEP com formato inválido.' });
    return { fields, conflicts, cepStatus: 'invalid' };
  }
  if (!lookup || lookup.kind === 'unavailable') {
    return { fields, conflicts, cepStatus: 'unavailable' };
  }
  if (lookup.kind === 'not-found') {
    fields.cep = { value: formatCep(cep), confidence: 'low' };
    conflicts.push({ field: 'cep', message: 'Esse CEP não existe. Confira os números.' });
    return { fields, conflicts, cepStatus: 'not-found' };
  }

  const { info } = lookup;
  const high = (value: string): ParsedField => ({ value, confidence: 'high' });

  // Cidade: o que veio depois do número pode trazer complemento antes dela
  // ("Bloco B Barueri"). As últimas palavras são comparadas com a cidade do
  // CEP (tolerando erro de OCR); as anteriores vão para o complemento.
  const afterWords = afterNumber.split(/\s+/).filter(Boolean);
  const cityWords = info.city.split(/\s+/).filter(Boolean).length;
  const tail = afterWords.slice(-cityWords).join(' ');
  if (cityWords > 0 && afterWords.length >= cityWords && similarity(tail, info.city) >= CITY_MATCH) {
    const leftover = afterWords.slice(0, -cityWords).join(' ');
    fields.city = high(info.city);
    if (leftover) {
      fields.complement = {
        value: [parsed.complement.value, leftover].filter(Boolean).join(', '),
        confidence: 'medium',
      };
    }
  } else if (!parsed.city.value || similarity(parsed.city.value, info.city) >= CITY_MATCH) {
    fields.city = high(info.city);
  } else {
    fields.city = { value: parsed.city.value, confidence: 'low' };
    conflicts.push({
      field: 'city',
      message: `Pelo CEP, a cidade é ${info.city}.`,
      suggestion: info.city,
    });
  }

  if (!parsed.state.value || parsed.state.value === info.state) {
    fields.state = high(info.state);
  } else {
    fields.state = { value: parsed.state.value, confidence: 'low' };
    conflicts.push({ field: 'state', message: `Pelo CEP, o estado é ${info.state}.`, suggestion: info.state });
  }

  fields.cep = { value: formatCep(info.cep), confidence: maxConfidence(parsed.cep.confidence, 'medium') };

  if (info.generic) {
    // CEP geral: o ViaCEP não sabe a rua — fica a lida, para conferir
    if (parsed.street.value) fields.street = { value: parsed.street.value, confidence: 'medium' };
    return { fields, conflicts, cepStatus: 'generic' };
  }

  fields.neighborhood = info.neighborhood ? high(info.neighborhood) : parsed.neighborhood;

  // A etiqueta costuma imprimir o bairro junto do complemento, antes da rua
  // ("casa 2, Vila Exemplo Rua …"), e o OCR às vezes deixa cidade e estado ali
  // ("ponto comercial, Guarujá, São Paulo"): o que é bairro, cidade ou estado
  // do CEP sai do complemento
  if (fields.complement.value) {
    const parts = fields.complement.value.split(',').map((p) => p.trim()).filter(Boolean);
    const kept = parts.filter(
      (part) =>
        !(info.neighborhood && similarity(part, info.neighborhood) >= NEIGHBORHOOD_MATCH) &&
        !(info.city && similarity(part, info.city) >= NEIGHBORHOOD_MATCH) &&
        toUf(part) !== info.state,
    );
    if (kept.length < parts.length) {
      fields.complement = { value: kept.join(', '), confidence: fields.complement.confidence };
    }
  }

  const read = parsed.street.value;
  if (!read || similarity(streetCore(read), streetCore(info.street)) >= STREET_MATCH) {
    fields.street = high(info.street);
  } else {
    fields.street = { value: read, confidence: 'low' };
    conflicts.push({
      field: 'street',
      message: `Pelo CEP, o logradouro é ${info.street}. O CEP ou o endereço pode estar errado.`,
      suggestion: info.street,
    });
  }

  return { fields, conflicts, cepStatus: 'ok' };
}

const ORDER: Confidence[] = ['low', 'medium', 'high'];
const maxConfidence = (a: Confidence, b: Confidence): Confidence =>
  ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;

/** Valores puros para o formulário. */
export const toAddress = (fields: Record<AddressField, ParsedField>): Address => ({
  cep: fields.cep.value,
  street: fields.street.value,
  number: fields.number.value,
  complement: fields.complement.value,
  neighborhood: fields.neighborhood.value,
  city: fields.city.value,
  state: fields.state.value,
});
