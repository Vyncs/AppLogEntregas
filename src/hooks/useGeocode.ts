import { useCallback, useEffect, useRef, useState } from 'react';
import { geocoder } from '../lib/services';
import { decideCandidates } from '../services/geo/candidates';
import { GeoUnavailableError, type GeocodeCandidate } from '../services/geo/types';
import { isValidCepFormat } from '../services/label/cep';
import { normalizeText } from '../services/label/text';
import type { Address, PackageGeo } from '../types/package';

export type GeoLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; chosen: GeocodeCandidate; options: GeocodeCandidate[]; ambiguous: boolean }
  | { status: 'not-found' }
  | { status: 'unavailable'; reason?: string };

/** O que muda a localização (o complemento não muda). */
const locationKey = (a: Address) => normalizeText([a.cep.replace(/\D/g, ''), a.street, a.number, a.city, a.state].join('|'));

const ready = (a: Address) => isValidCepFormat(a.cep) && a.street.trim() && a.city.trim() && a.state.trim();

const fromSaved = (geo: PackageGeo): GeoLookup => ({
  status: 'found',
  chosen: { location: geo.location, precision: geo.precision, provider: geo.provider, label: geo.label },
  options: [],
  ambiguous: false,
});

/**
 * Localiza o endereço do formulário enquanto o usuário confere. Espera ele
 * parar de digitar e não consulta de novo o mesmo endereço; em edição, a
 * localização já salva vale até o endereço mudar.
 */
export function useGeocode(address: Address, saved: PackageGeo | null | undefined) {
  const key = locationKey(address);
  const savedKey = useRef(saved ? key : null);
  const savedRef = useRef(saved);
  const [lookup, setLookup] = useState<GeoLookup>(() => (saved ? fromSaved(saved) : { status: 'idle' }));
  const addressRef = useRef(address);
  useEffect(() => {
    addressRef.current = address;
  });

  useEffect(() => {
    const kept = savedRef.current;
    if (kept && key === savedKey.current) {
      setLookup(fromSaved(kept));
      return;
    }
    if (!ready(addressRef.current)) {
      setLookup({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLookup({ status: 'loading' });
      try {
        const current = addressRef.current;
        const outcome = decideCandidates(current, await geocoder.geocode(current, controller.signal));
        setLookup(
          outcome.kind === 'found'
            ? { status: 'found', chosen: outcome.best, options: [outcome.best, ...outcome.alternatives], ambiguous: outcome.ambiguous }
            : { status: outcome.kind },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setLookup({ status: 'unavailable', reason: error instanceof GeoUnavailableError ? error.message : undefined });
      }
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const choose = useCallback(
    (candidate: GeocodeCandidate) =>
      setLookup((current) =>
        current.status === 'found'
          ? { ...current, chosen: candidate, ambiguous: false }
          : { status: 'found', chosen: candidate, options: [candidate], ambiguous: false },
      ),
    [],
  );

  return { lookup, choose };
}
