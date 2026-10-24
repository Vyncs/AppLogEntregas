import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useGeocode } from '../../hooks/useGeocode';
import { cepService } from '../../lib/services';
import { toPackageGeo } from '../../services/geo/candidates';
import { normalizeCep } from '../../services/label/cep';
import { lookupCep } from '../../services/label/labelPipeline';
import type { Confidence, ParsedField } from '../../services/label/labelParser';
import { reconcileAddress, type CepStatus } from '../../services/label/reconcile';
import { findSameDaySimilar } from '../../services/packages/packageService';
import type { AddressField, DeliveryPackage, PackageDraft } from '../../types/package';
import { Button, Field, Spinner } from '../ui';
import { GeoStatus } from './GeoStatus';
import {
  addressOf,
  toDraft,
  validateValues,
  type FormConflict,
  type FormErrors,
  type FormKey,
  type FormValues,
  type ReviewInitial,
} from './reviewModel';

const ADDRESS_FIELDS: AddressField[] = ['cep', 'street', 'number', 'complement', 'neighborhood', 'city', 'state'];
/** O que o ViaCEP pode preencher sozinho */
const FROM_CEP: AddressField[] = ['cep', 'street', 'neighborhood', 'city', 'state'];

const CEP_MESSAGE: Partial<Record<CepStatus, { text: string; tone: 'ok' | 'warn' }>> = {
  ok: { text: 'CEP conferido no ViaCEP.', tone: 'ok' },
  generic: { text: 'CEP geral da cidade: o ViaCEP não traz a rua. Confira o logradouro.', tone: 'warn' },
  unavailable: { text: 'Sem conexão com o ViaCEP: não deu para conferir o CEP agora.', tone: 'warn' },
  missing: { text: 'CEP não encontrado na etiqueta.', tone: 'warn' },
};

interface ReviewFormProps {
  initial: ReviewInitial;
  previewUrl?: string;
  packages: DeliveryPackage[];
  /** Ao editar uma encomenda existente, ela não conta como "parecida" consigo mesma */
  ignoreId?: string;
  submitLabel: string;
  discardLabel?: string;
  onSubmit: (draft: PackageDraft) => Promise<void>;
  onDiscard: () => void;
  onRetryRotated?: () => void;
}

export function ReviewForm({
  initial,
  previewUrl,
  packages,
  ignoreId,
  submitLabel,
  discardLabel = 'Descartar',
  onSubmit,
  onDiscard,
  onRetryRotated,
}: ReviewFormProps) {
  const [values, setValues] = useState<FormValues>(initial.values);
  const [confidence, setConfidence] = useState(initial.confidence);
  const [touched, setTouched] = useState<Set<FormKey>>(() => new Set());
  const [conflicts, setConflicts] = useState<FormConflict[]>(initial.conflicts);
  const [cepStatus, setCepStatus] = useState<CepStatus | null>(initial.cepStatus);
  const [cepLoading, setCepLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const lastLookup = useRef<string | null>(normalizeCep(initial.values.cep));
  const { lookup: geoLookup, choose: chooseGeo } = useGeocode(addressOf(values), initial.geo);

  const highlight = (key: FormKey): Confidence | undefined => {
    const level = confidence[key];
    return touched.has(key) || level === 'high' ? undefined : level;
  };

  const set = (key: FormKey, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => new Set(t).add(key));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const consultCep = async (cep: string, current: FormValues) => {
    const digits = normalizeCep(cep);
    if (!digits) return;
    lastLookup.current = digits;
    setCepLoading(true);
    try {
      const lookup = await lookupCep(cepService, cep);
      const asRead = Object.fromEntries(
        ADDRESS_FIELDS.map((key) => [key, { value: current[key], confidence: 'medium' } as ParsedField]),
      ) as Record<AddressField, ParsedField>;
      asRead.cep = { value: cep, confidence: 'medium' };
      const result = reconcileAddress(asRead, '', lookup);

      // Preenche o que veio confirmado pelo CEP, sem atropelar o que o usuário digitou
      const next = { ...current, cep };
      const nextConfidence = { ...confidence };
      for (const key of FROM_CEP) {
        const field = result.fields[key];
        if (field.confidence === 'high' && (!current[key].trim() || !touched.has(key) || key === 'cep')) {
          next[key] = field.value;
          nextConfidence[key] = 'high';
        }
      }
      setValues(next);
      setConfidence(nextConfidence);
      setConflicts(result.conflicts);
      setCepStatus(result.cepStatus);
    } catch {
      setCepStatus('unavailable');
    } finally {
      setCepLoading(false);
    }
  };

  const onCepChange = (value: string) => {
    set('cep', value);
    const digits = normalizeCep(value);
    if (digits && digits !== lastLookup.current) void consultCep(value, { ...values, cep: value });
  };

  const applyConflict = (conflict: FormConflict) => {
    if (!conflict.suggestion) return;
    const next = { ...values, [conflict.field]: conflict.suggestion };
    setValues(next);
    setTouched((t) => new Set(t).add(conflict.field));
    setConflicts((list) => list.filter((c) => c !== conflict));
    if (conflict.field === 'cep') void consultCep(conflict.suggestion, next);
  };

  const dismissConflict = (conflict: FormConflict) =>
    setConflicts((list) => list.filter((c) => c !== conflict));

  const similar = useMemo(
    () =>
      findSameDaySimilar(
        packages,
        { recipientName: values.recipientName, address: addressOf(values) },
        new Date(),
        ignoreId,
      ),
    [packages, values, ignoreId],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateValues(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      document.getElementById(`campo-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    setSubmitError(null);
    // Sem localização agora (não achou, sem conexão, ainda buscando): salva
    // assim mesmo; o cálculo da rota tenta de novo
    const geo = geoLookup.status === 'found' ? toPackageGeo(geoLookup.chosen) : null;
    const geoProblem = geo ? null : geoLookup.status === 'not-found' ? 'not-found' : 'unavailable';
    try {
      await onSubmit({ ...toDraft(values, initial), geo, geoProblem });
    } catch {
      setSubmitError('Não foi possível salvar. Tente de novo.');
      setSaving(false);
    }
  };

  const cepMessage = cepStatus ? CEP_MESSAGE[cepStatus] : undefined;

  return (
    <form onSubmit={submit} noValidate className="pb-28">
      {previewUrl && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowPhoto((v) => !v)}
            className="block w-full overflow-hidden rounded-xl bg-slate-900"
            aria-label={showPhoto ? 'Reduzir a foto' : 'Ampliar a foto'}
          >
            <img
              src={previewUrl}
              alt="Foto da etiqueta"
              className={`mx-auto w-full object-contain transition-all ${showPhoto ? 'max-h-[70vh]' : 'max-h-36'}`}
            />
          </button>
        </div>
      )}

      {initial.nothingFound ? (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200" role="status">
          Não encontramos o endereço nesta foto. Fotografe o bloco do destinatário de perto, reto e sem
          reflexo — ou digite os dados abaixo.
          {onRetryRotated && (
            <Button variant="secondary" className="mt-2 w-full" onClick={onRetryRotated}>
              Girar a foto e ler de novo
            </Button>
          )}
        </div>
      ) : initial.poorQuality && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
          A foto ficou difícil de ler. Confira todos os campos.
          {onRetryRotated && (
            <Button variant="secondary" className="mt-2 w-full" onClick={onRetryRotated}>
              Girar a foto e ler de novo
            </Button>
          )}
        </div>
      )}

      {similar.length > 0 && (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
          Já existe hoje uma encomenda para esse destinatário nesse endereço. Se for outra encomenda, pode salvar.
        </p>
      )}

      {conflicts.length > 0 && (
        <ul className="mb-3 space-y-2" aria-label="Divergências para conferir">
          {conflicts.map((conflict, i) => (
            <li key={`${conflict.field}-${i}`} className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
              <p>{conflict.message}</p>
              <div className="mt-2 flex gap-2">
                {conflict.suggestion && (
                  <Button variant="secondary" className="flex-1" onClick={() => applyConflict(conflict)}>
                    Usar “{conflict.suggestion}”
                  </Button>
                )}
                <Button variant="ghost" onClick={() => dismissConflict(conflict)}>
                  Manter o lido
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3">
        <Field
          id="campo-trackingCode"
          label="Código de rastreio (opcional)"
          value={values.trackingCode}
          onChange={(v) => set('trackingCode', v)}
          confidence={highlight('trackingCode')}
          error={errors.trackingCode}
          autoCapitalize="characters"
          className="font-mono"
        />
        {initial.trackingNote && <p className="-mt-2 text-xs text-slate-500">{initial.trackingNote}</p>}

        <Field
          id="campo-recipientName"
          label="Destinatário"
          value={values.recipientName}
          onChange={(v) => set('recipientName', v)}
          confidence={highlight('recipientName')}
          error={errors.recipientName}
          autoComplete="off"
        />

        <Field
          id="campo-cep"
          label="CEP"
          value={values.cep}
          onChange={onCepChange}
          confidence={highlight('cep')}
          error={errors.cep}
          inputMode="numeric"
          autoComplete="off"
          action={
            <Button
              variant="secondary"
              disabled={cepLoading || !normalizeCep(values.cep)}
              onClick={() => void consultCep(values.cep, values)}
              aria-label="Consultar o CEP"
            >
              {cepLoading ? <Spinner className="size-4" /> : 'Consultar'}
            </Button>
          }
        />
        {cepMessage && (
          <p className={`-mt-2 text-xs ${cepMessage.tone === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>
            {cepMessage.text}
          </p>
        )}

        <Field
          id="campo-street"
          label="Logradouro"
          value={values.street}
          onChange={(v) => set('street', v)}
          confidence={highlight('street')}
          error={errors.street}
        />

        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field
            id="campo-number"
            label="Número"
            value={values.number}
            onChange={(v) => set('number', v)}
            confidence={highlight('number')}
            error={errors.number}
            inputMode="text"
          />
          <Field
            id="campo-complement"
            label="Complemento"
            value={values.complement}
            onChange={(v) => set('complement', v)}
            confidence={highlight('complement')}
          />
        </div>

        <Field
          id="campo-neighborhood"
          label="Bairro"
          value={values.neighborhood}
          onChange={(v) => set('neighborhood', v)}
          confidence={highlight('neighborhood')}
        />

        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field
            id="campo-city"
            label="Cidade"
            value={values.city}
            onChange={(v) => set('city', v)}
            confidence={highlight('city')}
            error={errors.city}
          />
          <Field
            id="campo-state"
            label="UF"
            value={values.state}
            onChange={(v) => set('state', v)}
            confidence={highlight('state')}
            error={errors.state}
            maxLength={2}
            autoCapitalize="characters"
          />
        </div>

        <GeoStatus
          lookup={geoLookup}
          onChoose={chooseGeo}
          cityHint={[values.city, values.state].filter((v) => v.trim()).join(', ')}
        />

        <Field id="campo-notes" label="Observações" value={values.notes} onChange={(v) => set('notes', v)} />

        {initial.ocrText !== null && (
          <details className="rounded-xl bg-white p-3 text-xs text-slate-600 ring-1 ring-slate-200">
            <summary className="cursor-pointer font-medium">Ver o texto que a câmera leu</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono">
              {initial.ocrText.trim() || '(nenhum texto)'}
            </pre>
          </details>
        )}

        {initial.warnings.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            {initial.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      {submitError && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
          {submitError}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-2">
          <Button variant="ghost" onClick={onDiscard} disabled={saving}>
            {discardLabel}
          </Button>
          <Button type="submit" size="lg" className="flex-1" disabled={saving}>
            {saving ? <Spinner /> : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
