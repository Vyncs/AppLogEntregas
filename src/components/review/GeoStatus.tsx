import { lazy, Suspense, useState } from 'react';
import type { GeoLookup } from '../../hooks/useGeocode';
import { geocoder } from '../../lib/services';
import { PRECISION_LABEL } from '../../services/geo/candidates';
import type { GeocodeCandidate } from '../../services/geo/types';
import type { LatLng } from '../../types/package';
import { Button, Spinner } from '../ui';

const MapView = lazy(() => import('../map/MapView'));
const MapPicker = lazy(() => import('../map/MapPicker'));

const short = (label: string) => label.split(',').slice(0, 3).join(',');

interface GeoStatusProps {
  lookup: GeoLookup;
  onChoose: (candidate: GeocodeCandidate) => void;
  /** "Cidade, UF" — onde abrir o mapa para marcar, quando não há ponto */
  cityHint: string;
}

/** Onde o endereço caiu no mapa, para confirmar, escolher outro lugar ou marcar tocando no mapa. */
export function GeoStatus({ lookup, onChoose, cityHint }: GeoStatusProps) {
  const [showMap, setShowMap] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [picker, setPicker] = useState<{ center: LatLng; zoom: number } | null>(null);

  /** O mapa gratuito não tem a rua: o entregador marca a casa tocando no mapa. */
  const openPicker = async () => {
    let center = lookup.status === 'found' ? lookup.chosen.location : undefined;
    let zoom = 17;
    if (!center && cityHint.trim()) {
      try {
        center = (await geocoder.search(cityHint))[0]?.location;
        zoom = 14;
      } catch {
        // abre no padrão
      }
    }
    setPicker({ center: center ?? { lat: -23.5505, lng: -46.6333 }, zoom: center ? zoom : 11 });
  };

  if (picker) {
    return (
      <Suspense fallback={<p className="text-xs text-slate-500">Carregando mapa…</p>}>
        <MapPicker
          center={picker.center}
          zoom={picker.zoom}
          onPick={(location) => {
            onChoose({ location, precision: 'number', provider: 'map', label: 'Ponto marcado no mapa' });
            setPicker(null);
          }}
          onCancel={() => setPicker(null)}
        />
      </Suspense>
    );
  }

  const markButton = (
    <Button variant="secondary" className="min-h-9 text-xs" onClick={() => void openPicker()}>
      Marcar no mapa
    </Button>
  );

  if (lookup.status === 'idle') {
    return <p className="text-xs text-slate-500">📍 Com CEP, rua e cidade preenchidos, o endereço é localizado no mapa.</p>;
  }
  if (lookup.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-600" role="status">
        <Spinner className="size-3.5" /> Localizando no mapa…
      </p>
    );
  }
  if (lookup.status === 'not-found') {
    return (
      <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200" role="status">
        <p>
          📍 Endereço não localizado no mapa. Confira rua e número; se estiverem certos, o mapa gratuito pode não ter a
          rua — marque a casa tocando no mapa.
        </p>
        <div className="mt-2">{markButton}</div>
      </div>
    );
  }
  if (lookup.status === 'unavailable') {
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200" role="status">
        📍{' '}
        {lookup.reason && lookup.reason !== 'Serviço de mapas indisponível no momento.'
          ? lookup.reason
          : 'Sem conexão com o mapa agora: a localização fica para quando a rota for calculada.'}
      </p>
    );
  }

  const { chosen, options, ambiguous } = lookup;
  const precise = chosen.precision === 'number';
  const others = options.filter((o) => o !== chosen);

  return (
    <div className={`rounded-xl p-3 text-xs ring-1 ${precise ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}>
      {ambiguous ? (
        <p className="font-semibold">Encontramos mais de um lugar para esse endereço. Toque no certo:</p>
      ) : (
        <p>
          📍 Localizado <strong>{PRECISION_LABEL[chosen.precision]}</strong>: {short(chosen.label)}
        </p>
      )}
      {chosen.provider === 'nominatim' && <p className="mt-0.5 text-[11px] opacity-70">Mapa © OpenStreetMap</p>}
      {chosen.provider === 'tomtom' && <p className="mt-0.5 text-[11px] opacity-70">Localização © TomTom</p>}

      {(ambiguous || showOptions) && others.length > 0 && (
        <ul className="mt-2 space-y-1">
          {[chosen, ...others].map((option, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  onChoose(option);
                  setShowOptions(false);
                }}
                className={`w-full rounded-lg px-3 py-2 text-left ring-1 ${option === chosen ? 'bg-white font-semibold ring-teal-600' : 'bg-white/60 ring-slate-200'}`}
              >
                {short(option.label)} <span className="opacity-70">({PRECISION_LABEL[option.precision]})</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-9 text-xs" onClick={() => setShowMap((v) => !v)}>
          {showMap ? 'Esconder mapa' : 'Ver no mapa'}
        </Button>
        {!ambiguous && others.length > 0 && (
          <Button variant="ghost" className="min-h-9 text-xs" onClick={() => setShowOptions((v) => !v)}>
            Não é aqui? ({others.length})
          </Button>
        )}
        {!precise && markButton}
      </div>
      {showMap && (
        <div className="mt-2">
          <Suspense fallback={<p className="text-slate-500">Carregando mapa…</p>}>
            <MapView markers={[{ location: chosen.location, label: chosen.label }]} height={200} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
