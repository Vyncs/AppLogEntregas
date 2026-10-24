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
