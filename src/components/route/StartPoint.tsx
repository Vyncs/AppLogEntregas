import { lazy, Suspense, useState } from 'react';
import type { RouteApi, StartPoint } from '../../hooks/useRoute';
import { currentPosition } from '../../lib/geolocation';
import { cepService, geocoder } from '../../lib/services';
import { PRECISION_LABEL } from '../../services/geo/candidates';
import { STATE_NAME } from '../../services/geo/states';
import { locateTypedAddress, simplifyTypedAddress } from '../../services/geo/typedAddress';
import type { GeocodeCandidate } from '../../services/geo/types';
import type { Address, LatLng } from '../../types/package';
import { Button, Field, Spinner } from '../ui';

const MapPicker = lazy(() => import('../map/MapPicker'));

/** Ponto de partida e opções da rota, no alto da lista. */
export function StartPointSection({ route }: { route: RouteApi }) {
  const { settings } = route;
  const [editing, setEditing] = useState(false);
  const ask = editing || (route.loaded && !settings.start);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Ponto de partida">
      {ask ? (
        <StartPointEditor
          onSave={(start) => {
            route.setSettings({ ...settings, start });
            setEditing(false);
          }}
          onCancel={settings.start ? () => setEditing(false) : undefined}
        />
      ) : settings.start ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Partida</p>
              <p className="truncate font-semibold">{settings.start.label}</p>
            </div>
            <Button variant="secondary" className="min-h-9 shrink-0" onClick={() => setEditing(true)}>
              Alterar
            </Button>
          </div>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-teal-700"
              checked={settings.byStreet}
              onChange={(e) => route.setSettings({ ...settings, byStreet: e.target.checked })}
            />
            Organizar por ruas (da mais perto para a seguinte)
          </label>
          <label className="mt-2 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-teal-700"
              checked={settings.returnToStart}
              onChange={(e) => route.setSettings({ ...settings, returnToStart: e.target.checked })}
            />
            Voltar ao ponto de partida no fim
          </label>
        </>
      ) : (
        <p className="text-sm text-slate-500">Carregando…</p>
      )}
    </section>
  );
}

interface StartPointEditorProps {
  onSave: (start: StartPoint) => void;
  onCancel?: () => void;
}

function StartPointEditor({ onSave, onCancel }: StartPointEditorProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeCandidate[] | null>(null);
  const [understood, setUnderstood] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ center: LatLng; zoom: number } | null>(null);

  const search = async () => {
    if (query.trim().length < 5) {
      setError('Escreva rua, número e cidade (ou cole o endereço com o CEP).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await locateTypedAddress(query.trim(), { cep: cepService, geocoder });
      setResults(found.candidates);
      setUnderstood(found.address);
      if (found.candidates.length === 0) {
        setError(
          'O mapa gratuito não encontrou esse endereço (pode não ter essa rua cadastrada). Marque no mapa ou use a localização atual.',
        );
      }
    } catch {
      setError('Sem conexão com o mapa agora.');
    } finally {
      setBusy(false);
    }
  };

  const useHere = async () => {
    setError(null);
    try {
      onSave({ label: 'Localização marcada pelo GPS', location: await currentPosition() });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Abre o mapa no resultado encontrado, senão na cidade do CEP ou do texto. */
  const openPicker = async () => {
    setError(null);
    let center = results?.[0]?.location;
    let zoom = 17;
    if (!center) {
      const city = understood
        ? `${understood.city}, ${STATE_NAME[understood.state] ?? understood.state}`
        : simplifyTypedAddress(query).split(',').at(-1)?.trim() ?? '';
      if (city) {
        try {
          center = (await geocoder.search(city))[0]?.location;
          zoom = 14;
        } catch {
          // sem mapa da cidade: abre no padrão
        }
      }
    }
    setPicker({ center: center ?? { lat: -23.5505, lng: -46.6333 }, zoom: center ? zoom : 11 });
  };

  if (picker) {
    return (
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando mapa…</p>}>
        <MapPicker
          center={picker.center}
          zoom={picker.zoom}
          onPick={(location) => onSave({ label: query.trim() || 'Ponto marcado no mapa', location })}
          onCancel={() => setPicker(null)}
        />
      </Suspense>
    );
  }

  const best = results?.[0];

  return (
    <div>
      <p className="text-sm font-semibold">De onde você sai? (normalmente sua casa)</p>
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field
          id="campo-partida"
          label="Endereço de partida"
          value={query}
          onChange={setQuery}
          placeholder="Rua, número, cidade — ou cole com o CEP"
          action={
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : 'Buscar'}
            </Button>
          }
        />
      </form>
      {results && results.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Endereços encontrados">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full rounded-lg bg-slate-50 px-3 py-2 text-left text-sm ring-1 ring-slate-200 hover:bg-teal-50"
                onClick={() => onSave({ label: query.trim(), location: r.location })}
              >
                {r.label} <span className="text-xs text-slate-500">({PRECISION_LABEL[r.precision]})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {best && best.precision !== 'number' && (
        <p className="mt-2 text-xs text-amber-800">
          Localização aproximada ({PRECISION_LABEL[best.precision]}). Para a partida exata, marque no mapa.
        </p>
      )}
      {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void useHere()}>
          Usar minha localização atual
        </Button>
        <Button variant="secondary" onClick={() => void openPicker()}>
          Marcar no mapa
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
