import type { Address, DeliveryPackage, PackageGeo } from '../../types/package';
import { formatCep } from '../label/cep';
import type { PlannedStop, RoutePlan } from './planner';

/**
 * Entregas na ordem da rota. O Google Maps recebe uma parada por vez: um link
 * com dezenas de paradas passa do limite da URL (2.048 caracteres) e o app do
 * Maps não garante a ordem — a ordem é a do Rota Fácil.
 */

export interface RouteProgress {
  /** Paradas da rota (sem as retiradas) */
  total: number;
  /** Já resolvidas: entregues ou com problema */
  done: number;
  /** Próxima parada pendente, na ordem */
  next: PlannedStop | null;
  /** Posição da próxima (1 = primeira) */
  nextNumber: number;
}

export function routeProgress(
  plan: RoutePlan,
  byId: Map<string, DeliveryPackage>,
  excluded: Set<string>,
): RouteProgress {
  const stops = plan.stops.filter((s) => byId.has(s.packageId) && !excluded.has(s.packageId));
  const pendingIndex = stops.findIndex((s) => byId.get(s.packageId)?.status === 'pending');
  return {
    total: stops.length,
    done: stops.filter((s) => byId.get(s.packageId)?.status !== 'pending').length,
    next: pendingIndex >= 0 ? stops[pendingIndex] : null,
    nextNumber: pendingIndex + 1,
  };
}

/** "Pular para depois": a parada vai para o fim da rota. */
export function moveStopToEnd(plan: RoutePlan, packageId: string): RoutePlan {
  const stop = plan.stops.find((s) => s.packageId === packageId);
  if (!stop) return plan;
  return { ...plan, stops: [...plan.stops.filter((s) => s.packageId !== packageId), stop] };
}

/** Encomendas pendentes que não estão no plano (cadastradas depois do cálculo). */
export function newPendingSince(plan: RoutePlan, packages: DeliveryPackage[], excluded: Set<string>): DeliveryPackage[] {
  const planned = new Set(plan.stops.map((s) => s.packageId));
  return packages.filter((p) => p.status === 'pending' && !planned.has(p.id) && !excluded.has(p.id));
}

/**
 * "Rua Exemplo, 98, Guarujá - SP, 11400-000". Sem complemento e sem bairro: o
 * Maps trata o texto como busca, e o bairro dos Correios já casou com o NOME
 * de um estabelecimento homônimo, em outra rua — o Google usa outro nome para
 * o bairro. O CEP já fixa o lugar.
 */
export function addressForMaps(a: Address): string {
  const street = [a.street.trim(), a.number.trim()].filter(Boolean).join(', ');
  const city = [a.city.trim(), a.state.trim()].filter(Boolean).join(' - ');
  return [street, city, a.cep.trim() ? formatCep(a.cep) : ''].filter(Boolean).join(', ');
}

/**
 * Abre a navegação do Google Maps até a parada (partida: onde o celular
 * estiver). Vai o ENDEREÇO, não a coordenada: o Google acha o número da casa
 * sozinho, e a coordenada do OpenStreetMap costuma ser só da rua — com ela, o
 * Maps levava para o endereço mais próximo do ponto (outro número). Com a chave
 * do Google, vai também o identificador do lugar, que garante o lugar exato. A
 * coordenada só é usada quando falta rua ou número.
 */
export function googleMapsDirectionsUrl(address: Address, geo?: PackageGeo | null): string {
  const base = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate';
  const complete = address.street.trim() && address.number.trim() && address.city.trim();
  const place = geo?.placeId ? `&destination_place_id=${encodeURIComponent(geo.placeId)}` : '';
  if (complete || !geo) return `${base}&destination=${encodeURIComponent(addressForMaps(address))}${place}`;
  return `${base}&destination=${geo.location.lat.toFixed(6)},${geo.location.lng.toFixed(6)}${place}`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}
