import type { LatLng } from '../types/package';

/** Posição atual do celular. Só funciona em HTTPS (ou localhost) e com permissão. */
export function currentPosition(timeoutMs = 10_000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error('A localização atual só funciona com o app em HTTPS (ou localhost).'));
      return;
    }
    if (!('geolocation' in navigator)) {
      reject(new Error('Este navegador não informa a localização.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Permita o acesso à localização para usar esta opção.'
              : 'Não foi possível obter sua localização agora.',
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export interface LivePosition {
  location: LatLng;
  /** Raio de incerteza, em metros */
  accuracy: number;
}

/**
 * Acompanha a posição do celular enquanto o mapa está aberto (o GPS só fica
 * ligado nesse tempo). Devolve a função que para de acompanhar.
 */
export function watchPosition(onPosition: (p: LivePosition) => void, onError: (message: string) => void): () => void {
  if (!window.isSecureContext) {
    onError('Sua localização só aparece com o app em HTTPS.');
    return () => undefined;
  }
  if (!('geolocation' in navigator)) {
    onError('Este navegador não informa a localização.');
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onPosition({ location: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracy: p.coords.accuracy }),
    (e) =>
      onError(
        e.code === e.PERMISSION_DENIED
          ? 'Permita o acesso à localização para ver onde você está.'
          : 'Não foi possível obter sua localização agora.',
      ),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Uma leitura do GPS com a precisão (para decidir se dá para confiar no ponto). */
export function currentFix(timeoutMs = 10_000): Promise<LivePosition> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !('geolocation' in navigator)) {
      reject(new Error('Localização indisponível.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ location: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracy: p.coords.accuracy }),
      () => reject(new Error('Não foi possível obter sua localização agora.')),
      // Posição recente (a do mapa aberto serve), mas não de minutos atrás
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}
