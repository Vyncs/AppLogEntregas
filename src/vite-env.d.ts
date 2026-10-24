/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Geocodificação pelo Google (sem ela, TomTom ou OpenStreetMap/Nominatim) */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** Geocodificação pelo TomTom: grátis, sem cartão (2.500 consultas/dia) */
  readonly VITE_TOMTOM_API_KEY?: string;
  /** Tempos de viagem pelo OpenRouteService (sem ela, servidor de demonstração do OSRM) */
  readonly VITE_ORS_API_KEY?: string;
  /** OSRM próprio, se houver (padrão: servidor de demonstração) */
  readonly VITE_OSRM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
