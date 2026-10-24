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
  fireEvent.click(await screen.findByRole('button', { name: 'Digitar sem foto' }));
  type('Destinatário', nome);
  type('CEP', '06454000');
  await waitFor(() => expect((screen.getByLabelText('Logradouro') as HTMLInputElement).value).toBe('Rua das Flores'));
  type('Número', numero);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar encomenda' }));
  // Salvou quando volta ao início da captura (o aviso da anterior ainda pode estar na tela)
  await screen.findByRole('button', { name: 'Digitar sem foto' });
  expect(screen.getByText('✓ Encomenda salva')).toBeTruthy();
};

describe('Rota Fácil — cadastro e entrega', () => {
  it('cadastra digitando, completa pelo CEP, lista e marca como entregue', async () => {
    render(<App />);
    expect(await screen.findByText('Nenhuma encomenda ainda.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Fotografar etiqueta/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Digitar sem foto' }));

    type('Destinatário', 'Maria Exemplo');
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
    expect(within(card).getByText('Pendente')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'Entregue' }));
    await waitFor(() => expect(within(card).getByText('Entregue', { selector: 'span' })).toBeTruthy());
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('não salva com campos obrigatórios vazios e aponta o erro', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Fotografar etiqueta/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Digitar sem foto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar encomenda' }));
    expect(await screen.findByText('Informe o destinatário.')).toBeTruthy();
    expect(screen.getByText('Informe o número (ou S/N).')).toBeTruthy();
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

    // Ponto de partida: casa no número 1
    fireEvent.click(await screen.findByRole('button', { name: 'Rota do dia' }));
    type('Endereço de partida', 'Rua das Flores 1, Barueri');
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Rua das Flores 1, Barueri/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Calcular rota \(3\)/ }));
    const ordem = await screen.findByRole('list', { name: 'Ordem das entregas' });
    const nomes = within(ordem)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('p')?.textContent);
    expect(nomes).toEqual(['Cliente Dez', 'Cliente Vinte', 'Cliente Trinta']);
    expect(screen.getByText(/terminando na última entrega/)).toBeTruthy();

    // Entregas: uma parada por vez, com o Google Maps nas coordenadas da parada
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar entregas' }));
    expect(await screen.findByText('Parada 1 de 3')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cliente Dez' })).toBeTruthy();
    // O Maps recebe o endereço (ele acha o número da casa), não o ponto aproximado
    expect(screen.getByRole('link', { name: 'Abrir no Google Maps' }).getAttribute('href')).toContain(
      `destination=${encodeURIComponent('Rua das Flores, 10, Barueri - SP, 06454-000')}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Entregue' }));
    expect(await screen.findByRole('heading', { name: 'Cliente Vinte' })).toBeTruthy();
    expect(screen.getByText('Parada 2 de 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pular para depois' }));
    expect(await screen.findByRole('heading', { name: 'Cliente Trinta' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Apagar o dia…' }));
    fireEvent.click(screen.getByRole('button', { name: /Apagar só as entregues/ }));
    await waitFor(() => expect(screen.queryByText('Cliente Entregue')).toBeNull());
    expect(screen.getByText('Cliente Amanhã')).toBeTruthy();
    expect(screen.queryByText('Continuar entregas')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Apagar o dia…' }));
    fireEvent.click(screen.getByRole('button', { name: /Apagar todas/ }));
    expect(await screen.findByText('Nenhuma encomenda ainda.')).toBeTruthy();
  });
});
