/** Situação de uma encomenda no dia de trabalho. */
export type PackageStatus = 'pending' | 'delivered' | 'problem';

export const STATUS_LABEL: Record<PackageStatus, string> = {
  pending: 'Pendente',
  delivered: 'Entregue',
  problem: 'Com problema',
};

export interface Address {
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  /** UF com duas letras */
  state: string;
}

export type AddressField = keyof Address;

export const EMPTY_ADDRESS: Address = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
};

export interface StatusChange {
  status: PackageStatus;
  /** ISO 8601 */
  at: string;
  note?: string;
}

/** Quem leu a etiqueta. `manual` = digitada sem OCR. */
export type OcrProviderId = 'tesseract' | 'cloud-vision' | 'manual';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Até onde a coordenada é precisa: no número, na rua, no CEP ou só na cidade. */
export type GeoPrecision = 'number' | 'street' | 'cep' | 'city';

/** `learned`: o GPS na hora de uma entrega anterior nesse endereço */
export type GeocoderId = 'google' | 'tomtom' | 'nominatim' | 'map' | 'learned';

/** Onde a encomenda fica no mapa. */
export interface PackageGeo {
  location: LatLng;
  precision: GeoPrecision;
  provider: GeocoderId;
  /** O endereço como o provedor o entendeu */
  label: string;
  /** ISO 8601 — o Google só permite guardar a coordenada por até 30 dias */
  at: string;
  /** Versão da regra que escolheu o ponto; localização antiga e aproximada é refeita */
  version?: number;
  /** Identificador do lugar no Google (só com a chave do Google): leva o Maps ao lugar exato */
  placeId?: string;
}

/** Por que a encomenda está sem localização. */
export type GeoProblem = 'not-found' | 'unavailable';

export interface DeliveryPackage {
  /** UUID gerado no cliente — também serve de chave de idempotência na sincronização. */
  id: string;
  /** Código de rastreio do código de barras/QR; null quando não foi lido nem digitado. */
  trackingCode: string | null;
  recipientName: string;
  address: Address;
  status: PackageStatus;
  notes: string;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
  ocrProvider: OcrProviderId;
  /** Campos que o usuário mudou em relação à leitura (métrica de acerto, sem o texto lido). */
  correctedFields: string[];
  history: StatusChange[];
  /** Coordenadas do endereço; ausente em encomenda ainda não localizada */
  geo?: PackageGeo | null;
  geoProblem?: GeoProblem | null;
}

/** O que o cadastro precisa para criar ou atualizar uma encomenda. */
export interface PackageDraft {
  trackingCode: string | null;
  recipientName: string;
  address: Address;
  notes: string;
  ocrProvider: OcrProviderId;
  correctedFields: string[];
  /** `undefined` = não mexer na localização (ex.: só trocou o nome) */
  geo?: PackageGeo | null;
  geoProblem?: GeoProblem | null;
}
