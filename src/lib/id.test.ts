import { describe, expect, it } from 'vitest';
import { newId } from './id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('gera UUID v4 mesmo sem crypto.randomUUID (página aberta por http na rede local)', () => {
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto), 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const id = newId();
      expect(id).toMatch(UUID_V4);
      expect(newId()).not.toBe(id);
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID;
      if (original && typeof crypto.randomUUID !== 'function') Object.defineProperty(crypto, 'randomUUID', original);
    }
  });

  it('usa crypto.randomUUID quando existe', () => {
    expect(newId()).toMatch(UUID_V4);
  });
});
