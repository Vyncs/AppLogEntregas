import { useMemo, useState } from 'react';
import { CaptureScreen } from './components/CaptureScreen';
import { EditPackageScreen } from './components/EditPackageScreen';
import { HomeScreen } from './components/HomeScreen';
import { DeliveryMode } from './components/route/DeliveryMode';
import { RouteScreen } from './components/route/RouteScreen';
import { usePackages } from './hooks/usePackages';
import { useRoute } from './hooks/useRoute';
import { routeProgress } from './services/routing/navigation';

type Screen = 'home' | 'capture' | 'route' | 'deliver';

export default function App() {
  const packagesApi = usePackages();
  const route = useRoute(packagesApi);
  const [screen, setScreen] = useState<Screen>('home');
  const [editing, setEditing] = useState<{ id: string; back: Screen } | null>(null);
  /** Parada aberta nas entregas: sobrevive à ida para Editar e volta */
  const [deliverAt, setDeliverAt] = useState<string | null>(null);

  const progress = useMemo(() => {
    const plan = route.saved.plan;
    if (!plan) return null;
    const p = routeProgress(plan, new Map(packagesApi.packages.map((pkg) => [pkg.id, pkg])), route.excludedSet);
    return p.total > 0 ? { done: p.done, total: p.total } : null;
  }, [route.saved.plan, route.excludedSet, packagesApi.packages]);

  const edit = (id: string) => setEditing({ id, back: screen });

  /** Entrar nas entregas começa pela próxima pendente. */
  const deliver = () => {
    setDeliverAt(null);
    setScreen('deliver');
  };

  /** Fim do dia: apaga as encomendas (todas ou só as entregues) e a rota calculada; a partida fica. */
  const clearDay = async (onlyDelivered: boolean) => {
    const ids = packagesApi.packages.filter((p) => !onlyDelivered || p.status === 'delivered').map((p) => p.id);
    await packagesApi.remove(ids);
    route.clear();
  };

  if (editing) {
    const pkg = packagesApi.packages.find((p) => p.id === editing.id);
    if (pkg) {
      return (
        <EditPackageScreen
          key={pkg.id}
          pkg={pkg}
          packagesApi={packagesApi}
          onClose={() => {
            setScreen(editing.back);
            setEditing(null);
          }}
        />
      );
    }
  }

  switch (screen) {
    case 'capture':
      return <CaptureScreen packagesApi={packagesApi} onClose={() => setScreen('home')} />;
    case 'route':
      return (
        <RouteScreen
          packagesApi={packagesApi}
          route={route}
          onBack={() => setScreen('home')}
          onDeliver={deliver}
          onEdit={edit}
        />
      );
    case 'deliver':
      return (
        <DeliveryMode
          packagesApi={packagesApi}
          route={route}
          at={deliverAt}
          onAt={setDeliverAt}
          onBack={() => setScreen('route')}
          onEdit={edit}
        />
      );
    default:
      return (
        <HomeScreen
          packagesApi={packagesApi}
          onCapture={() => setScreen('capture')}
          onRoute={() => setScreen('route')}
          onEdit={edit}
          routeProgress={progress}
          onContinue={deliver}
          onClearDay={clearDay}
        />
      );
  }
}
