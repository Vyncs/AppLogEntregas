import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchPosition } from './geolocation';

afterEach(() => vi.unstubAllGlobals());

describe('watchPosition', () => {
  it('repassa cada posição nova e para de acompanhar ao chamar a função devolvida', () => {
    let send: PositionCallback = () => undefined;
    const clearWatch = vi.fn();
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: (ok: PositionCallback) => {
          send = ok;
          return 7;
        },
        clearWatch,
      },
    });
    const positions: unknown[] = [];
    const stop = watchPosition((p) => positions.push(p), () => undefined);
    send({ coords: { latitude: -23.9, longitude: -46.2, accuracy: 12 } } as GeolocationPosition);
    send({ coords: { latitude: -23.91, longitude: -46.21, accuracy: 8 } } as GeolocationPosition);
    expect(positions).toEqual([
      { location: { lat: -23.9, lng: -46.2 }, accuracy: 12 },
      { location: { lat: -23.91, lng: -46.21 }, accuracy: 8 },
    ]);
    stop();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it('sem permissão, avisa o que fazer', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => {
          fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
          return 1;
        },
        clearWatch: () => undefined,
      },
    });
    const errors: string[] = [];
    watchPosition(() => undefined, (m) => errors.push(m));
    expect(errors).toEqual(['Permita o acesso à localização para ver onde você está.']);
  });
});
