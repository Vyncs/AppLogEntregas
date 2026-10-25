import { normalizeText, similarity } from '../label/text';

/**
 * Ordem "por ruas": as encomendas da mesma rua saem juntas, na ordem dos
 * números, e as ruas vão da mais perto para a seguinte — como o entregador
 * separa os pacotes no carro. A rota pura por tempo intercala ruas (vai e
 * volta numa esquina) e obriga a reorganizar os pacotes a cada parada.
 *
 * Começa pela rua mais perto da partida; dali, a próxima rua é a de entrada
 * mais perto de onde a anterior terminou. Cada rua é percorrida no sentido
 * (números crescentes ou decrescentes) que começa mais perto.
 */

export interface StreetInfo {
  street: string;
  number: string;
  city: string;
}

const STREET_TYPE_WORDS = new Set([
  'rua', 'r', 'avenida', 'av', 'travessa', 'tv', 'trav', 'alameda', 'al', 'estrada', 'estr', 'est',
  'rodovia', 'rod', 'praca', 'pca', 'pc', 'largo', 'lg', 'viela', 'ladeira', 'beco', 'servidao', 'passagem', 'via',
]);

/** "R. das Flores" e "Rua das Flores" são a mesma rua; vazio sem rua. */
export function streetKey(street: string, city: string): string {
  const words = normalizeText(street).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean);
  while (words.length > 1 && STREET_TYPE_WORDS.has(words[0])) words.shift();
  if (words.length === 0) return '';
  return `${words.join(' ')}|${normalizeText(city)}`;
}

/** "979" → 979, "12A" → 12; S/N e vazio → null. */
export function houseNumber(value: string): number | null {
  const match = /\d+/.exec(value);
  return match ? Number(match[0]) : null;
}

/** Erro de leitura no nome da rua ("Valadao" × "Valadão", uma letra trocada) não separa a rua. */
const SAME_STREET = 0.85;

/** Agrupa os índices por rua, cada grupo em ordem crescente de número (sem número no fim). */
export function groupByStreet(streets: Array<StreetInfo | undefined>, indexes: number[]): number[][] {
  const groups: Array<{ key: string; members: number[] }> = [];
  const same = (a: string, b: string) => {
    const [streetA, cityA] = a.split('|');
    const [streetB, cityB] = b.split('|');
    return cityA === cityB && similarity(streetA, streetB) >= SAME_STREET;
  };
  for (const i of indexes) {
    const info = streets[i];
    const key = info ? streetKey(info.street, info.city) : '';
    // Sem rua: parada sozinha
    const group = key ? groups.find((g) => g.key === key || (g.key !== '' && same(g.key, key))) : undefined;
    if (group) group.members.push(i);
    else groups.push({ key, members: [i] });
  }
  for (const g of groups) {
    g.members.sort((a, b) => {
      const na = houseNumber(streets[a]?.number ?? '');
      const nb = houseNumber(streets[b]?.number ?? '');
      if (na === null || nb === null) return na === nb ? 0 : na === null ? 1 : -1;
      return na - nb;
    });
  }
  return groups.map((g) => g.members);
}

/**
 * Devolve a ordem de visita das paradas (sem a partida 0 e sem o ponto final
 * fixo `end`). `cost[i][j]` é o tempo de i até j.
 */
export function orderByStreet(cost: number[][], streets: Array<StreetInfo | undefined>, end: number | null = null): number[] {
  const stops = [...Array(cost.length).keys()].filter((i) => i !== 0 && i !== end);
  const left = groupByStreet(streets, stops);
  const order: number[] = [];
  let current = 0;
  while (left.length > 0) {
    let best = { group: 0, reversed: false, cost: Infinity };
    left.forEach((members, g) => {
      const ascending = cost[current][members[0]];
      const descending = cost[current][members[members.length - 1]];
      if (ascending < best.cost) best = { group: g, reversed: false, cost: ascending };
      if (descending < best.cost) best = { group: g, reversed: true, cost: descending };
    });
    const [members] = left.splice(best.group, 1);
    if (best.reversed) members.reverse();
    order.push(...members);
    current = members[members.length - 1];
  }
  return order;
}
