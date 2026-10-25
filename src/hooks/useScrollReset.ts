import { useLayoutEffect, useRef } from 'react';

/**
 * As telas trocam sem recarregar a página, então a rolagem da tela anterior
 * continuava valendo: rolar a lista e abrir "+ Rota" caía no meio do
 * formulário. Quando `key` muda, a página volta ao topo — ou, se `restore`
 * diz, à posição em que essa tela estava (a lista, ao voltar das entregas).
 */
export function useScrollReset(key: string, restore?: (key: string) => number | undefined) {
  const previous = useRef(key);
  useLayoutEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    window.scrollTo(0, restore?.(key) ?? 0);
  }, [key, restore]);
}

/**
 * Guarda a rolagem de uma tela enquanto ela está aberta, para `useScrollReset`
 * devolver na volta. Em layout effect: o listener sai na mesma troca de tela,
 * antes de a página mais curta "puxar" a rolagem para cima e sobrescrever o valor.
 */
export function useRememberScroll(active: boolean, save: (y: number) => void) {
  useLayoutEffect(() => {
    if (!active) return;
    const onScroll = () => save(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [active, save]);
}
