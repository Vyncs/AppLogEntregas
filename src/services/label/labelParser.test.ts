import { describe, expect, it } from 'vitest';
import { cleanName, isCompleteLabel, joinLines, mergeSplitCeps, parseAddress, parseLabelText, scoreLabel } from './labelParser';

// Todas as etiquetas abaixo são FICTÍCIAS: nomes, endereços e códigos inventados.

const IMILE = `TikTok Shop
06454-000
iMile  1-SP2-SB58-114  SVT  D2D
IM2024000012345BR
TO Maria Exemplo da Silva
Apto 14, Condomínio Jardim Exem
plo Rua das Flores 539 Barueri, São
Paulo, 06454-000
Remetente: Loja Fictícia LTDA
Rua do Comércio 100, Sala 2 São Paulo,
São Paulo, 01001-000`;

const SENDER_FIRST_UPPERCASE = `REMETENTE
LOJA EXEMPLO
AV PAULISTA 1000 SAO PAULO, SP, 01310-100
TIKTOK SHOP 04567-890
TO
JOAO FICTICIO SOUZA
BLOCO B APTO 22, CONDOMI
NIO RESIDENCIAL AURORA
AVENIDA BRASIL, 1234, CAMPINAS,
SP, 13010-000`;

describe('parseLabelText — etiqueta iMile', () => {
  const label = parseLabelText(IMILE);

  it('lê o destinatário do bloco "TO"', () => {
    expect(label.recipientName.value).toBe('Maria Exemplo da Silva');
  });

  it('separa o complemento que vem antes do logradouro', () => {
    expect(label.address.street.value).toBe('Rua das Flores');
    expect(label.address.number.value).toBe('539');
    expect(label.address.complement.value).toBe('Apto 14, Condomínio Jardim Exemplo');
    expect(label.address.city.value).toBe('Barueri');
    expect(label.address.state.value).toBe('SP');
  });

  it('usa o CEP em destaque e confirma com o do endereço', () => {
    expect(label.ceps).toEqual({ large: '06454000', inAddress: '06454000' });
    expect(label.address.cep).toEqual({ value: '06454-000', confidence: 'high' });
  });

  it('nunca usa o endereço nem o CEP do remetente', () => {
    const text = JSON.stringify(label);
    expect(text).not.toContain('Comércio');
    expect(text).not.toContain('01001');
  });

  it('ignora os códigos de triagem e acha o rastreio impresso', () => {
    expect(JSON.stringify(label.address)).not.toMatch(/SB58|SVT|D2D/);
    expect(label.trackingCandidates).toEqual(['IM2024000012345BR']);
  });

  it('número e complemento nunca saem como certos: pedem conferência', () => {
    expect(label.address.number.confidence).not.toBe('high');
    expect(label.address.complement.confidence).not.toBe('high');
  });
});

describe('parseLabelText — remetente antes, caixa alta e "TO" sozinho', () => {
  const label = parseLabelText(SENDER_FIRST_UPPERCASE);

  it('pega o nome na linha seguinte ao "TO"', () => {
    expect(label.recipientName.value).toBe('JOAO FICTICIO SOUZA');
  });

  it('junta palavra quebrada em caixa alta e lê número separado por vírgula', () => {
    expect(label.address.complement.value).toBe('BLOCO B APTO 22, CONDOMINIO RESIDENCIAL AURORA');
    expect(label.address.street.value).toBe('AVENIDA BRASIL');
    expect(label.address.number.value).toBe('1234');
    expect(label.address.city.value).toBe('CAMPINAS');
  });

  it('CEP em destaque diferente do endereço vira conflito, não escolha silenciosa', () => {
    expect(label.ceps).toEqual({ large: '04567890', inAddress: '13010000' });
    expect(label.address.cep.confidence).toBe('low');
    expect(label.warnings.join(' ')).toMatch(/CEP em destaque é diferente/);
  });

  it('não confunde o remetente (Av. Paulista) com o destinatário', () => {
    expect(JSON.stringify(label.address)).not.toMatch(/PAULISTA|01310/);
  });
});

/**
 * Saída REAL do Tesseract (por) para uma etiqueta fictícia desenhada no layout
 * iMile: o ícone redondo "TO" some, o logo e o CEP grande saem na mesma linha.
 */
const TESSERACT_REAL = `TikTok Shop 06454-000
iMile 1-SP2-SB58-114 SVT D2D
IM2024000012345BR
Maria Exemplo da Silva
Apto 14, Condomínio Jardim Exem
plo Rua das Flores 539 Barueri, São
Paulo, 06454-000
Remetente: Loja Fictícia LTDA
Rua do Comércio 100, Sala 2 São Paulo,
São Paulo, 01001-000
`;

describe('parseLabelText — texto real do Tesseract (o "TO" se perde)', () => {
  const label = parseLabelText(TESSERACT_REAL);

  it('acha o nome subindo do endereço até o rastreio', () => {
    expect(label.recipientName).toEqual({ value: 'Maria Exemplo da Silva', confidence: 'medium' });
  });

  it('lê o endereço inteiro e o CEP do logo', () => {
    expect(label.address.street.value).toBe('Rua das Flores');
    expect(label.address.number.value).toBe('539');
    expect(label.address.complement.value).toBe('Apto 14, Condomínio Jardim Exemplo');
    expect(label.address.cep).toEqual({ value: '06454-000', confidence: 'high' });
    expect(label.trackingCandidates).toEqual(['IM2024000012345BR']);
  });

  it('junta o rastreio impresso que o OCR partiu com um espaço', () => {
    const partido = parseLabelText(TESSERACT_REAL.replace('IM2024000012345BR', 'IM202400001 2345BR'));
    expect(partido.trackingCandidates[0]).toBe('IM2024000012345BR');
  });

  it('para no logo quando não há rastreio entre ele e o nome', () => {
    const semRastreio = parseLabelText(TESSERACT_REAL.replace('IM2024000012345BR\n', ''));
    expect(semRastreio.recipientName.value).toBe('Maria Exemplo da Silva');
  });
});

/**
 * Mesma ESTRUTURA do que o Tesseract leu de uma etiqueta real (dados trocados
 * por fictícios): só o bloco do destinatário fotografado, o "TO" branco no
 * círculo preto lido como "Õ"/"ÕÔ", a palavra e o CEP partidos entre linhas.
 */
const RECORTE_1X = `|   Õ  JoaoFicticio
casa Azul, Vila Exemplo Rua Imagina

ção 77, Guarujá, São Paulo, 12345
080
`;
const RECORTE_2X = RECORTE_1X.replace('Õ', 'ÕÔ').replace('\n080', '\nD80');

describe('parseLabelText — recorte do destinatário (estrutura de etiqueta real)', () => {
  for (const [nome, texto] of [
    ['1x', RECORTE_1X],
    ['2x', RECORTE_2X],
  ] as const) {
    it(`${nome}: entende o "TO" lido como Õ, a palavra e o CEP partidos`, () => {
      const label = parseLabelText(texto);
      expect(label.recipientName.value).toBe('JoaoFicticio');
      expect(label.address.street.value).toBe('Rua Imaginação');
      expect(label.address.number.value).toBe('77');
      expect(label.address.complement.value).toBe('casa Azul, Vila Exemplo');
      expect(label.address.city.value).toBe('Guarujá');
      expect(label.address.state.value).toBe('SP');
      expect(label.address.cep.value).toBe('12345-080');
    });
  }

  it('sem CEP e sem "TO": ancora na linha "Rua … número"', () => {
    const label = parseLabelText('Maria Teste\nRua Alfa 10 Apto 2\nItu SP');
    expect(label.recipientName.value).toBe('Maria Teste');
    expect(label.address.street.value).toBe('Rua Alfa');
    expect(label.address.number.value).toBe('10');
  });

  it('não confunde nome que começa com "To…" ou "O…" com o marcador', () => {
    expect(parseLabelText('TO Tomás Ficticio\nRua Beta 5 Itu, SP, 13300-000').recipientName.value).toBe('Tomás Ficticio');
    expect(parseLabelText('Otávio Ficticio\nRua Beta 5 Itu, SP, 13300-000').recipientName.value).toBe('Otávio Ficticio');
  });
});

/**
 * Mesma ESTRUTURA do que o Tesseract leu do recorte de uma etiqueta iMile
 * inteira fotografada sobre o saco (dados trocados por fictícios): remetente
 * mascarado, coluna da direita misturada ("S V", "| ProkuP"), o "TO" lido como
 * "fo)" ou "o", palavras e CEP partidos, rastreio impresso pela metade.
 */
const ETIQUETA_INTEIRA = `|                   Remetente                                       S V
G*A S""AP"*A

Vila Exemplo Rua General Ficticio 377, São Paulo, São Pa

ulo, 01001000

fo) maria ficticia
ponto comercial, Bairro Teste Rua Ex

emplo 98, Guarujá, São Paulo, 11
400000

e

d TikTok Shop 11400000 | ProkuP
Peso

ET

201                              É
Site: www.imile. oe 24233453             345.
`;

describe('parseLabelText — etiqueta inteira recortada (estrutura real)', () => {
  for (const [nome, texto] of [
    ['"fo)"', ETIQUETA_INTEIRA],
    ['"o"', ETIQUETA_INTEIRA.replace('fo) maria', 'o maria')],
  ] as const) {
    it(`marcador lido como ${nome}: nome limpo e endereço do destinatário`, () => {
      const label = parseLabelText(texto);
      expect(label.recipientName).toEqual({ value: 'maria ficticia', confidence: 'medium' });
      expect(label.address.street.value).toBe('Rua Exemplo');
      expect(label.address.number.value).toBe('98');
      expect(label.address.complement.value).toBe('ponto comercial, Bairro Teste');
      expect(label.address.city.value).toBe('Guarujá');
      expect(label.address.state.value).toBe('SP');
    });
  }

  it('acha o CEP do logo mesmo com a coluna da direita na linha, e confirma com o do endereço', () => {
    const label = parseLabelText(ETIQUETA_INTEIRA);
    expect(label.ceps).toEqual({ large: '11400000', inAddress: '11400000' });
    expect(label.address.cep).toEqual({ value: '11400-000', confidence: 'high' });
  });

  it('não usa nada do remetente e não inventa rastreio com o texto do logo', () => {
    const label = parseLabelText(ETIQUETA_INTEIRA);
    expect(JSON.stringify(label.address)).not.toMatch(/General|01001/);
    expect(label.trackingCandidates).toEqual([]);
  });

  it('o rastreio impresso duas vezes vem antes do Nº de Ref', () => {
    const label = parseLabelText(
      `Nº de Ref: 3459700000000000237 Data de envio: 2026-10-20 18:40\n3320100000453\n${ETIQUETA_INTEIRA}\n3320100000453`,
    );
    expect(label.trackingCandidates).toEqual(['3320100000453']);
  });

  it('"10" só é o marcador quando o resto da linha é um nome', () => {
    expect(parseLabelText('10 Ana Ficticia\nRua Beta 5 Itu, SP, 13300-000').recipientName.value).toBe('Ana Ficticia');
    const quebrado = parseLabelText('Bia Ficticia\nRua Beta\n10 Itu, SP, 13300-000');
    expect(quebrado.recipientName.value).toBe('Bia Ficticia');
  });
});

describe('remetente com OCR ruim', () => {
  it('"Remetenle" ainda separa o bloco do remetente', () => {
    const label = parseLabelText(ETIQUETA_INTEIRA.replace('Remetente', 'Remetenle'));
    expect(JSON.stringify(label.address)).not.toMatch(/General|01001/);
  });

  it('sem rótulo nem "TO", o CEP do logo aponta o destinatário, não o remetente', () => {
    const semRotulos = ETIQUETA_INTEIRA.replace('Remetente', 'Rmtnt').replace('fo) maria', 'maria');
    const label = parseLabelText(semRotulos);
    expect(label.address.street.value).toBe('Rua Exemplo');
    expect(label.address.cep.value).toBe('11400-000');
  });
});

describe('scoreLabel e isCompleteLabel', () => {
  it('leitura completa ganha da parcial', () => {
    const completa = parseLabelText(ETIQUETA_INTEIRA);
    const parcial = parseLabelText('fo) maria ficticia\nponto comercial');
    expect(scoreLabel(completa)).toBeGreaterThan(scoreLabel(parcial));
    expect(isCompleteLabel(completa)).toBe(true);
    expect(isCompleteLabel(parcial)).toBe(false);
  });
});

describe('mergeSplitCeps', () => {
  it('junta CEP partido em qualquer ponto e corrige letra lida como número', () => {
    expect(mergeSplitCeps(['São Paulo, 12345', '080'])).toEqual(['São Paulo, 12345-080']);
    expect(mergeSplitCeps(['SP, 12345-', '080'])).toEqual(['SP, 12345-080']);
    expect(mergeSplitCeps(['SP, 1234', '5-080 Remetente'])).toEqual(['SP, 12345-080', 'Remetente']);
    expect(mergeSplitCeps(['SP, 12345', 'D80'])).toEqual(['SP, 12345-080']);
  });

  it('não junta números que não formam um CEP', () => {
    expect(mergeSplitCeps(['Rua X 100', '200 fundos'])).toEqual(['Rua X 100', '200 fundos']);
    expect(mergeSplitCeps(['TikTok Shop 06454-000', '123'])).toEqual(['TikTok Shop 06454-000', '123']);
  });
});

describe('parseLabelText — CEP com letra no lugar de número', () => {
  it('"13300-D00" é lido como 13300-000', () => {
    expect(parseLabelText('TO Ana Ficticia\nRua Beta 5 Itu, SP, 13300-D00').address.cep.value).toBe('13300-000');
  });
});

describe('parseLabelText — etiqueta sem o marcador "TO"', () => {
  const label = parseLabelText(`Carlos Fictício
Das Palmeiras 77 Fundos Sorocaba, SP, 18000-000`);

  it('usa a linha antes do endereço como nome, pedindo revisão', () => {
    expect(label.recipientName).toEqual({ value: 'Carlos Fictício', confidence: 'medium' });
  });

  it('linha que não parece nome sai com confiança baixa e aviso', () => {
    const odd = parseLabelText(`Ref 2231 caixa
Rua Beta 12 Itu, SP, 13300-000`);
    expect(odd.recipientName.confidence).toBe('low');
    expect(odd.warnings).toContain('Confira o nome do destinatário.');
  });

  it('sem tipo de via, acha o número e deixa o resto para o ViaCEP decidir', () => {
    expect(label.address.street).toEqual({ value: 'Das Palmeiras', confidence: 'low' });
    expect(label.address.number.value).toBe('77');
    expect(label.afterNumber).toBe('Fundos Sorocaba');
  });
});

describe('parseLabelText — leitura ruim', () => {
  it('não inventa campos ausentes', () => {
    const label = parseLabelText('TO Fulano Fictício\nborrão ilegível');
    expect(label.address.cep).toEqual({ value: '', confidence: 'low' });
    expect(label.address.number.value).toBe('');
    expect(label.warnings).toContain('CEP do destinatário não encontrado.');
    expect(label.warnings).toContain('Número do imóvel não encontrado.');
  });

  it('CEP do endereço sozinho na linha não é tratado como o de destaque', () => {
    const label = parseLabelText(`TO Bia Fictícia
Rua Beta 12 Itu, SP,
13300-000`);
    expect(label.ceps).toEqual({ large: null, inAddress: '13300000' });
    expect(label.address.street.value).toBe('Rua Beta');
  });
});

describe('parseAddress', () => {
  it('lê "nº" sem grudar no logradouro e separa complemento depois do número', () => {
    const a = parseAddress('Rua Alfa, nº 45, Casa 2, Jundiaí, SP 13200-000');
    expect(a).toMatchObject({ street: 'Rua Alfa', number: '45', complement: 'Casa 2', city: 'Jundiaí', state: 'SP', cep: '13200000' });
  });

  it('aceita S/N', () => {
    expect(parseAddress('Rua Sem Saída S/N Itu, SP, 13300-000').number).toBe('S/N');
  });

  it('não toma o número do apartamento como número do imóvel', () => {
    const a = parseAddress('Apto 31, Rua Gama 8 Salto, SP, 13320-000');
    expect(a).toMatchObject({ street: 'Rua Gama', number: '8', complement: 'Apto 31' });
  });
});

describe('joinLines', () => {
  it('junta palavra cortada em minúscula e separa palavras inteiras', () => {
    expect(joinLines(['Condomí', 'nio Sol', 'Rua X'])).toBe('Condomínio Sol Rua X');
  });

  it('junta hífen de quebra de linha', () => {
    expect(joinLines(['Residen-', 'cial Lua'])).toBe('Residencial Lua');
  });
});

describe('sujeira do OCR em volta do destinatário (estrutura de etiqueta real, dados fictícios)', () => {
  it('tira símbolos e números do nome e lê "$obrado" como "Sobrado"', () => {
    const label = parseLabelText(`Ana Exemplo Souza [=] [5]
Rua das Flores, 979 $obrado Itu, SP, 13300-000`);
    expect(label.recipientName.value).toBe('Ana Exemplo Souza');
    expect(label.address.number.value).toBe('979');
    expect(label.afterNumber).toBe('Sobrado Itu');
    expect(label.recipientLines).toHaveLength(2);
  });

  it('entende "ro)" como o ícone "TO"', () => {
    const label = parseLabelText(`ro) Ana Exemplo Souza
Rua das Flores, 979 Itu, SP, 13300-000`);
    expect(label.recipientName.value).toBe('Ana Exemplo Souza');
  });

  it('cleanName mantém partículas e apóstrofo', () => {
    expect(cleanName("| Maria d'Ávila da Silva, 12")).toBe("Maria d'Ávila da Silva");
  });
});
