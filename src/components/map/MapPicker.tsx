import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../../types/package';
import { Button } from '../ui';

const PIN = L.divIcon({
  className: '',
  html: '<span class="block size-6 -translate-y-3 rounded-full border-4 border-white bg-red-600 shadow-lg"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

interface MapPickerProps {
  center: LatLng;
  zoom: number;
  onPick: (location: LatLng) => void;
  onCancel: () => void;
}

/** Tocar no mapa para marcar o ponto (quando o mapa gratuito não conhece a rua). */
export default function MapPicker({ center, zoom, onPick, onCancel }: MapPickerProps) {
  const element = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<LatLng | null>(null);

  useEffect(() => {
    if (!element.current) return;
    const map = L.map(element.current).setView([center.lat, center.lng], zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    let marker: L.Marker | null = null;
    map.on('click', (event: L.LeafletMouseEvent) => {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (marker) marker.setLatLng(event.latlng);
      else marker = L.marker(event.latlng, { icon: PIN }).addTo(map);
      setPicked(point);
    });
    return () => {
      map.remove();
    };
  }, [center.lat, center.lng, zoom]);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700">Aproxime e toque no mapa onde fica o ponto de partida.</p>
      <div ref={element} style={{ height: 300 }} className="w-full overflow-hidden rounded-xl ring-1 ring-slate-200" />
      <div className="mt-2 flex gap-2">
        <Button className="flex-1" disabled={!picked} onClick={() => picked && onPick(picked)}>
          {picked ? 'Usar este ponto' : 'Toque no mapa'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
