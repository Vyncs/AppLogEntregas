import type { AddressField } from '../../types/package';
import { findCeps } from './cep';
import { editDistance, normalizeText, toUf } from './text';

/**
 * Interpreta o texto lido (OCR) de uma etiqueta e devolve os campos do
 * destinatário, cada um com a confiança da leitura.
 *
 * Feito para as etiquetas iMile do TikTok Shop, mas tolerante a outros modelos:
 * - o bloco do destinatário vem depois do ícone "TO" (nome na primeira linha);
 * - o complemento pode vir ANTES do logradouro ("Apto 14, Cond. X Rua Y 539 …");
 * - as linhas quebram no meio das palavras;
 * - o CEP aparece no fim do endereço e em fonte grande junto ao logo;
 * - o bloco "Remetente" tem outro endereço e outro CEP, que nunca podem ser
 *   confundidos com os do destinatário;
 * - códigos de triagem ("1-SP2-SB58-114", "SVT", "D2D") não são endereço.
 *
 * Nada é inventado: campo não encontrado volta vazio, com confiança baixa.
 */

export type Confidence = 'high' | 'medium' | 'low';

export interface ParsedField {
  value: string;
  confidence: Confidence;
}

export interface ParsedLabel {
  recipientName: ParsedField;
  address: Record<AddressField, ParsedField>;
  /**
   * Texto que veio entre o número e o estado ("Barueri", ou "Bloco B Barueri").
   * O ViaCEP decide o que é cidade e o que sobra vira complemento.
   */
  afterNumber: string;
  ceps: {
    /** CEP em fonte grande, ao lado do logo — fonte prioritária */
    large: string | null;
    /** CEP no fim do endereço do destinatário */
    inAddress: string | null;
  };
  /** Sequências impressas que parecem código de rastreio (para conferir com o código de barras). */
  trackingCandidates: string[];
  warnings: string[];
}

// ── Limpeza das linhas ──────────────────────────────────────────────────────

/** Códigos de triagem da transportadora, que não fazem parte do endereço. */
const SORTING_CODE = /\b\d{1,2}-[A-Z]{2,3}\d{0,2}-[A-Z]{1,3}\d{1,3}-\d{1,4}\b/gi;
const SORTING_TOKENS = new Set(['SVT', 'D2D', 'COD', 'STD', 'EXP']);

/**
 * Marcador do bloco do destinatário: o ícone "TO". Impresso em branco num
 * círculo preto, o OCR raramente devolve "TO": em etiquetas reais saiu "Õ",
 * "ÕÔ", "fo)", "o", "IO"… Só conta no começo da linha, sozinho ou antes do nome.
 */
const TO_MARKER =
  /^[\s\-–—:.([@°º]*(?:[TtIil1|fF]?\s?[OoÕÔÓÒÖõôóòö0Q][)\]]?|[OÕÔÓÒÖ]{2}|[@°º])(?=[\s:.\-–—]|$)[\s:.\-–—]*/;
/**
 * Rótulo "Remetente", tolerando erro de OCR ("Remetenle", "Rernetente"): uma
 * palavra a até 2 letras de distância.
 */
const isSenderLabel = (line: string) =>
  normalizeText(line)
    .split(/[^a-z]+/)
    .some((word) => word.length >= 7 && editDistance(word, 'remetente') <= 2);
const LOGO_WORDS = /\b(tiktok|tik tok|shop|imile)\b/gi;
const NEXT_TO_LOGO = /tik\s?tok|\bshop\b/i;

/**
 * O marcador lido como número ("10") só vale se o resto da linha for um nome:
 * "10 Guarujá, SP, 11400-000" é endereço quebrado, não o ícone.
 */
function hasMarker(line: string): boolean {
  const match = TO_MARKER.exec(line);
  if (!match) return false;
  const rest = line.slice(match[0].length);
  return !/\d/.test(match[0]) || /^[A-Za-zÀ-ÿ'.\- ]*$/.test(rest);
}

const stripMarker = (line: string) => (hasMarker(line) ? line.replace(TO_MARKER, '').trim() : line.trim());

/** Letras que o OCR troca por número dentro de um CEP ("D80" → "080"). */
const LOOKALIKE: Record<string, string> = {
  O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', S: '5', B: '8',
};
const toDigits = (value: string) => value.replace(/[OoDQIlSB]/g, (c) => LOOKALIKE[c]);

/** "12345-D80" → "12345-080". Só mexe em sequência 5+3 que já é quase toda número. */
function fixCepLookalikes(line: string): string {
  return line.replace(
    /(^|[^\wÀ-ÿ])([0-9OoDQIlSB]{5})(\s?[-.]?\s?)([0-9OoDQIlSB]{3})(?=$|[^\wÀ-ÿ])/g,
    (match, pre: string, first: string, sep: string, last: string) =>
      (first + last).replace(/\D/g, '').length >= 6 ? pre + toDigits(first) + sep + toDigits(last) : match,
  );
}

function cleanLine(line: string): string {
  return fixCepLookalikes(
    line
      .replace(SORTING_CODE, ' ')
      .replace(/[|¦«»©®_~^`"“”]+/g, ' ')
      .split(/\s+/)
      .filter((token) => !SORTING_TOKENS.has(token.toUpperCase()))
      .join(' ')
      .trim(),
  );
}

/**
 * CEP partido entre duas linhas ("…, São Paulo, 12345" + "080"): a etiqueta
 * quebra onde a linha acaba, inclusive no meio do CEP. Junta numa linha só.
 */
export function mergeSplitCeps(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const tail = /(?:^|[^\d-])(\d[\d-]{0,8})$/.exec(line);
    const head = next === undefined ? null : /^([0-9OoDQIlSB-]{1,9})(?=$|[\s,.;])/.exec(next);
    if (tail && head && /\d/.test(head[1]) && !/^\d{5}-?\d{3}$/.test(tail[1])) {
      const cep = /^(\d{5})-?(\d{3})$/.exec(tail[1] + toDigits(head[1]));
      if (cep) {
        out.push(`${line.slice(0, line.length - tail[1].length)}${cep[1]}-${cep[2]}`);
        const rest = next.slice(head[1].length).trim();
        if (rest) out.push(rest);
        i += 1;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/** Linha que não pode ser o nome nem o endereço: logo, rastreio, sobra de triagem. */
function isNoiseLine(line: string): boolean {
  const withoutLogo = line.replace(LOGO_WORDS, '').replace(/[^A-Za-zÀ-ÿ0-9]/g, '');
  return withoutLogo.length < 3 || /\d{10,}/.test(line.replace(/\s/g, ''));
}

/** Parece nome de pessoa: só letras, ao menos duas palavras. */
const looksLikeName = (line: string) => /^[A-Za-zÀ-ÿ'.\- ]+$/.test(line) && line.trim().split(/\s+/).length >= 2;

/**
 * O CEP em fonte grande: na linha do logo "TikTok Shop" — mesmo que o OCR
 * misture a coluna da direita ("PICK UP") na mesma linha — ou sozinho na linha.
 */
function largeCepOf(line: string): string | null {
  const ceps = findCeps(line);
  if (ceps.length !== 1) return null;
  if (NEXT_TO_LOGO.test(line)) return ceps[0].cep;
  const rest = (line.slice(0, ceps[0].index) + line.slice(ceps[0].index + ceps[0].length))
    .replace(LOGO_WORDS, '')
    .replace(/[^A-Za-z0-9]/g, '');
  return rest.length <= 2 ? ceps[0].cep : null;
}

// ── Junção das linhas quebradas ─────────────────────────────────────────────

/**
 * Palavras de endereço que costumam quebrar entre linhas. Se o fim de uma linha
 * mais o começo da seguinte formam uma delas, é a mesma palavra.
 */
const ADDRESS_WORDS = [
  'apartamento', 'avenida', 'alameda', 'travessa', 'estrada', 'rodovia', 'condominio',
  'residencial', 'edificio', 'jardim', 'parque', 'conjunto', 'bloco', 'andar', 'casa',
  'fundos', 'frente', 'sobrado', 'loja', 'sala', 'torre', 'quadra', 'lote', 'vila',
  'praca', 'largo', 'viela', 'ladeira', 'passagem', 'servidao', 'chacara', 'sitio',
  'fazenda', 'nucleo', 'setor', 'centro', 'portaria', 'entrada', 'unidade',
];

function isSplitWord(left: string, right: string): boolean {
  const tail = /([A-Za-zÀ-ÿ]+)$/.exec(left)?.[1];
  const head = /^([A-Za-zÀ-ÿ]+)/.exec(right)?.[1];
  if (!tail || !head) return false;
  // Continuação em minúscula depois de uma letra: palavra cortada ("Condomí" + "nio")
  if (/^[a-zà-ÿ]/.test(head)) return true;
  // Em caixa alta não dá para saber pela letra: só junta se formar palavra conhecida
  const joined = normalizeText(tail + head);
  return (
    !ADDRESS_WORDS.includes(normalizeText(tail)) &&
    ADDRESS_WORDS.some((word) => joined === word || (joined.length >= 5 && word.startsWith(joined)))
  );
}

export function joinLines(lines: string[]): string {
  return lines.reduce((acc, line) => {
    if (!acc) return line;
    if (/[A-Za-zÀ-ÿ]-$/.test(acc)) return acc.slice(0, -1) + line;
    return isSplitWord(acc, line) ? acc + line : `${acc} ${line}`;
  }, '');
}

// ── Endereço ────────────────────────────────────────────────────────────────

const STREET_TYPE =
  /(?:^|[\s,])(rua|r\.|avenida|av\.?|travessa|tv\.|alameda|al\.|estrada|estr\.|rodovia|rod\.|pra[cç]a|p[cç]a\.|largo|viela|ladeira|beco|servid[aã]o|passagem|via)(?=[\s.])/gi;

/** Número do imóvel: "539", "539A", "nº 539", "S/N". */
const HOUSE_NUMBER = /(?:^|[\s,])(?:n[º°o]\.?\s*)?(\d{1,6}[A-Za-z]?|s\/?n)(?=$|[\s,])/gi;

/** Palavras que precedem um número que NÃO é o do imóvel ("Apto 14", "Bloco 2"). */
const COMPLEMENT_PREFIX =
  /(?:^|[\s,])(?:apto|apt|ap|apartamento|bloco|bl|casa|cs|sala|sl|lote|lt|quadra|qd|andar|conjunto|cj|torre|unidade|un|box|loja|lj)\.?$/i;

interface AddressParts {
  street: string;
  number: string;
  complement: string;
  afterNumber: string;
  city: string;
  state: string;
  cep: string | null;
  streetFound: boolean;
}

const trimSeparators = (value: string) => value.replace(/^[\s,;.\-]+|[\s,;\-]+$/g, '').trim();

interface NumberMatch {
  value: string;
  start: number;
  end: number;
}

function numbersIn(text: string, from = 0): NumberMatch[] {
  const found: NumberMatch[] = [];
  for (const m of text.matchAll(HOUSE_NUMBER)) {
    // Começo do token, já com o "nº" quando houver — o logradouro termina antes dele
    const start = (m.index ?? 0) + (/^[\s,]*/.exec(m[0])?.[0].length ?? 0);
    if (start < from) continue;
    // "Apto 14", "Bloco 2": o número pertence ao complemento
    if (COMPLEMENT_PREFIX.test(text.slice(0, start).trimEnd())) continue;
    const value = m[1].toUpperCase();
    found.push({ value: value === 'SN' ? 'S/N' : value, start, end: (m.index ?? 0) + m[0].length });
  }
  return found;
}

export function parseAddress(text: string): AddressParts {
  const ceps = findCeps(text);
  const last = ceps.at(-1);
  const cep = last?.cep ?? null;
  const body = trimSeparators(last ? text.slice(0, last.index) : text);

  // Fim do endereço: "… Cidade, Estado" — o estado é o último trecho entre vírgulas
  const parts = body.split(',').map((p) => p.trim()).filter(Boolean);
  let state = '';
  if (parts.length > 1 && toUf(parts.at(-1) ?? '')) {
    state = toUf(parts.pop() ?? '') ?? '';
  }

  const addressText = parts.join(', ');
  let street = '';
  let number = '';
  let complement = '';
  let afterNumber = '';
  let streetFound = false;

  // O logradouro começa no último tipo de via seguido de um número
  const types = [...addressText.matchAll(STREET_TYPE)].map((m) => (m.index ?? 0) + m[0].indexOf(m[1]));
  for (const start of types.reverse()) {
    const num = numbersIn(addressText, start + 2)[0];
    if (!num) continue;
    street = trimSeparators(addressText.slice(start, num.start));
    number = num.value;
    complement = trimSeparators(addressText.slice(0, start));
    afterNumber = trimSeparators(addressText.slice(num.end));
    streetFound = true;
    break;
  }

  if (!streetFound) {
    // Sem tipo de via: o número do imóvel é o último número que não é de complemento
    const num = numbersIn(addressText).at(-1);
    if (num) {
      const before = addressText.slice(0, num.start);
      const comma = before.lastIndexOf(',');
      street = trimSeparators(before.slice(comma + 1));
      number = num.value;
      complement = trimSeparators(comma >= 0 ? before.slice(0, comma) : '');
      afterNumber = trimSeparators(addressText.slice(num.end));
    } else {
      street = trimSeparators(addressText);
    }
  }

  // A cidade é o que veio depois do número no trecho final ("539 Barueri").
  // Se veio separada por vírgula ("539, Barueri"), é o último trecho.
  const afterParts = afterNumber.split(',').map((p) => p.trim()).filter(Boolean);
  const city = afterParts.at(-1) ?? '';
  if (afterParts.length > 1) {
    complement = [complement, ...afterParts.slice(0, -1)].filter(Boolean).join(', ');
  }
  // Só o último trecho segue para o ViaCEP separar cidade de complemento
  afterNumber = afterParts.at(-1) ?? '';

  return { street, number, complement, afterNumber, city, state, cep, streetFound };
}

// ── Etiqueta inteira ────────────────────────────────────────────────────────

const MAX_ADDRESS_LINES = 6;

/** Linha de endereço mesmo sem CEP: tipo de via, nome e um número. */
const STREET_WITH_NUMBER =
  /(?:^|[\s,])(?:rua|r\.|avenida|av\.?|travessa|alameda|estrada|rodovia|pra[cç]a|largo|viela|ladeira)\s+\S.*\d/i;

function findSenderLines(lines: string[]): Set<number> {
  const sender = new Set<number>();
  lines.forEach((line, i) => {
    if (!isSenderLabel(line)) return;
    // Do rótulo até a linha do CEP do remetente (inclusive)
    for (let j = i; j < Math.min(lines.length, i + MAX_ADDRESS_LINES + 1); j++) {
      sender.add(j);
      if (findCeps(lines[j]).length > 0) break;
    }
  });
  return sender;
}

const field = (value: string, confidence: Confidence): ParsedField => ({
  value: value.trim(),
  confidence: value.trim() ? confidence : 'low',
});

export function parseLabelText(raw: string): ParsedLabel {
  const warnings: string[] = [];
  const lines = mergeSplitCeps(
    raw
      .split(/\r?\n/)
      .map(cleanLine)
      .filter((line) => line.length > 0),
  );

  const sender = findSenderLines(lines);
  const usable = (i: number) => !sender.has(i);

  const isAddressCepLine = (i: number) =>
    usable(i) && findCeps(lines[i]).length > 0 && largeCepOf(lines[i]) === null;

  // Começo do bloco do destinatário
  let name = '';
  let nameConfidence: Confidence = 'medium';
  let addressStart = -1;
  const toIndex = lines.findIndex((line, i) => usable(i) && hasMarker(line));

  if (toIndex >= 0) {
    const rest = stripMarker(lines[toIndex]);
    if (rest) {
      name = rest;
      addressStart = toIndex + 1;
    } else {
      name = lines[toIndex + 1] ?? '';
      addressStart = toIndex + 2;
    }
  } else {
    // Sem o "TO" (o OCR costuma perder o ícone redondo): sobe a partir da linha
    // do CEP do endereço — ou, sem CEP, da linha com "Rua … número" — até o
    // logo, o rastreio ou o remetente. A primeira linha do bloco é o nome.
    // Preferência: a linha cujo CEP é o mesmo do CEP grande do logo — é o do
    // destinatário, nunca o do remetente
    const cepLines = lines.map((_, i) => i).filter(isAddressCepLine);
    const logoCep = lines.map((line, i) => (usable(i) ? largeCepOf(line) : null)).find(Boolean);
    let anchor =
      cepLines.find((i) => findCeps(lines[i]).some((c) => c.cep === logoCep)) ?? cepLines[0] ?? -1;
    if (anchor < 0) anchor = lines.findIndex((line, i) => usable(i) && STREET_WITH_NUMBER.test(line));
    if (anchor >= 0) {
      let first = anchor;
      while (
        first > 0 &&
        anchor - first < MAX_ADDRESS_LINES - 1 &&
        usable(first - 1) &&
        // Linha com CEP é o fim de outro endereço (o do remetente): o bloco começa depois
        findCeps(lines[first - 1]).length === 0 &&
        !isNoiseLine(lines[first - 1])
      ) {
        first -= 1;
      }
      if (first < anchor) {
        name = stripMarker(lines[first]);
        addressStart = first + 1;
      } else {
        addressStart = anchor;
      }
      if (looksLikeName(name)) {
        nameConfidence = 'medium';
      } else {
        nameConfidence = 'low';
        warnings.push('Confira o nome do destinatário.');
      }
    }
  }

  // Linhas do endereço: até a linha com o CEP (inclusive), sem invadir o remetente
  const addressIndexes: number[] = [];
  if (addressStart >= 0) {
    for (let i = addressStart; i < lines.length && addressIndexes.length < MAX_ADDRESS_LINES; i++) {
      if (!usable(i) || isSenderLabel(lines[i])) break;
      if (largeCepOf(lines[i]) !== null) {
        // CEP sozinho na linha: é o fim do endereço quando a linha anterior
        // termina como "… Estado," — senão é o CEP em destaque, fora do bloco
        const previous = lines[addressIndexes.at(-1) ?? -1] ?? '';
        if (/,\s*$/.test(previous) || toUf(previous.split(',').filter((p) => p.trim()).at(-1) ?? '')) {
          addressIndexes.push(i);
          break;
        }
        continue;
      }
      addressIndexes.push(i);
      if (findCeps(lines[i]).length > 0) break;
    }
  }

  const parsed = parseAddress(joinLines(addressIndexes.map((i) => lines[i])));

  // CEP em fonte grande: linha só com o CEP, fora do bloco do endereço
  let large: string | null = null;
  lines.forEach((line, i) => {
    if (large === null && usable(i) && !addressIndexes.includes(i)) large = largeCepOf(line);
  });

  // CEP: o de fonte grande tem prioridade; divergência vira aviso, nunca escolha silenciosa
  const inAddress = parsed.cep;
  let cep = large ?? inAddress ?? '';
  let cepConfidence: Confidence = large && inAddress ? 'high' : 'medium';
  if (large && inAddress && large !== inAddress) {
    cepConfidence = 'low';
    warnings.push('O CEP em destaque é diferente do CEP do endereço; confira.');
  }
  if (!cep) warnings.push('CEP do destinatário não encontrado.');
  cep = cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '';

  if (!parsed.number) warnings.push('Número do imóvel não encontrado.');

  // Rastreio impresso: sequência longa de letras e números, impressa embaixo
  // de cada código de barras — o que aparece mais vezes vem primeiro. A linha
  // do "Nº de Ref" fica de fora (é outro número). O OCR às vezes parte o código
  // com um espaço ("IM202400001 2345BR"): linha só de blocos em maiúsculas e
  // números é lida também sem os espaços.
  const isTracking = (token: string) =>
    /^[A-Z0-9]{10,30}$/.test(token) && (token.match(/\d/g) ?? []).length >= 8;
  const trackingCounts = new Map<string, number>();
  lines.forEach((line, i) => {
    if (!usable(i) || /\bref\b/i.test(line)) return;
    const tokens = /^[A-Z0-9]+(?: [A-Z0-9]+){1,2}$/.test(line)
      ? [line.replace(/ /g, '')]
      : (line.match(/\b[A-Z0-9]{10,30}\b/gi) ?? []);
    for (const token of new Set(tokens.map((t) => t.toUpperCase()).filter(isTracking))) {
      trackingCounts.set(token, (trackingCounts.get(token) ?? 0) + 1);
    }
  });
  const trackingCandidates = [...trackingCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([token]) => token);

  return {
    recipientName: field(name, nameConfidence),
    address: {
      cep: field(cep, cepConfidence),
      street: field(parsed.street, parsed.streetFound ? 'medium' : 'low'),
      // Número e complemento o CEP não resolve: nunca passam de "conferir"
      number: field(parsed.number, 'medium'),
      complement: { value: parsed.complement, confidence: 'medium' },
      neighborhood: field('', 'low'),
      city: field(parsed.city, 'medium'),
      state: field(parsed.state, 'medium'),
    },
    afterNumber: parsed.afterNumber,
    ceps: { large, inAddress },
    trackingCandidates,
    warnings,
  };
}

/**
 * Nota de uma leitura, para escolher a melhor entre as tentativas (recortes
 * diferentes da mesma foto): CEP e rua valem mais; os CEPs concordando, mais.
 */
export function scoreLabel(label: ParsedLabel): number {
  const a = label.address;
  return (
    (a.cep.value ? 3 : 0) +
    (label.ceps.large && label.ceps.large === label.ceps.inAddress ? 2 : 0) +
    (a.street.value ? 2 : 0) +
    (a.number.value ? 2 : 0) +
    (label.recipientName.value ? 1 : 0) +
    (a.city.value ? 1 : 0)
  );
}

/** Leitura boa o bastante para não tentar outro recorte. */
export const isCompleteLabel = (label: ParsedLabel): boolean =>
  Boolean(label.address.cep.value && label.address.street.value && label.address.number.value);
