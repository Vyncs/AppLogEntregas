import { formatCep, isValidCepFormat } from '../../services/label/cep';
import type { LabelReading } from '../../services/label/labelPipeline';
import { POOR_OCR_CONFIDENCE } from '../../services/label/labelPipeline';
import type { Confidence } from '../../services/label/labelParser';
import type { CepStatus, Conflict } from '../../services/label/reconcile';
import { toUf } from '../../services/label/text';
import type { Address, DeliveryPackage, OcrProviderId, PackageDraft, PackageGeo } from '../../types/package';

/** O que o formulário de conferência mostra e edita. */
export interface FormValues {
  trackingCode: string;
  recipientName: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  notes: string;
}

export type FormKey = keyof FormValues;

export interface FormConflict extends Omit<Conflict, 'field'> {
  field: FormKey;
}

export interface ReviewInitial {
  values: FormValues;
  confidence: Partial<Record<FormKey, Confidence>>;
  conflicts: FormConflict[];
  cepStatus: CepStatus | null;
  warnings: string[];
  provider: OcrProviderId;
  trackingNote: string | null;
  poorQuality: boolean;
  /** A foto não trouxe endereço nenhum (nem CEP, nem rua) */
  nothingFound: boolean;
  /** Texto lido pelo OCR, para conferir na tela; não é salvo */
  ocrText: string | null;
  /** Localização já salva (edição): vale até o endereço mudar */
  geo?: PackageGeo | null;
}

export const BLANK_VALUES: FormValues = {
  trackingCode: '',
  recipientName: '',
  cep: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  notes: '',
};

export function initialFromReading(reading: Extract<LabelReading, { kind: 'review' }>): ReviewInitial {
  const { parsed, review, tracking } = reading;
  const f = review.fields;
  const values: FormValues = {
    trackingCode: tracking?.code ?? '',
    recipientName: parsed.recipientName.value,
    cep: f.cep.value,
    street: f.street.value,
    number: f.number.value,
    complement: f.complement.value,
    neighborhood: f.neighborhood.value,
    city: f.city.value,
    state: f.state.value,
    notes: '',
  };

  const conflicts: FormConflict[] = [...review.conflicts];
  const { large, inAddress } = parsed.ceps;
  if (large && inAddress && large !== inAddress) {
    conflicts.unshift({
      field: 'cep',
      message: `O CEP em destaque (${formatCep(large)}) é diferente do CEP do endereço (${formatCep(inAddress)}).`,
      suggestion: formatCep(inAddress),
    });
  }

  const trackingNote = !tracking
    ? 'Código de barras não lido. Se quiser, digite o rastreio.'
    : tracking.source === 'printed'
      ? 'Sugestão a partir do texto impresso: confira com a etiqueta.'
      : tracking.confirmed
        ? 'Lido do código de barras e conferido com o texto impresso.'
        : 'Lido do código de barras.';

  return {
    values,
    confidence: {
      trackingCode: tracking && tracking.source === 'barcode' ? 'high' : 'medium',
      recipientName: parsed.recipientName.confidence,
      cep: f.cep.confidence,
      street: f.street.confidence,
      number: f.number.confidence,
      complement: f.complement.confidence,
      neighborhood: f.neighborhood.confidence,
      city: f.city.confidence,
      state: f.state.confidence,
    },
    conflicts,
    cepStatus: review.cepStatus,
    warnings: parsed.warnings,
    provider: reading.provider,
    trackingNote,
    poorQuality: reading.ocrConfidence < POOR_OCR_CONFIDENCE,
    nothingFound: !values.cep && !values.street,
    ocrText: reading.ocrText,
  };
}

export function initialFromPackage(pkg: DeliveryPackage): ReviewInitial {
  return {
    values: {
      trackingCode: pkg.trackingCode ?? '',
      recipientName: pkg.recipientName,
      ...pkg.address,
      notes: pkg.notes,
    },
    confidence: {},
    conflicts: [],
    cepStatus: null,
    warnings: [],
    provider: pkg.ocrProvider,
    trackingNote: null,
    poorQuality: false,
    nothingFound: false,
    ocrText: null,
    geo: pkg.geo ?? null,
  };
}

export const initialBlank = (): ReviewInitial => ({
  values: { ...BLANK_VALUES },
  confidence: {},
  conflicts: [],
  cepStatus: null,
  warnings: [],
  provider: 'manual',
  trackingNote: null,
  poorQuality: false,
  nothingFound: false,
  ocrText: null,
});

export type FormErrors = Partial<Record<FormKey, string>>;

export function validateValues(values: FormValues): FormErrors {
  // Na ordem da tela: o primeiro erro recebe o foco
  const errors: FormErrors = {};
  if (!isValidCepFormat(values.cep)) errors.cep = 'CEP precisa ter 8 dígitos.';
  if (!values.street.trim()) errors.street = 'Informe o logradouro.';
  if (!values.number.trim()) errors.number = 'Informe o número (ou S/N).';
  if (!values.city.trim()) errors.city = 'Informe a cidade.';
  if (!toUf(values.state)) errors.state = 'UF inválida.';
  const tracking = values.trackingCode.replace(/\s+/g, '');
  if (tracking && !/^[A-Za-z0-9-]{6,40}$/.test(tracking)) errors.trackingCode = 'Código de rastreio inválido.';
  if (values.recipientName.trim().length < 2) errors.recipientName = 'Informe o destinatário.';
  return errors;
}

/** O endereço que está no formulário, com espaços das pontas removidos. */
export const addressOf = (values: FormValues): Address => ({
  cep: values.cep.trim(),
  street: values.street.trim(),
  number: values.number.trim(),
  complement: values.complement.trim(),
  neighborhood: values.neighborhood.trim(),
  city: values.city.trim(),
  state: values.state.trim(),
});

/** Campos que o usuário mudou em relação à leitura — só os nomes, nunca o conteúdo. */
export function correctedFields(initial: FormValues, final: FormValues): string[] {
  return (Object.keys(BLANK_VALUES) as FormKey[]).filter(
    (key) => key !== 'notes' && initial[key].trim() !== final[key].trim(),
  );
}

export function toDraft(values: FormValues, initial: ReviewInitial): PackageDraft {
  const address = addressOf(values);
  address.cep = formatCep(address.cep);
  address.state = toUf(address.state) ?? address.state.toUpperCase();
  return {
    trackingCode: values.trackingCode.trim() || null,
    recipientName: values.recipientName.trim(),
    address,
    notes: values.notes.trim(),
    ocrProvider: initial.provider,
    correctedFields: initial.provider === 'manual' ? [] : correctedFields(initial.values, values),
  };
}
