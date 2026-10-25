// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

// Fluxo completo da interface com dados FICTÍCIOS. ViaCEP, OpenStreetMap
// (Nominatim) e OSRM simulados: o número da casa vira a longitude, então dá
// para saber a ordem certa da rota.
const json = (body: unknown) => new Response(JSON.stringify(body));

beforeEach(() => {
  // O jsdom não rola a página: espião no lugar
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'viacep.com.br') {
        return json({ cep: '06454-000', logradouro: 'Rua das Flores', bairro: 'Centro Fictício', localidade: 'Barueri', uf: 'SP' });
      }
      if (url.hostname === 'nominatim.openstreetmap.org') {
        const text = url.searchParams.get('street') ?? url.searchParams.get('q') ?? '';
        const n = Number(/(\d+)/.exec(text)?.[1] ?? 0);
        return json([
          {
            lat: '-23.5',
            lon: String(-46.9 + n * 0.0001),
            display_name: `${text}, Barueri`,
            category: 'building',
            addresstype: 'building',
            address: { house_number: String(n), city: 'Barueri' },
          },
        ]);
      }
      if (url.hostname === 'router.project-osrm.org') {
        const lngs = url.pathname.split('/').pop()!.split(';').map((c) => Number(c.split(',')[0]));
        const src = url.searchParams.get('sources')!.split(';').map(Number);
        const dst = url.searchParams.get('destinations')!.split(';').map(Number);
        const t = (a: number, b: number) => Math.abs(lngs[a] - lngs[b]) * 100_000;
        return json({ code: 'Ok', durations: src.map((a) => dst.map((b) => t(a, b))), distances: src.map((a) => dst.map((b) => t(a, b) * 10)) });
      }
      throw new Error(`requisição inesperada: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Na tela de fotografar: cadastra digitando, na rua fictícia do CEP simulado. */
const register = async (nome: string, numero: string) => {
  // Os campos já vêm abertos: endereço primeiro, destinatário por último
  type('CEP', '06454000');
  await waitFor(() => expect((screen.getByLabelText('Logradouro') as HTMLInputElement).value).toBe('Rua das Flores'));
  type('Número', numero);
  type('Destinatário (opcional)', nome);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar encomenda' }));
  // Salvou quando o formulário volta em branco
  await waitFor(() => expect((screen.getByLabelText('Destinatário (opcional)') as HTMLInputElement).value).toBe(''));
  expect(screen.getByText('✓ Encomenda salva')).toBeTruthy();
};

describe('Rota Fácil — cadastro e entrega', () => {
  it('cadastra digitando, completa pelo CEP, lista e marca como entregue', async () => {
    render(<App />);
    expect(await screen.findByText('Nenhuma encomenda ainda.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Fotografar etiqueta/ }));
    // Câmera e galeria em cima; os campos para digitar já abertos logo abaixo
    expect(screen.getByRole('button', { name: 'Tirar foto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Escolher da galeria' })).toBeTruthy();
    expect(screen.queryByText(/Fotografe a etiqueta de frente/)).toBeNull();
    const ids = [...document.querySelectorAll('form input[id^="campo-"]')].map((el) => el.id);
    expect(ids.slice(0, 3)).toEqual(['campo-cep', 'campo-street', 'campo-number']);
    expect(ids.at(-1)).toBe('campo-recipientName');
    const camera = screen.getByRole('button', { name: 'Tirar foto' });
    expect(camera.compareDocumentPosition(screen.getByLabelText('CEP')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    type('Destinatário (opcional)', 'Maria Exemplo');
    type('CEP', '06454000');
    // O CEP completo dispara a consulta e preenche rua, bairro, cidade e UF
    await waitFor(() => expect((screen.getByLabelText('Logradouro') as HTMLInputElement).value).toBe('Rua das Flores'));
    expect((screen.getByLabelText('Cidade') as HTMLInputElement).value).toBe('Barueri');
    expect(screen.getByText('CEP conferido no ViaCEP.')).toBeTruthy();

    type('Número', '539');
    type('Complemento', 'Apto 14');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar encomenda' }));
    expect(await screen.findByText('✓ Encomenda salva')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as encomendas' }));
    const card = (await screen.findByText('Maria Exemplo')).closest('li') as HTMLElement;
    expect(within(card).getByText('Rua das Flores, 539 — Apto 14')).toBeTruthy();
    // Mesmo card da rota, antes de calcular: Maps já abre (o Maps parte de onde o celular está)
    expect(within(card).getByRole('link', { name: /Maps/ }).getAttribute('href')).toContain('destination=');
    expect(within(card).getByRole('button', { name: 'Problema' })).toBeTruthy();
    // Sem rota: entregas e mapa desligados, cálculo disponível depois da partida
    expect((screen.getByRole('button', { name: 'Iniciar entregas' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ver mapa da rota' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(card).getByRole('button', { name: 'Entregue' }));
    await waitFor(() => expect(within(card).getByText('Entregue', { selector: 'span' })).toBeTruthy());
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('não salva com campos obrigatórios vazios e aponta o erro', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Fotografar etiqueta/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar encomenda' }));
    expect(await screen.findByText('Informe o número (ou S/N).')).toBeTruthy();
    // O destinatário é opcional: nunca bloqueia o cadastro
    expect(screen.queryByText('Informe o destinatário.')).toBeNull();
  });

  it('monta a rota a partir de casa, na ordem certa, e conduz as entregas parada a parada', async () => {
    render(<App />);

    // Três entregas cadastradas fora de ordem: números 30, 10 e 20 da mesma rua
    fireEvent.click(await screen.findByRole('button', { name: /Fotografar etiqueta/ }));
    for (const [nome, numero] of [
      ['Cliente Trinta', '30'],
      ['Cliente Dez', '10'],
      ['Cliente Vinte', '20'],
    ]) {
      await register(nome, numero);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as encomendas' }));

    // Ponto de partida, no alto da lista: casa no número 1
    type('Endereço de partida', 'Rua das Flores 1, Barueri');
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Rua das Flores 1, Barueri/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Calcular rota' }));
    const ordem = await screen.findByRole('list', { name: 'Ordem das entregas' });
    // O endereço vem primeiro no card; o nome logo abaixo
    const paradas = within(ordem).getAllByRole('listitem');
    expect(paradas.map((li) => li.querySelector('p')?.textContent)).toEqual([
      'Rua das Flores, 10',
      'Rua das Flores, 20',
      'Rua das Flores, 30',
    ]);
    expect(paradas.map((li) => li.querySelectorAll('p')[1]?.textContent)).toEqual(['Cliente Dez', 'Cliente Vinte', 'Cliente Trinta']);
    // O resumo da rota fica nas entregas, não na lista
    expect(screen.queryByRole('region', { name: 'Resumo da rota' })).toBeNull();

    // Entregas: uma parada por vez, com o Google Maps nas coordenadas da parada
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar entregas' }));
    expect(await screen.findByText('Parada 1 de 3')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Resumo da rota' })).getByText(/terminando na última entrega, rua a rua/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rua das Flores, 10' })).toBeTruthy();
    // O Maps recebe o endereço (ele acha o número da casa), não o ponto aproximado
    expect(screen.getByRole('link', { name: 'Abrir no Google Maps' }).getAttribute('href')).toContain(
      `destination=${encodeURIComponent('Rua das Flores, 10, Barueri - SP, 06454-000')}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Entregue' }));
    expect(await screen.findByRole('heading', { name: 'Rua das Flores, 20' })).toBeTruthy();
    expect(screen.getByText('Parada 2 de 3')).toBeTruthy();

    // Sem "Pular": as setas avançam e voltam pelas paradas
    fireEvent.click(screen.getByRole('button', { name: 'Próxima parada' }));
    expect(await screen.findByRole('heading', { name: 'Rua das Flores, 30' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pular para depois' })).toBeNull();

    // Problema por engano: segue para a pendente que sobrou; a seta volta nela e desfaz
    fireEvent.click(screen.getByRole('button', { name: 'Problema' }));
    // Pede a justificativa: "Outro" exige a observação; cancelar não marca nada
    const motivo = screen.getByRole('dialog', { name: 'Qual foi o problema?' });
    fireEvent.click(within(motivo).getByRole('radio', { name: 'Outro' }));
    expect((within(motivo).getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(motivo).getByRole('radio', { name: 'Destinatário ausente' }));
    fireEvent.change(within(motivo).getByLabelText(/Observação/), { target: { value: 'portão trancado' } });
    fireEvent.click(within(motivo).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('heading', { name: 'Rua das Flores, 20' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima parada' }));
    expect(await screen.findByRole('heading', { name: 'Rua das Flores, 30' })).toBeTruthy();
    expect(screen.getByText('Com problema')).toBeTruthy();
    expect(screen.getByText('Destinatário ausente — portão trancado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para pendente' }));
    expect(await screen.findByRole('button', { name: 'Problema' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rua das Flores, 30' })).toBeTruthy();

    // Editar e voltar mantém a parada aberta
    fireEvent.click(screen.getByRole('button', { name: 'Parada anterior' }));
    expect(await screen.findByRole('heading', { name: 'Rua das Flores, 20' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar sem salvar' }));
    expect(await screen.findByRole('heading', { name: 'Rua das Flores, 20' })).toBeTruthy();

    // Na lista principal, na ordem da rota: Maps, Entregue e desfazer sem abrir as entregas
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));
    const lista = await screen.findByRole('list', { name: 'Ordem das entregas' });
    const trinta = within(lista).getByText('Cliente Trinta').closest('li') as HTMLElement;
    expect(within(trinta).getByRole('link', { name: 'Maps' }).getAttribute('href')).toContain('destination=');
    fireEvent.click(within(trinta).getByRole('button', { name: 'Entregue' }));
    fireEvent.click(await within(trinta).findByRole('button', { name: 'Voltar para pendente' }));
    // Retirar pede confirmação; cancelar mantém na rota, confirmar leva para "Retiradas da rota"
    fireEvent.click(await within(trinta).findByRole('button', { name: 'Retirar' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Retirar da rota?' })).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(within(trinta).getByRole('button', { name: 'Retirar' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Retirar' }));
    const retiradas = await screen.findByRole('region', { name: 'Retiradas da rota' });
    expect(within(retiradas).getByText(/Cliente Trinta/)).toBeTruthy();
  });

  it('exclui uma encomenda e apaga o dia: só as entregues, depois todas, levando a rota junto', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Fotografar etiqueta/ }));
    for (const [nome, numero] of [
      ['Cliente Engano', '40'],
      ['Cliente Entregue', '50'],
      ['Cliente Amanhã', '60'],
    ]) {
      await register(nome, numero);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as encomendas' }));

    // Cadastrada por engano: sai pela tela de edição, com confirmação
    const engano = (await screen.findByText('Cliente Engano')).closest('li') as HTMLElement;
    fireEvent.click(within(engano).getByRole('button', { name: 'Editar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir de vez' }));
    const entregue = (await screen.findByText('Cliente Entregue')).closest('li') as HTMLElement;
    expect(screen.queryByText('Cliente Engano')).toBeNull();

    fireEvent.click(within(entregue).getByRole('button', { name: 'Entregue' }));
    await waitFor(() => expect(within(entregue).getByText('Entregue', { selector: 'span' })).toBeTruthy());

    // Fim do dia guardando a pendente para amanhã; a rota calculada vai junto
    fireEvent.click(screen.getByRole('button', { name: 'APAGAR TUDO' }));
    fireEvent.click(screen.getByRole('button', { name: /Apagar só as entregues/ }));
    await waitFor(() => expect(screen.queryByText('Cliente Entregue')).toBeNull());
    expect(screen.getByText('Cliente Amanhã')).toBeTruthy();
    expect(screen.queryByText('Continuar entregas')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'APAGAR TUDO' }));
    fireEvent.click(screen.getByRole('button', { name: /Apagar todas/ }));
    expect(await screen.findByText('Nenhuma encomenda ainda.')).toBeTruthy();
  });

  it('avisa quando há mais de uma encomenda no mesmo endereço e entrega as duas da mesma parada', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Fotografar etiqueta/ }));
    await register('Cliente Ana', '70');
    await register('Cliente Bia', '70');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as encomendas' }));

    // A partida fica salva entre os testes (mesmo banco): só define se ainda não houver
    await screen.findByRole('region', { name: 'Ponto de partida' });
    if (screen.queryByLabelText('Endereço de partida')) {
      type('Endereço de partida', 'Rua das Flores 1, Barueri');
      fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
      fireEvent.click(await screen.findByRole('button', { name: /Rua das Flores 1, Barueri/ }));
    }
    // Partida numa linha: lápis e engrenagem abrem modais
    fireEvent.click(screen.getByRole('button', { name: 'Opções da rota' }));
    const opcoes = screen.getByRole('dialog', { name: 'Opções da rota' });
    expect((within(opcoes).getByRole('checkbox', { name: /Organizar por ruas/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(opcoes).getByRole('checkbox', { name: /Voltar ao ponto de partida/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(opcoes).getByRole('button', { name: 'Pronto' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alterar a partida' }));
    expect(within(screen.getByRole('dialog', { name: 'Ponto de partida' })).getByLabelText('Endereço de partida')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Calcular rota' }));
    await screen.findByRole('list', { name: 'Ordem das entregas' });
    expect(screen.getAllByText('📦 2 encomendas neste endereço')).toHaveLength(2);

    // Tocar no card abre as entregas já naquela parada, na ordem da rota
    fireEvent.click(screen.getByRole('button', { name: /Abrir a parada 2:/ }));
    expect(await screen.findByText('Parada 2 de 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Parada anterior' }));
    expect(await screen.findByText('Parada 1 de 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar entregas' }));
    const aviso = await screen.findByRole('region', { name: 'Mesmo endereço' });
    expect(within(aviso).getByText(/Mais 1 encomenda neste endereço/)).toBeTruthy();
    const outra = within(aviso).getByRole('button', { name: /Marcar Cliente (Ana|Bia) como entregue/ });
    fireEvent.click(outra);
    expect(await within(aviso).findByText('Entregue')).toBeTruthy();
  });

  it('entrar numa tela começa do topo; voltar para a lista devolve onde ela estava', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /Fotografar etiqueta/ });
    const scrollTo = window.scrollTo as unknown as ReturnType<typeof vi.fn>;

    // Rolou a lista até 640 px
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
    fireEvent.scroll(window);

    fireEvent.click(screen.getByRole('button', { name: /Fotografar etiqueta/ }));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    fireEvent.click(await screen.findByRole('button', { name: 'Voltar para as encomendas' }));
    await screen.findByRole('button', { name: /Fotografar etiqueta/ });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
