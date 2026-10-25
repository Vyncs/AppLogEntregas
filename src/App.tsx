import { useCallback, useRef, useState } from 'react';
import { CaptureScreen } from './components/CaptureScreen';
import { EditPackageScreen } from './components/EditPackageScreen';
import { HomeScreen } from './components/HomeScreen';
import { DeliveryMode } from './components/route/DeliveryMode';
import { usePackages } from './hooks/usePackages';
import { useRoute } from './hooks/useRoute';
import { useRememberScroll, useScrollReset } from './hooks/useScrollReset';

type Screen = 'home' | 'capture' | 'deliver';

export default function App() {
  const packagesApi = usePackages();
  const route = useRoute(packagesApi);
  const [screen, setScreen] = useState<Screen>('home');
  const [editing, setEditing] = useState<{ id: string; back: Screen } | null>(null);
  /** Parada aberta nas entregas: sobrevive à ida para Editar e volta */
  const [deliverAt, setDeliverAt] = useState<string | null>(null);

  // Entrar numa tela começa no topo; voltar para a lista devolve onde ela estava
  const view = editing ? `edit:${editing.id}` : screen;
  const homeScroll = useRef(0);
  const saveHome = useCallback((y: number) => (homeScroll.current = y), []);
  useRememberScroll(view === 'home', saveHome);
  useScrollReset(
    view,
    useCallback((key: string) => (key === 'home' ? homeScroll.current : undefined), []),
  );

  const edit = (id: string) => setEditing({ id, back: screen });

  /** Entrar nas entregas começa pela próxima pendente (ou pela parada tocada no mapa). */
  const deliver = (at?: string) => {
    setDeliverAt(at ?? null);
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
    case 'deliver':
      return (
        <DeliveryMode
          packagesApi={packagesApi}
          route={route}
          at={deliverAt}
          onAt={setDeliverAt}
          onBack={() => setScreen('home')}
          onEdit={edit}
        />
      );
    default:
      return (
        <HomeScreen
          packagesApi={packagesApi}
          route={route}
          onCapture={() => setScreen('capture')}
          onEdit={edit}
          onDeliver={deliver}
          onClearDay={clearDay}
        />
      );
  }
}
