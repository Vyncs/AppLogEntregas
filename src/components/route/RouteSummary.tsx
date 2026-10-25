import type { RouteApi } from '../../hooks/useRoute';
import { formatDistance, formatDuration } from '../../services/routing/navigation';

interface RouteSummaryProps {
  route: RouteApi;
  stopCount: number;
}

/**
 * Totais da rota numa linha: paradas, distância e tempo. Só avisa quando o
 * serviço de rotas falhou — aí a ordem saiu da linha reta e vale recalcular.
 */
export function RouteSummary({ route, stopCount }: RouteSummaryProps) {
  const { saved } = route;
  const plan = saved.plan!;
  return (
    <section className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200" aria-label="Resumo da rota">
      <p className="text-lg font-bold">
        {stopCount} {stopCount === 1 ? 'parada' : 'paradas'}
        {plan.totalMeters !== null && ` · ${formatDistance(plan.totalMeters)}`} · ~{formatDuration(plan.totalSeconds)}
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
