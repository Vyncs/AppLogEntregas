import type { RouteApi } from '../../hooks/useRoute';
import { formatDistance, formatDuration } from '../../services/routing/navigation';
import { SOURCE_LABEL } from '../../services/routing/types';

interface RouteSummaryProps {
  route: RouteApi;
  stopCount: number;
  /** Paradas localizadas só pela rua, CEP ou cidade */
  approximate: number;
  /** Encomendas novas que ficaram fora desta rota */
  fresh: number;
}

/** Totais da rota e os avisos: tempos estimados, localização aproximada, encomendas novas. */
export function RouteSummary({ route, stopCount, approximate, fresh }: RouteSummaryProps) {
  const { saved, settings } = route;
  const plan = saved.plan!;
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Resumo da rota">
      <p className="text-lg font-bold">
        {stopCount} {stopCount === 1 ? 'parada' : 'paradas'}
        {plan.totalMeters !== null && ` · ${formatDistance(plan.totalMeters)}`} · ~{formatDuration(plan.totalSeconds)}
      </p>
      <p className="text-xs text-slate-500">
        Partindo de {plan.origin.label}
        {plan.returnTo ? ', com volta' : ', terminando na última entrega'}
        {settings.byStreet ? ', rua a rua' : ''}. Tempos: {SOURCE_LABEL[plan.source]} — não considera o trânsito em tempo
        real.
      </p>
      {saved.fellBack && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          {saved.fallbackReason && saved.fallbackReason !== 'Serviço de rotas indisponível no momento.'
            ? `${saved.fallbackReason} Enquanto isso, a ordem saiu da distância em linha reta, menos precisa.`
            : 'O serviço de rotas não respondeu: a ordem saiu da distância em linha reta, menos precisa. Recalcule quando houver internet.'}
        </p>
      )}
      {approximate > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          {approximate === stopCount ? 'Todas as paradas foram localizadas' : `${approximate} de ${stopCount} paradas foram localizadas`} só pela
          rua (o mapa gratuito não tem o número das casas). A navegação no Google Maps vai pelo endereço completo e acerta o
          número.
        </p>
      )}
      {fresh > 0 && (
        <p className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">
          {fresh} {fresh === 1 ? 'encomenda nova ficou' : 'encomendas novas ficaram'} fora desta rota. Recalcule para incluir.
        </p>
      )}
    </section>
  );
}
