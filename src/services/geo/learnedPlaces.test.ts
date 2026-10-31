import { describe, expect, it, vi } from 'vitest';
import { learnFromDelivery } from '../../lib/learning';
import { googleMapsDirectionsUrl } from '../routing/navigation';
import { MemoryLearnedStore } from '../storage/learnedRepository';
import type { Address, DeliveryPackage, GeoProblem, PackageGeo } from '../../types/package';
import { decideLearning, learnedGeo, learnedKey, LearningGeocoder, MAX_ACCURACY_M } from './learnedPlaces';
import type { Geocoder } from './types';

// Endereços e coordenadas fictícios
const address = (number: string, complement = ''): Address => ({
  cep: '11443-080', street: 'Rua das Flores', number, complement, neighborhood: 'Centro', city: 'Guarujá', state: 'SP',
});
const mapPoint = { lat: -23.98, lng: -46.21 };
const geo: PackageGeo = { location: mapPoint, precision: 'street', provider: 'nominatim', label: 'Rua das Flores', at: '' };
const pkg = (id: string, number: string, status: DeliveryPackage['status'] = 'pending', complement = ''): DeliveryPackage => ({
  id, trackingCode: null, recipientName: id, status, notes: '', createdAt: '', updatedAt: '', ocrProvider: 'manual',
  correctedFields: [], history: [], address: address(number, complement), geo,
});
/** ~100 m ao norte do ponto do mapa: a porta de verdade */
const door = { lat: -23.9791, lng: -46.21 };

describe('learnedKey', () => {
  it('mesma rua e número, com "R." ou outro complemento, é o mesmo endereço', () => {
    expect(learnedKey({ ...address('979', 'casa 2'), street: 'R. das Flores' })).toBe(learnedKey(address('979')));
    expect(learnedKey(address('979'))).not.toBe(learnedKey(address('980')));
    expect(learnedKey(address('S/N'))).toBeNull();
  });
});

describe('decideLearning', () => {
  it('aprende com GPS preciso perto do endereço', () => {
    expect(decideLearning(pkg('a', '979'), { location: door, accuracy: 12 })).toMatchObject({ kind: 'learned', place: { location: door } });
  });
  it('não aprende com GPS impreciso, nem marcado longe (em casa, no fim do dia)', () => {
    expect(decideLearning(pkg('a', '979'), { location: door, accuracy: MAX_ACCURACY_M + 1 })).toEqual({ kind: 'skipped', reason: 'inaccurate' });
    expect(decideLearning(pkg('a', '979'), { location: { lat: -23.95, lng: -46.21 }, accuracy: 10 })).toEqual({ kind: 'skipped', reason: 'too-far' });
  });
});

describe('LearningGeocoder', () => {
  it('endereço já confirmado não pergunta ao mapa', async () => {
    const store = new MemoryLearnedStore();
    await store.set(learnedKey(address('979'))!, { location: door, accuracy: 10, at: '' });
    const inner = { id: 'nominatim', geocode: vi.fn(async () => []), search: vi.fn() } as unknown as Geocoder;
    const geocoder = new LearningGeocoder(inner, store);

    const [found] = await geocoder.geocode(address('979', 'apto 3'));
    expect(found).toMatchObject({ location: door, precision: 'number', provider: 'learned' });
    expect(inner.geocode).not.toHaveBeenCalled();

    await geocoder.geocode(address('100'));
    expect(inner.geocode).toHaveBeenCalledTimes(1);
  });
});

describe('learnFromDelivery', () => {
  it('guarda o local e já corrige as pendentes do mesmo endereço', async () => {
    const store = new MemoryLearnedStore();
    const setGeo = vi.fn(async (_id: string, _geo: PackageGeo | null, _problem: GeoProblem | null) => undefined);
    const delivered = pkg('a', '979', 'delivered');
    const packages = [delivered, pkg('b', '979', 'pending', 'casa 2'), pkg('c', '100'), pkg('d', '979', 'problem')];
    const outcome = await learnFromDelivery(delivered, packages, { store, setGeo, fix: async () => ({ location: door, accuracy: 8 }) });

    expect(outcome?.kind).toBe('learned');
    expect(store.places.get(learnedKey(address('979'))!)?.location).toEqual(door);
    expect(setGeo.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(setGeo.mock.calls[0][1]).toMatchObject({ provider: 'learned', precision: 'number', location: door });
  });

  it('sem GPS, a entrega fica salva e nada é aprendido', async () => {
    const store = new MemoryLearnedStore();
    const setGeo = vi.fn();
    const outcome = await learnFromDelivery(pkg('a', '979', 'delivered'), [], {
      store,
      setGeo,
      fix: async () => {
        throw new Error('sem permissão');
      },
    });
    expect(outcome).toBeNull();
    expect(store.places.size).toBe(0);
    expect(setGeo).not.toHaveBeenCalled();
  });
});

describe('Maps com local aprendido', () => {
  it('vai pela coordenada (a porta certa), não pelo endereço', () => {
    const url = googleMapsDirectionsUrl(address('979'), learnedGeo({ location: door, accuracy: 8, at: '' }));
    expect(url).toContain(`destination=${door.lat.toFixed(6)},${door.lng.toFixed(6)}`);
    expect(googleMapsDirectionsUrl(address('979'), geo)).toContain('destination=Rua%20das%20Flores');
  });
});
