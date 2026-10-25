import type { RouteApi } from '../../hooks/useRoute';
import { formatDistance, formatDuration } from '../../services/routing/navigation';
import type { PlannedStop } from '../../services/routing/planner';
import type { DeliveryPackage } from '../../types/package';

interface RouteSummaryProps {
  route: RouteApi;
  /** Paradas da rota, já sem as retiradas */
  stops: PlannedStop[];
  byId: Map<string, DeliveryPackage>;
}

/**
 * O que falta da rota, numa linha: paradas pendentes, distância e tempo dos
 * trechos até elas. Cada entregue ou problema tira a parada da conta na hora.
 * Só avisa quando o serviço de rotas falhou — aí a ordem saiu da linha reta e
 * vale recalcular.
 */
export function RouteSummary({ route, stops, byId }: RouteSummaryProps) {
  const { saved } = route;
  const left = stops.filter((s) => byId.get(s.packageId)?.status === 'pending');
  const seconds = left.reduce((sum, s) => sum + s.legSeconds, 0);
  const meters = left.every((s) => s.legMeters !== null) ? left.reduce((sum, s) => sum + (s.legMeters ?? 0), 0) : null;

  return (
    <section className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200" aria-label="Resumo da rota">
      <p className="text-lg font-bold">
        {left.length === 0 ? (
          'Todas as paradas resolvidas'
        ) : (
          <>
            {left.length} {left.length === 1 ? 'parada' : 'paradas'}
            {meters !== null && ` · ${formatDistance(meters)}`} · ~{formatDuration(seconds)}
          </>
        )}
      </p>
      {saved.fellBack && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          {saved.fallbackReason && saved.fallbackReason !== 'Serviço de rotas indisponível no momento.'
            ? `${saved.fallbackReason} Enquanto isso, a ordem saiu da distância em linha reta, menos precisa.`
            : 'O serviço de rotas não respondeu: a ordem saiu da distância em linha reta, menos precisa. Recalcule quando houver internet.'}
        </p>
      )}
    </section>
  );
}
