# Rota Fácil

App web (mobile-first) para entregadores do TikTok Shop: fotografar as etiquetas,
conferir os endereços e organizar as entregas do dia.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes (Vitest)
npm run build      # type-check + build de produção
```

No Windows, rode os comandos no próprio Windows (PowerShell/CMD): as dependências
nativas (esbuild, rollup) são instaladas para a plataforma de quem rodou o `npm install`.

### Testar no celular

```bash
npm run dev -- --host
```

Abra no celular `http://IP-DO-PC:5173` (mesma rede Wi-Fi).

- **Câmera:** abre direto (usa o seletor de arquivo com captura).
- **Código de barras:** a leitura nativa do navegador (`BarcodeDetector`) só existe
  em HTTPS. Por `http://IP` o app usa o ZXing, que também funciona.
- **Primeira leitura:** baixa o leitor de texto em português (~15 MB, do jsDelivr),
  uma vez só. Depois fica em cache no navegador.

## O que já funciona (Etapas 1, 2, 4, 5 e 6)

- **Cadastro por foto, em fila:** tirar foto ou escolher várias da galeria. As
  leituras rodam uma por vez, e você confere a primeira enquanto as próximas
  esperam.
- **Código de barras / QR:** é lido primeiro. Se o rastreio já existe, a encomenda
  existente aparece na hora, com opção de reabrir ou atualizar.
- **OCR (Tesseract.js, no aparelho):**
  - o parser da etiqueta iMile separa o remetente, ignora os códigos de triagem,
    remonta as palavras quebradas entre linhas e entende o complemento que vem
    antes do logradouro;
  - o CEP em destaque tem prioridade e é comparado com o CEP do endereço.
- **ViaCEP:**
  - corrige logradouro, bairro, cidade e UF quando o CEP bate com o texto;
  - mantém a rua lida quando o CEP é geral da cidade;
  - transforma divergência em conflito com sugestão de um toque, nunca em troca
    silenciosa.
- **Revisão:**
  - os campos de baixa confiança ficam destacados; número e complemento sempre
    pedem conferência;
  - campo que não foi lido fica vazio, nada é inventado;
  - um aviso aparece quando o mesmo destinatário e o mesmo endereço já foram
    cadastrados no dia.
- **Lista do dia:** totais, progresso, busca (inclusive por rastreio), filtros e
  ações rápidas (entregue, problema, voltar para pendente), com histórico de status.
  - "Excluir" na edição apaga uma encomenda cadastrada por engano;
  - "APAGAR TUDO" (botão vermelho), no fim da lista, apaga todas as encomendas ou só as
    entregues (as outras ficam para o dia seguinte), junto com a rota calculada.
    O ponto de partida continua salvo. Não tem lixeira: o app pede confirmação.

- **Localização no mapa (Etapa 4):**
  - durante a conferência, o endereço é localizado sozinho, com a precisão
    indicada (no número, na rua, pelo CEP);
  - quando há mais de um lugar possível, você escolhe na lista ou no mapa;
  - o que não for localizado é salvo do mesmo jeito e tentado de novo no
    cálculo da rota, com opção de corrigir o endereço.
- **Rota do dia (Etapa 5), na própria tela principal:**
  - o ponto de partida (endereço ou localização atual) fica no alto da lista, e
    a rota termina na última entrega (voltar para casa é opcional);
  - **por ruas** (padrão): as encomendas da mesma rua saem juntas, na ordem dos
    números, começando pela rua mais perto da partida e seguindo para a mais
    perto de onde a anterior terminou — como os pacotes ficam separados no
    carro. Dá para desligar e usar a ordem mais rápida;
  - a lista do dia aparece na ordem da rota, com Recalcular, Mapa e Iniciar
    entregas embaixo;
  - **Mapa:** abre em tela cheia, um círculo numerado por parada (as do mesmo
    ponto viram um círculo com "+N"); tocar mostra a parada com Entregue,
    Problema, Maps e Abrir parada;
  - os tempos são pelas ruas, considerando mão única;
  - mostra a sequência numerada, o tempo e a distância de cada trecho e os
    totais, sempre com o aviso de que **não considera trânsito em tempo real**;
  - dá para retirar uma parada sem excluir a encomenda;
  - cada parada da lista tem Entregue, Maps e Editar; a resolvida volta para
    pendente com um toque;
  - avisa quando há encomendas novas fora da rota.
- **Entregas (Etapa 6):**
  - uma parada por vez, com "Abrir no Google Maps" (navegação até a parada),
    Entregue, Problema, Pular para depois e Editar;
  - Anterior/Próxima passam pelas paradas, inclusive as resolvidas: dá para
    desfazer um "Problema" tocado por engano;
  - mostra o progresso e recalcula as restantes a partir da localização atual
    ou da última entrega feita.

Até a Etapa 3 as encomendas, a rota e as configurações ficam **só neste
aparelho** (IndexedDB), atrás de interfaces que o Supabase vai assumir.

## Próximas etapas e o que você precisa configurar

| Etapa | O que é | Precisa de você |
|---|---|---|
| 3 | Login e banco no Supabase (RLS, cada usuário vê só as suas) | Projeto Supabase: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em `.env.local` |
| 4–6 (uso real) | Trocar os serviços de teste pelos definitivos | `VITE_TOMTOM_API_KEY` (geocodificação, sem cartão) e `VITE_ORS_API_KEY` (tempos, sem cartão), ver `.env.example` |
| 7 | PWA, offline com fila de sincronização, OCR de reserva (Cloud Vision via Edge Function) | Chave do Cloud Vision como *secret* da Edge Function, nunca no `.env` do front |

## Rotas: serviços e custos

Sem chaves, o app funciona com serviços gratuitos de **demonstração**:
OpenStreetMap/Nominatim (1 consulta por segundo) e o servidor de demonstração do
OSRM. Servem para testar, não para o dia a dia. Para uso real:

| Peça | Serviço | Por quê | Custo com 150 entregas/dia |
|---|---|---|---|
| Endereço → coordenadas | **TomTom** (recomendado) | Base comercial com número de casa; grátis e **sem cartão** | 150/dia, dentro das 2.500 grátis por dia |
| Endereço → coordenadas (alternativa) | Google Geocoding | Melhor cobertura no Brasil, mas exige faturamento (no Brasil, o teste pede **pré-pagamento de R$ 200**) | ~3.900 consultas/mês, dentro das ~10 mil grátis; travar com limite diário de 300 |
| Tempos entre as paradas | OpenRouteService | Grátis, uso comercial permitido, pelas ruas | 151 pontos dão ~22,8 mil pares, ~7 consultas por cálculo; o limite grátis é de 500 por dia |
| Ordem das paradas | Otimizador do próprio app | Sem custo | Exato até 12 paradas; com 150, frações de segundo |
| Navegação | Google Maps (link por parada) | O app do Maps não garante a ordem em links longos | Grátis |

**Por que não a Google Route Matrix:** ela considera o trânsito, mas cobra por
par de pontos. Com 151 pontos, dá ~22,8 mil pares, cerca de US$ 114 por cálculo
depois da franquia; com trânsito, o limite é de 100 pares por consulta.

**Por ruas** (`src/services/routing/streetOrder.ts`) é o padrão: agrupa pelo
nome da rua (sem o tipo de via, tolerando erro de leitura) e escolhe as ruas
em sequência pela mais perto. **O otimizador** (`src/services/routing/solver.ts`),
usado com "Organizar por ruas" desligado:
- até 12 paradas, programação dinâmica (resultado ótimo);
- acima disso, vizinho mais próximo e inserção mais barata, melhoradas por
  2-opt e Or-opt (custo de cada troca em tempo constante) e por perturbações
  até o limite de tempo;
- nos testes, fica a até 3% do ótimo, e 150 paradas levam cerca de 0,4 s;
- a matriz de tempos é guardada: recalcular a partir de uma parada não consulta
  o serviço de novo, e a partir da localização atual pede só uma linha.

**Testado com os serviços reais:** três lugares públicos de São Paulo foram
localizados no número pelo OpenStreetMap, e a rota calculada pelo OSRM saiu
coerente.

## Estrutura

```
src/
  types/            tipos do domínio (encomenda, endereço, status)
  services/
    label/          parser da etiqueta, CEP, conciliação com ViaCEP, fluxo da leitura
    barcode/        BarcodeDetector nativo + ZXing; escolha do rastreio
    ocr/            OcrProvider, Tesseract (worker reaproveitado), pré-processamento
    cep/            CepService (ViaCEP, com cache)
    geo/            Geocoder (Google ou Nominatim), escolha do melhor resultado
    routing/        provedores de tempo (ORS, OSRM, linha reta), otimizador,
                    planejador com matriz guardada, navegação
    storage/        PackageRepository (IndexedDB e memória), configurações
    packages/       regras: cadastro, duplicidade, status, estatísticas
    metrics.ts      taxa de acerto do OCR, sem dado pessoal
  hooks/            usePackages, useCaptureQueue, useGeocode, useRoute, useOnlineStatus
  components/       telas: início, cadastro, revisão, edição, rota, entregas, mapa
  lib/              instâncias únicas dos serviços, gerador de id
```

## Decisões

- **OCR sem binarização.** Comparei em fotos borradas de uma etiqueta fictícia: a
  binarização (Otsu) derrubava a confiança do Tesseract de 92% para 77%, e de 85%
  para 55%. Cinza + contraste esticado fica igual ao original, e o Tesseract
  binariza por dentro.
- **O destinatário é lido duas vezes.** A primeira leitura acha as linhas do
  nome e do endereço; esse bloco é recortado da foto em resolução maior,
  ampliado e lido de novo como um bloco só. O resultado só é usado se for pelo
  menos tão completo quanto a primeira leitura. O nome perde o lixo do OCR
  ("[=] [5]", "ro)") e "$obrado" vira "Sobrado".
- **A etiqueta é recortada da foto antes do OCR.** Numa etiqueta real fotografada
  sobre o saco plástico, a foto inteira não rendeu nem o nome. O app acha o papel
  branco e recorta a etiqueta. O recorte muda muito o resultado: com o código de
  barras da nota fiscal dentro, a leitura caiu para 1 de 7 trechos. Por isso o app
  faz até três leituras (recorte suavizado, recorte justo, foto inteira), para na
  primeira que tiver CEP, rua e número e fica com a de melhor nota. Na foto real,
  a primeira já bastou.
- **Foto pequena é ampliada** (até 3x) antes do OCR.
- **O ícone "TO" quase nunca sai como "TO".** Branco no círculo preto, saiu "Õ",
  "ÕÔ", "fo)" e "o" em etiquetas reais. Sem o marcador, o parser sobe a partir da
  linha cujo CEP é o mesmo do CEP grande do logo, parando no CEP do remetente.
- **CEP partido entre linhas e letra no lugar de número** ("11" / "443080",
  "D80") são remontados.
- Os testes reproduzem a **estrutura** do que o Tesseract leu das etiquetas reais,
  com dados trocados por fictícios.
- **Privacidade:**
  - a foto não é guardada: fica só na memória enquanto você confere;
  - o texto lido pelo OCR também não é guardado;
  - a métrica de acerto registra só quais campos foram corrigidos, não o conteúdo;
  - os testes usam apenas dados fictícios.
