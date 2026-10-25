import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { LatLng } from '../../types/package';

export interface MapMarker {
  location: LatLng;
  label?: string;
  /** Número da parada; sem número, um ponto */
  number?: number;
  /** Outras paradas no mesmo ponto (mostra "+N") */
  more?: number;
  tone?: 'start' | 'stop' | 'done' | 'selected';
}

const TONE: Record<NonNullable<MapMarker['tone']>, string> = {
  start: 'bg-amber-400 text-slate-900',
  stop: 'bg-teal-700 text-white',
  done: 'bg-slate-400 text-white',
  selected: 'bg-orange-500 text-white scale-125',
};

interface MapViewProps {
  markers: MapMarker[];
  height?: number | string;
  /** Linha do trajeto, na ordem */
  path?: LatLng[];
  /** Linha reta entre as paradas (tracejada) ou o desenho pelas ruas (cheia) */
  pathKind?: 'straight' | 'streets';
  /** Toque num marcador (índice em `markers`) */
  onSelect?: (index: number) => void;
  /** Enquadra só na primeira vez: atualizar os marcadores não tira o zoom do lugar */
  keepView?: boolean;
}

/**
 * Mapa com OpenStreetMap (Leaflet). Carregado só quando aberto, para não pesar
 * na tela inicial. Os blocos do mapa vêm do servidor do OpenStreetMap, com a
 * atribuição exigida.
 */
export default function MapView({ markers, height = 220, path, pathKind = 'straight', onSelect, keepView }: MapViewProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const framed = useRef(false);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, { attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
      framed.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    if (path && path.length > 1) {
      L.polyline(
        path.map((p) => [p.lat, p.lng] as [number, number]),
        pathKind === 'streets'
          ? { color: '#0f766e', weight: 4, opacity: 0.75 }
          : { color: '#0f766e', weight: 3, opacity: 0.5, dashArray: '6 6' },
      ).addTo(group);
    }
    markers.forEach((marker, index) => {
      const badge = marker.more
        ? `<span class="absolute -right-2 -top-2 rounded-full bg-white px-1 text-[10px] font-bold text-slate-800 ring-1 ring-slate-300">+${marker.more}</span>`
        : '';
      L.marker([marker.location.lat, marker.location.lng], {
        icon: L.divIcon({
          className: '',
          html: `<span class="relative flex size-8 items-center justify-center rounded-full text-xs font-bold shadow ring-2 ring-white ${TONE[marker.tone ?? 'stop']}">${marker.number ?? ''}${badge}</span>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
        title: marker.label,
        // A parada selecionada fica por cima das outras
        zIndexOffset: marker.tone === 'selected' ? 1000 : 0,
      })
        .on('click', () => select.current?.(index))
        .addTo(group);
    });
    if (!(keepView && framed.current) && markers.length > 0) {
      framed.current = true;
      if (markers.length === 1) m.setView([markers[0].location.lat, markers[0].location.lng], 17);
      else m.fitBounds(L.latLngBounds(markers.map((p) => [p.location.lat, p.location.lng])), { padding: [32, 32] });
    }
  }, [markers, path, pathKind, keepView]);

  return <div ref={element} style={{ height }} className="w-full overflow-hidden rounded-xl ring-1 ring-slate-200" />;
}
