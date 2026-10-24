import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { LatLng } from '../../types/package';

export interface MapMarker {
  location: LatLng;
  label?: string;
  /** Número da parada; sem número, um ponto */
  number?: number;
  tone?: 'start' | 'stop' | 'done';
}

const TONE: Record<NonNullable<MapMarker['tone']>, string> = {
  start: 'bg-amber-400 text-slate-900',
  stop: 'bg-teal-700 text-white',
  done: 'bg-slate-400 text-white',
};

/**
 * Mapa com OpenStreetMap (Leaflet). Carregado só quando aberto, para não pesar
 * na tela inicial. Os blocos do mapa vêm do servidor do OpenStreetMap, com a
 * atribuição exigida.
 */
export default function MapView({ markers, height = 220 }: { markers: MapMarker[]; height?: number }) {
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!element.current || markers.length === 0) return;
    const map = L.map(element.current, { attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    const layers = markers.map((m) =>
      L.marker([m.location.lat, m.location.lng], {
        icon: L.divIcon({
          className: '',
          html: `<span class="flex size-7 items-center justify-center rounded-full text-xs font-bold shadow ring-2 ring-white ${TONE[m.tone ?? 'stop']}">${m.number ?? ''}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: m.label,
      }),
    );
    const group = L.featureGroup(layers).addTo(map);
    if (markers.length === 1) map.setView([markers[0].location.lat, markers[0].location.lng], 17);
    else map.fitBounds(group.getBounds(), { padding: [24, 24] });
    return () => {
      map.remove();
    };
  }, [markers]);

  return <div ref={element} style={{ height }} className="w-full overflow-hidden rounded-xl ring-1 ring-slate-200" />;
}
