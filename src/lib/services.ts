import { createBarcodeReader, type BarcodeReader } from '../services/barcode/barcodeReader';
import { ViaCepService } from '../services/cep/cepService';
import { GoogleGeocoder } from '../services/geo/googleGeocoder';
import { NominatimGeocoder } from '../services/geo/nominatimGeocoder';
import { TomTomGeocoder } from '../services/geo/tomtomGeocoder';
import type { Geocoder } from '../services/geo/types';
import { OrsMatrixProvider } from '../services/routing/orsProvider';
import { OsrmMatrixProvider } from '../services/routing/osrmProvider';
import type { MatrixProvider } from '../services/routing/types';
import { readLabel, type LabelReading, type ReadingStage } from '../services/label/labelPipeline';
import { TesseractOcrProvider } from '../services/ocr/tesseractProvider';
import type { Rotation } from '../services/ocr/preprocess';
import { findByTracking } from '../services/packages/packageService';
import { IndexedDbPackageRepository } from '../services/storage/packageRepository';

/** Instâncias únicas do app: um worker de OCR, um cache de CEP, um banco local. */
export const repository = new IndexedDbPackageRepository();
export const cepService = new ViaCepService();
export const ocrProvider = new TesseractOcrProvider();

const env = import.meta.env;

/**
 * Quem acha os endereços: Google, se houver chave; senão TomTom (grátis, sem
 * cartão); senão OpenStreetMap (Nominatim, 1 consulta por segundo).
 */
export const geocoder: Geocoder = env.VITE_GOOGLE_MAPS_API_KEY
  ? new GoogleGeocoder(env.VITE_GOOGLE_MAPS_API_KEY)
  : env.VITE_TOMTOM_API_KEY
    ? new TomTomGeocoder(env.VITE_TOMTOM_API_KEY)
    : new NominatimGeocoder(undefined, env.MODE === 'test' ? 0 : 1100);

/** OpenRouteService com chave; sem ela, OSRM (o de demonstração, ou o de VITE_OSRM_URL). */
export const matrixProvider: MatrixProvider = env.VITE_ORS_API_KEY
  ? new OrsMatrixProvider(env.VITE_ORS_API_KEY)
  : new OsrmMatrixProvider(env.VITE_OSRM_URL || undefined);

let barcodeReader: Promise<BarcodeReader> | null = null;
const getBarcodeReader = () => (barcodeReader ??= createBarcodeReader());

export async function readLabelFile(
  file: Blob,
  options: { rotation?: Rotation; onStage?: (stage: ReadingStage) => void } = {},
): Promise<LabelReading> {
  return readLabel(
    file,
    {
      barcode: await getBarcodeReader(),
      ocr: ocrProvider,
      cep: cepService,
      findByTracking: (code) => findByTracking(repository, code),
    },
    options,
  );
}
