# Dashboard Executiva — Design

> Sub-projeto 1 de 2 (Dashboard + Relatórios). Este spec cobre só a Dashboard.
> O módulo de Relatórios (Parte 1 do pedido original do usuário) é um spec
> separado, construído depois, reaproveitando a base criada aqui.

## Contexto

A Dashboard atual (`src/app/painel/page.tsx`) só mostra dados de Notas Fiscais
(contagem/bruto/líquido do mês + últimas 5 notas + total geral). Desde a
criação dela, o sistema ganhou os módulos de Gastos, Serviços, Controle de
Integração e melhorias em Impostos — nenhum desses aparece na Dashboard hoje.

Levantamento da arquitetura atual (ver auditoria completa na conversa de
brainstorming):
- **Não existe nenhum componente de Card/StatTile/Chart/Table reutilizável**
  hoje — cada tela reimplementa `<div className="card">` na mão.
- `recharts` (`^2.12.7`) está instalado mas **nunca foi usado** em nenhum lugar.
- Agregações financeiras só existem pra Notas (`/api/relatorios`,
  `/api/notas/resumo`) e Serviços (`calcularServico()` em
  `src/lib/servico-calc.ts`). Não existe nada pra Gastos ou Impostos.
- A lógica de vencimento de Colaboradores já está pronta e centralizada em
  `src/lib/colaboradores/status.ts` (`statusGeralColaborador`,
  `LIMITE_PROXIMO_DIAS = 30`).

## Objetivo

Redesenhar `/painel` como um painel executivo: indicadores financeiros e
operacionais de todos os módulos, gráficos que ajudam a decidir (não
decorativos), painéis de atividade recente, com um seletor de período
filtrando o conjunto. Construir a base de agregação de forma que o módulo de
Relatórios (próximo sub-projeto) reaproveite tudo sem duplicar lógica.

## Arquitetura

### Camada de agregação compartilhada

Novo módulo `src/lib/relatorios/agregacoes.ts`, com funções puras por
domínio, cada uma recebendo `usuarioId` e (quando aplicável) um `periodo:
{ inicio: Date; fim: Date }`:

- **`agregarNotas(usuarioId, periodo)`** — totais (bruto, líquido, ISS,
  tributos), `porStatus`, `porMes`. Extraída da lógica que já existe hoje em
  `src/app/api/relatorios/route.ts` (hoje inline na rota, duplicada
  conceitualmente entre `route.ts`, `export-excel/route.ts` e
  `export-pdf/route.ts` — todas recalculam do zero). Vira a fonte única.
- **`agregarGastos(usuarioId, periodo)`** — **novo**: total, `porServico`,
  `porFornecedor`, `porMes`, últimos N gastos.
- **`agregarServicos(usuarioId)`** — reaproveita `calcularServico()`
  (`src/lib/servico-calc.ts`) por serviço, adiciona ordenação por lucro e
  cálculo de `%` do orçamento consumido (`totalGastos / valorContratado`).
  Sem filtro de período — serviços são um estado atual, não um fluxo por data.
- **`agregarImpostos(usuarioId, periodo)`** — **novo**: totais por status
  (pago/pendente/vencido), lista dos próximos a vencer.
- **`agregarColaboradores(usuarioId)`** — reaproveita `statusGeralColaborador()`
  de `src/lib/colaboradores/status.ts`. Sem filtro de período (estado atual).

Cada função é testável isoladamente (dado um conjunto de registros, retorna
os totais esperados) sem precisar de servidor HTTP nem banco real na maioria
dos casos de teste (usar dados mockados in-memory onde a assinatura permitir).

### Nova rota

**`GET /api/painel/resumo?periodo=mes|6meses|ano|total`** — orquestra as 5
funções de agregação acima, monta a resposta única que a Dashboard consome.
Segue o mesmo padrão de auth de toda API do projeto: `getSession()` +
`verificarAcessoAssinatura(session.sub)`.

### Rota removida

`src/app/api/notas/resumo/route.ts` — hoje só é consumida pela Dashboard
atual. Depois que a Dashboard nova estiver no ar usando `/api/painel/resumo`,
esta rota fica sem nenhum consumidor (confirmar via grep antes de remover) e
é deletada — evita lógica duplicada apodrecendo no repositório.

### Componentes novos (`src/components/ui/`)

Reutilizáveis pela Dashboard agora e pelos Relatórios depois:

- **`StatCard.tsx`** — indicador único: label, valor formatado, cor/variante
  opcional (ex: destaque vermelho/âmbar quando há algo vencido).
- **`ChartCard.tsx`** — wrapper com título + área de gráfico via `recharts`
  (primeira vez que a lib é efetivamente usada no projeto).
- **`ListPanel.tsx`** — wrapper de painel: título, lista de itens, estado
  vazio padronizado.

## Seletor de período

Dropdown no cabeçalho: **Este mês / Últimos 6 meses / Este ano / Total**.
Filtra os indicadores (Financeiro + Operacional, exceto Integrações — que são
sempre "estado atual") e os gráficos de distribuição (Notas por Status,
Impostos por Status, Gastos por Serviço). **O gráfico de evolução mensal é
exceção**: sempre mostra os últimos 6 meses fixos, independente do período
selecionado — um gráfico de evolução com 1 mês de dado não tem utilidade.

## Indicadores (Resumo Financeiro)

Dois grupos visuais, grid responsivo (2 colunas mobile, 4-5 desktop):

**Financeiro** (R$)
- Valor bruto das notas
- Valor líquido das notas
- Total de gastos
- Lucro geral (Σ valor contratado dos serviços − Σ gastos)
- Margem de lucro % (lucro ÷ valor contratado) — indicador novo, não pedido
  explicitamente mas natural dado que já temos os dois valores
- Total de impostos — um único `StatCard` com dois sub-valores lado a lado,
  **pendente** e **vencido** (mais acionável que um único valor somado; o
  valor já pago aparece no gráfico de distribuição de impostos, não repetido
  aqui)

**Operacional** (contagens)
- Quantidade de notas
- Serviços em andamento
- Serviços concluídos
- Integrações em dia
- Integrações próximas do vencimento + vencidas (destaque visual se > 0)

## Gráficos

Curados pra decisão, não estética — 4 gráficos, todos usando `recharts`:

1. **Faturamento × Gastos × Lucro por mês** (combo: barras de faturamento e
   gastos + linha de lucro), últimos 6 meses fixos. Substitui e consolida
   os 3 gráficos de evolução separados que o pedido original sugeriu
   (evolução das notas / evolução dos gastos / lucro por mês) — mesmo eixo de
   tempo, não faz sentido triplicar.
2. **Distribuição de Notas por Status** (donut) — visão rápida de notas
   paradas em rascunho/aguardando vs. pagas.
3. **Gastos por Serviço** (barras, top 5) — cobre tanto "gastos por serviço"
   quanto "serviços que mais consumiram orçamento" do pedido original (mesmo
   dado, uma visualização só).
4. **Distribuição de Impostos por Status** (donut: pago/pendente/vencido).

Fora do escopo da Dashboard (fica pros Relatórios, que vão mais fundo):
gastos por fornecedor, comparativos mês a mês detalhados.

## Painéis

Grid responsivo 2-3 colunas:

- **Últimas notas cadastradas** — já existe hoje, mantido.
- **Últimos gastos** — novo.
- **Serviços com maior lucro** — top 5 por lucro (a análise de "mais
  consumiram orçamento" já está coberta pelo gráfico #3, não duplicada aqui).
- **Impostos próximos do vencimento** — pendentes ordenados por urgência.
- **Integrações próximas da expiração** — reaproveita 100% a lógica de
  `/integracao`, filtrando `proximo_vencimento`/`vencido`.
- **Atividades recentes** — feed sintetizado juntando os registros mais
  recentes (por `createdAt`) de notas, gastos, serviços, impostos e
  colaboradores num único painel ordenado por data. Sem nova tabela de log —
  só ordena timestamps que os registros já têm.

## Layout

Página única, sem abas — segue o padrão do resto do app:

1. Cabeçalho: saudação + seletor de período
2. Grid de indicadores (Financeiro / Operacional)
3. Gráficos: evolução mensal em largura total, os outros 3 lado a lado
   (empilham no mobile)
4. Painéis em grid responsivo
5. Mantém o botão "Nova Nota" e atalhos rápidos que já existem — nada
   removido do que já funciona hoje

Mobile-first, seguindo os breakpoints Tailwind já usados em `AppShell`/`MobileNav`.

## Testes

- Funções de `agregacoes.ts`: testadas isoladamente com dados sintéticos
  (script `npx tsx`, seguindo o padrão já usado no projeto — ver
  `src/lib/extractors/test-*.ts` como referência de estilo).
- `GET /api/painel/resumo`: teste manual via curl/PowerShell com usuário real
  de dev, comparando contra os números já visíveis nas telas de Notas/Gastos/
  Serviços/Impostos/Integração pra garantir consistência.
- Regressão: confirmar que remover `/api/notas/resumo` não quebra nenhum
  outro consumidor (grep antes de deletar).
- Responsividade: testar em viewport mobile e desktop via Browser pane.
- Sem regressão visual/funcional nos atalhos e botão "Nova Nota" que já
  existem na Dashboard atual.

## Fora de escopo (fica para o spec de Relatórios)

- Exportação (PDF/Excel) — não se aplica à Dashboard.
- Filtros de seção customizáveis — conceito específico de Relatórios.
- Análises mais profundas (gastos por fornecedor, comparativos detalhados).
