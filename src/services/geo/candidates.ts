import type { Address, GeocoderId, GeoPrecision, PackageGeo } from '../../types/package';
import { normalizeText, similarity } from '../label/text';
import { haversineMeters } from './distance';
import type { GeocodeCandidate } from './types';

const RANK: Record<GeoPrecision, number> = { number: 3, street: 2, cep: 1, city: 0 };

/** Dois resultados a menos disso são o mesmo lugar. */
const SAME_PLACE_M = 40;
/** Resultados igualmente precisos a mais disso: o usuário escolhe. */
const AMBIGUOUS_M = 300;
/** Trechos da mesma rua até essa distância são uma rua só (não ruas homônimas). */
const SAME_STREET_SPAN_M = 3000;

/**
 * Versão da regra de localização. A 2 junta os trechos de uma rua; a 3 ignora
 * resultado de outra rua. Ponto aproximado salvo por versão anterior é
 * localizado de novo no próximo cálculo.
 */
export const GEO_VERSION = 3;

/** Tipo de logradouro, títulos e ligações: o que sobra é o nome que distingue a rua. */
const STREET_NOISE = new Set([
  ...['rua', 'r', 'avenida', 'av', 'alameda', 'al', 'travessa', 'tv', 'trav', 'estrada', 'estr', 'rodovia', 'rod'],
  ...['praca', 'pca', 'largo', 'lgo', 'viela', 'beco', 'ladeira', 'servidao', 'passagem'],
  ...['doutor', 'doutora', 'dr', 'dra', 'professor', 'professora', 'prof', 'profa', 'presidente', 'pres'],
  ...['governador', 'gov', 'prefeito', 'pref', 'vereador', 'ver', 'deputado', 'dep', 'senador', 'sen'],
  ...['engenheiro', 'eng', 'coronel', 'cel', 'general', 'gen', 'marechal', 'mal', 'major', 'maj'],
  ...['capitao', 'cap', 'tenente', 'ten', 'almirante', 'alm', 'comendador', 'com', 'desembargador', 'des'],
  ...['ministro', 'min', 'padre', 'pe', 'frei', 'dom', 'dona', 'd', 'santa', 'sta', 'santo', 'sto', 'sao', 's'],
  ...['nossa', 'senhora', 'sra', 'n', 'barao', 'visconde', 'conde', 'de', 'da', 'do', 'dos', 'das', 'e'],
]);

/** "Av. Gov. Mário Covas" e "Avenida Governador Mario Covas" → "mario covas". */
function streetKey(street: string): string {
  const words = normalizeText(street).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return words.filter((w) => !STREET_NOISE.has(w)).join(' ') || words.join(' ');
}

/**
 * Mesma rua? Tolera abreviação, acento e erro de leitura (rn/m), mas "Rua A"
 * e "Rua 5" não são a "Rua Exemplo".
 */
export function sameStreet(a: string, b: string): boolean {
  const x = streetKey(a);
  const y = streetKey(b);
  if (!x || !y || x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  return similarity(x, y) >= 0.75;
}

/** Resultado de outra rua só diz a região: no máximo, precisão de CEP. */
const asArea = (c: GeocodeCandidate): GeocodeCandidate =>
  RANK[c.precision] > RANK.cep ? { ...c, precision: 'cep' } : c;

/**
 * O OpenStreetMap divide uma rua em vários trechos e, sem número de casa no
 * Brasil, devolve os trechos em ordem que muda a cada busca — o 98 e o 100 da
 * mesma rua caíam a 660 m um do outro. Trechos da mesma rua viram um ponto só,
 * no meio deles: vizinhos ficam juntos e o erro cai para metade da rua.
 */
function mergeStreetSegments(candidates: GeocodeCandidate[]): GeocodeCandidate[] {
  const streets = candidates.filter((c) => c.precision === 'street' && c.street);
  const name = streets[0]?.street;
  if (!name) return candidates;
  const same = streets.filter((c) => normalizeText(c.street ?? '') === normalizeText(name));
  if (same.length < 2) return candidates;
  const span = Math.max(...same.flatMap((a) => same.map((b) => haversineMeters(a.location, b.location))));
  if (span > SAME_STREET_SPAN_M) return candidates;
  const merged: GeocodeCandidate = {
    ...same[0],
    location: {
      lat: same.reduce((sum, c) => sum + c.location.lat, 0) / same.length,
      lng: same.reduce((sum, c) => sum + c.location.lng, 0) / same.length,
    },
  };
  return [merged, ...candidates.filter((c) => !same.includes(c))];
}

export type GeocodeOutcome =
  | { kind: 'found'; best: GeocodeCandidate; alternatives: GeocodeCandidate[]; ambiguous: boolean }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

/**
 * Escolhe a coordenada: descarta resultado de outra cidade e de outra rua,
 * prefere o mais preciso (número > rua > CEP > cidade) e marca como ambíguo
 * quando sobram resultados tão precisos quanto o melhor, mas em lugares
 * diferentes.
 *
 * O TomTom completa a lista com outras ruas do bairro ("Rua A, 98", "Rua 5"):
 * não são esse endereço. Se nenhuma for a rua pedida, o melhor resultado
 * serve só como região aproximada — nunca "no ponto exato".
 */
export function decideCandidates(address: Address, candidates: GeocodeCandidate[]): GeocodeOutcome {
  const sameCity = candidates.filter(
    (c) => !c.city || !address.city || similarity(c.city, address.city) >= 0.8,
  );
  const street = address.street.trim();
  const onStreet = sameCity.filter((c) => !street || !c.street || sameStreet(c.street, street));
  const areaOnly = onStreet.length === 0;
  const pool = areaOnly ? sameCity.map(asArea) : onStreet;
  const ranked = mergeStreetSegments([...pool].sort((a, b) => RANK[b.precision] - RANK[a.precision]));
  const unique: GeocodeCandidate[] = [];
  for (const c of ranked) {
    if (!unique.some((u) => haversineMeters(u.location, c.location) < SAME_PLACE_M)) unique.push(c);
  }
  const [best, ...alternatives] = unique;
  if (!best) return { kind: 'not-found' };
  // Escolher entre ruas erradas não ajuda: aí o caminho é marcar no mapa
  if (areaOnly) return { kind: 'found', best, alternatives: [], ambiguous: false };
  const ambiguous = alternatives.some(
    (c) => c.precision === best.precision && haversineMeters(c.location, best.location) > AMBIGUOUS_M,
  );
  return { kind: 'found', best, alternatives, ambiguous };
}

export const toPackageGeo = (candidate: GeocodeCandidate, now = new Date()): PackageGeo => ({
  location: candidate.location,
  precision: candidate.precision,
  provider: candidate.provider,
  label: candidate.label,
  at: now.toISOString(),
  version: GEO_VERSION,
  ...(candidate.placeId ? { placeId: candidate.placeId } : {}),
});

/**
 * Precisa localizar (de novo)? Sem ponto; ponto aproximado de regra antiga; ou
 * ponto aproximado do OpenStreetMap quando um serviço com número de casa
 * (Google ou TomTom) passa a estar configurado. Ponto marcado no mapa fica.
 */
export function needsGeocode(geo: PackageGeo | null | undefined, geocoderId: GeocoderId): boolean {
  if (!geo) return true;
  if (geo.precision === 'number') return false;
  if ((geo.version ?? 1) < GEO_VERSION) return true;
  return geocoderId !== 'nominatim' && geo.provider === 'nominatim';
}

export const PRECISION_LABEL: Record<GeoPrecision, string> = {
  number: 'no ponto exato',
  street: 'na rua',
  cep: 'pelo CEP',
  city: 'só a cidade',
};
