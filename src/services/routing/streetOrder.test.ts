import { describe, expect, it } from 'vitest';
import { groupByStreet, orderByStreet, streetKey, type StreetInfo } from './streetOrder';

// Rua fictícia em "quadras": o ponto k fica a |k - j| minutos do ponto j
const costOf = (positions: number[]) => positions.map((a) => positions.map((b) => Math.abs(a - b) * 60));
const at = (street: string, number: string): StreetInfo => ({ street, number, city: 'Cidade Exemplo' });

describe('streetKey', () => {
  it('ignora o tipo de via, a abreviação e o acento', () => {
    expect(streetKey('R. das Flores', 'Itu')).toBe(streetKey('Rua das Flores', 'ITU'));
    expect(streetKey('Av. Brasil', 'Itu')).toBe(streetKey('Avenida Brasil', 'Itu'));
    expect(streetKey('Rua Valadão', 'Itu')).toBe(streetKey('rua valadao', 'Itu'));
    expect(streetKey('', 'Itu')).toBe('');
  });
});

describe('groupByStreet', () => {
  it('junta a mesma rua (tolerando erro de leitura) e ordena pelos números', () => {
    const streets = [
      undefined,
      at('Rua Alfabeto', '30'),
      at('Rua Beta', '5'),
      at('R. Alfabeto', '10'),
      at('Rua Alfabeta', '20'),
      at('Rua Alfabeto', 'S/N'),
    ];
    expect(groupByStreet(streets, [1, 2, 3, 4, 5])).toEqual([[3, 4, 1, 5], [2]]);
  });
});

describe('orderByStreet', () => {
  it('faz uma rua inteira antes de passar para a próxima, começando pela mais perto', () => {
    // Partida em 0. Rua Alfa: números 10 (pos 1), 20 (pos 5). Rua Beta: 7 (pos 2), 9 (pos 6).
    // Pela distância pura seria 1 → 2 → 5 → 6, intercalando as ruas.
    const positions = [0, 5, 2, 1, 6];
    const streets = [undefined, at('Rua Alfa', '20'), at('Rua Beta', '7'), at('Rua Alfa', '10'), at('Rua Beta', '9')];
    expect(orderByStreet(costOf(positions), streets)).toEqual([3, 1, 4, 2]);
  });

  it('percorre a rua no sentido que começa mais perto (números decrescentes)', () => {
    // Partida perto do fim da rua: começa pelo número maior
    const positions = [10, 1, 9, 5];
    const streets = [undefined, at('Rua Alfa', '10'), at('Rua Alfa', '90'), at('Rua Alfa', '50')];
    expect(orderByStreet(costOf(positions), streets)).toEqual([2, 3, 1]);
  });

  it('parada sem rua fica sozinha, e o ponto final fixo não entra na ordem', () => {
    const positions = [0, 3, 1, 9];
    const streets = [undefined, at('', '1'), at('Rua Alfa', '1'), undefined];
    expect(orderByStreet(costOf(positions), streets, 3)).toEqual([2, 1]);
  });
});
