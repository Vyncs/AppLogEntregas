import { lazy, Suspense, useState } from 'react';
import type { RouteApi, StartPoint } from '../../hooks/useRoute';
import { currentPosition } from '../../lib/geolocation';
import { cepService, geocoder } from '../../lib/services';
import { PRECISION_LABEL } from '../../services/geo/candidates';
import { STATE_NAME } from '../../services/geo/states';
import { locateTypedAddress, simplifyTypedAddress } from '../../services/geo/typedAddress';
import type { GeocodeCandidate } from '../../services/geo/types';
import type { Address, LatLng } from '../../types/package';
import { GearIcon, PencilIcon } from '../icons';
import { Button, Field, Modal, Spinner } from '../ui';

const MapPicker = lazy(() => import('../map/MapPicker'));

/** Ícone discreto da linha da partida, com área de toque de 40 px */
const ICON_BUTTON =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800';

/**
 * Ponto de partida no alto da lista, numa linha: o lápis troca a partida e a
 * engrenagem abre as opções da rota, cada um num modal. Sem partida ainda, o
 * formulário aparece direto — sem ele não dá para calcular a rota.
 */
export function StartPointSection({ route }: { route: RouteApi }) {
  const { settings } = route;
  const [open, setOpen] = useState<'edit' | 'options' | null>(null);
  const close = () => setOpen(null);

  if (route.loaded && !settings.start) {
    return (
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Ponto de partida">
        <StartPointEditor onSave={(start) => route.setSettings({ ...settings, start })} />
      </section>
    );
  }

  return (
    <section className="flex items-center gap-1 rounded-2xl bg-white py-2 pl-4 pr-2 shadow-sm ring-1 ring-slate-200" aria-label="Ponto de partida">
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium text-slate-500">Partida: </span>
        <span className="font-semibold">{settings.start?.label ?? 'Carregando…'}</span>
      </p>
      {settings.start && (
        <>
          <button type="button" className={ICON_BUTTON} onClick={() => setOpen('edit')} aria-label="Alterar a partida" title="Alterar a partida">
            <PencilIcon />
          </button>
          <button type="button" className={ICON_BUTTON} onClick={() => setOpen('options')} aria-label="Opções da rota" title="Opções da rota">
            <GearIcon />
          </button>
        </>
      )}

      {open === 'edit' && (
        <Modal title="Ponto de partida" onClose={close}>
          <StartPointEditor
            onSave={(start) => {
              route.setSettings({ ...settings, start });
              close();
            }}
            onCancel={close}
          />
        </Modal>
      )}
      {open === 'options' && (
        <Modal title="Opções da rota" onClose={close}>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-teal-700"
              checked={settings.byStreet}
              onChange={(e) => route.setSettings({ ...settings, byStreet: e.target.checked })}
            />
            <span>
              <span className="block font-medium">Organizar por ruas</span>
              <span className="text-slate-500">Rua a rua, da mais perto para a seguinte.</span>
            </span>
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-teal-700"
              checked={settings.returnToStart}
              onChange={(e) => route.setSettings({ ...settings, returnToStart: e.target.checked })}
            />
            <span>
              <span className="block font-medium">Voltar ao ponto de partida no fim</span>
              <span className="text-slate-500">Sem isso, a rota termina na última entrega.</span>
            </span>
          </label>
          <p className="mt-4 text-xs text-slate-500">As opções valem no próximo cálculo: toque em Recalcular.</p>
          <Button block className="mt-4" onClick={close}>
            Pronto
          </Button>
        </Modal>
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
