import { describe, expect, it, vi } from 'vitest';
import { CepUnavailableError, ViaCepService } from './cepService';
import { formatCep, isValidCepFormat, normalizeCep } from '../label/cep';

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('validação de CEP', () => {
  it('normaliza formatos lidos pelo OCR', () => {
    expect(normalizeCep('06454-000')).toBe('06454000');
    expect(normalizeCep('06454 000')).toBe('06454000');
    expect(normalizeCep('0645-000')).toBeNull();
    expect(formatCep('06454000')).toBe('06454-000');
  });

  it('recusa CEP de dígitos repetidos (borrão lido como zero)', () => {
    expect(isValidCepFormat('00000-000')).toBe(false);
    expect(isValidCepFormat('06454-000')).toBe(true);
  });
});

describe('ViaCepService', () => {
  it('converte a resposta e guarda em cache', async () => {
    const fetchImpl = reply({ cep: '06454-000', logradouro: 'Rua Fictícia', bairro: 'Centro', localidade: 'Barueri', uf: 'SP' });
    const service = new ViaCepService(fetchImpl);
    const first = await service.lookup('06454-000');
    await service.lookup('06454000');
    expect(first).toEqual({ cep: '06454000', street: 'Rua Fictícia', neighborhood: 'Centro', city: 'Barueri', state: 'SP', generic: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('CEP geral da cidade (sem logradouro)', async () => {
    const service = new ViaCepService(reply({ cep: '13300-000', logradouro: '', localidade: 'Itu', uf: 'SP' }));
    expect((await service.lookup('13300000'))?.generic).toBe(true);
  });

  it('"erro: true" é CEP inexistente', async () => {
    expect(await new ViaCepService(reply({ erro: true })).lookup('99999999')).toBeNull();
  });

  it('falha de rede é indisponibilidade, não CEP inválido', async () => {
    const service = new ViaCepService(vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    await expect(service.lookup('06454000')).rejects.toBeInstanceOf(CepUnavailableError);
  });
});
