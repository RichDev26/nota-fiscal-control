# Dashboard Executiva Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar `/painel` como um painel executivo cobrindo Notas, Gastos, Serviços, Impostos e Colaboradores, com uma camada de agregação compartilhada que o módulo de Relatórios (spec/plano separado, futuro) vai reaproveitar.

**Architecture:** Módulo novo `src/lib/relatorios/agregacoes.ts` com 7 funções puras (uma por domínio + evolução mensal), consumidas por uma rota nova `GET /api/painel/resumo`. Três componentes novos em `src/components/ui/` (`StatCard`, `ChartCard`, `ListPanel`) substituem os `<div className="card">` que cada tela reimplementa hoje. `painel/page.tsx` é reescrita para consumir tudo isso; `recharts` (já instalado, nunca usado) entra em uso pela primeira vez.

**Tech Stack:** Next.js 14 App Router, Prisma 5, `recharts ^2.12.7`, `lucide-react ^0.395.0`, Tailwind (classes já existentes: `.card`, `.badge`, `.section-title`).

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-07-17-dashboard-executiva-design.md`.
- Todo dado é escopado por `usuarioId` (via `session.sub`) — nunca consultar sem esse filtro.
- Toda rota de API protegida segue o padrão já estabelecido: `getSession()` (401 se ausente) + `verificarAcessoAssinatura(session.sub)` (402 se inativa) — ver qualquer rota em `src/app/api/` como referência.
- **Refinamento descoberto durante o planejamento** (não estava explícito no spec): "pendente" e "vencido" de Impostos são status **manuais** gravados no banco (dropdown do usuário em `/impostos`), não calculados por data — diferente do padrão de Colaboradores. Por isso, os totais de `pendente`/`vencido` e a lista de "próximos do vencimento" em `agregarImpostos` **ignoram o seletor de período** (são sempre "estado atual" — uma obrigação vencida há 3 meses continua relevante mesmo filtrando "este mês"). Só o total **pago** respeita o período selecionado (usa `dataPagamento`). Isso também vale pro gráfico de distribuição de impostos (Task 6), que consome a mesma função.
- Scripts de teste seguem o padrão já estabelecido no projeto: `npx tsx caminho/do/arquivo.ts`, `console.log` com ✅/❌, sem framework de testes.
- Reaproveitar sempre que existir: `calcularServico` (`src/lib/servico-calc.ts`), `statusGeralColaborador`/`calcularStatusDocumentos`/`diasRestantes` (`src/lib/colaboradores/status.ts`), `serializarColaborador` (`src/lib/colaboradores/serializar.ts`), `formatarMoeda`/`formatarData` (`src/lib/validators.ts`).

---

### Task 1: Tipos compartilhados

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `PeriodoDashboard`, `ResumoNotasPainel`, `ResumoGastosPainel`, `ServicoComLucro`, `ResumoServicosPainel`, `ImpostoProximo`, `ResumoImpostosPainel`, `ResumoColaboradoresPainel`, `AtividadeRecente`, `EvolucaoMensal`, `ResumoPainel`. Usados por: `agregacoes.ts` (Tasks 2-3), rota `/api/painel/resumo` (Task 4), `painel/page.tsx` (Task 6).

- [ ] **Step 1: Adicionar os tipos ao final de `src/types/index.ts`**

```ts
// ─── Painel Executivo (Dashboard) ────────────────────────────────────────────
export type PeriodoDashboard = 'mes' | '6meses' | 'ano' | 'total';

export interface ResumoNotasPainel {
  totalNotas: number;
  totalBruto: number;
  totalLiquido: number;
  totalIss: number;
  totalTributos: number;
  porStatus: Record<string, number>;
  porMes: Array<{ mes: string; total: number; quantidade: number }>;
}

export interface ResumoGastosPainel {
  totalGastos: number;
  quantidade: number;
  porServico: Array<{ servicoId: string | null; nome: string; total: number }>;
  porFornecedor: Array<{ fornecedor: string; total: number }>;
  porMes: Array<{ mes: string; total: number; quantidade: number }>;
  ultimos: Array<{ id: string; descricao: string; valor: number; data: string; fornecedor: string | null }>;
}

export interface ServicoComLucro {
  id: string;
  nome: string;
  valorContratado: number;
  status: StatusServico;
  totalGastos: number;
  lucro: number;
  percentualConsumido: number;
}

export interface ResumoServicosPainel {
  emAndamento: number;
  concluidos: number;
  valorContratadoTotal: number;
  totalGastos: number;
  lucroTotal: number;
  maisLucrativos: ServicoComLucro[];
}

export interface ImpostoProximo {
  id: string;
  imposto: string | null;
  valor: number;
  dataVencimento: string | null;
  diasRestantes: number | null;
}

export interface ResumoImpostosPainel {
  totalPendente: number;
  totalVencido: number;
  totalPago: number;
  totalCancelado: number;
  proximos: ImpostoProximo[];
}

export interface ResumoColaboradoresPainel {
  emDia: number;
  proximoVencimento: number;
  vencido: number;
  proximos: Array<{ id: string; nome: string; statusGeral: string; statusLabel: string }>;
}

export interface AtividadeRecente {
  tipo: 'nota' | 'gasto' | 'servico' | 'imposto' | 'colaborador';
  titulo: string;
  subtitulo?: string;
  data: string;
  href: string;
}

export interface EvolucaoMensal {
  mes: string;
  faturamento: number;
  gastos: number;
  lucro: number;
}

export interface ResumoPainel {
  periodo: PeriodoDashboard;
  notas: ResumoNotasPainel;
  gastos: ResumoGastosPainel;
  servicos: ResumoServicosPainel;
  impostos: ResumoImpostosPainel;
  colaboradores: ResumoColaboradoresPainel;
  atividades: AtividadeRecente[];
  evolucaoMensal: EvolucaoMensal[];
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (nada ainda consome esses tipos, só a definição precisa compilar).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(painel): tipos compartilhados do resumo executivo"
```

---

### Task 2: Agregações — Período, Notas, Gastos

**Files:**
- Create: `src/lib/relatorios/agregacoes.ts`
- Create: `src/lib/relatorios/test-agregacoes.ts`

**Interfaces:**
- Consumes: `prisma` de `@/lib/prisma`; tipos do Task 1.
- Produces: `resolverPeriodo(periodo: PeriodoDashboard, agora?: Date): { inicio: Date; fim: Date }`; `agregarNotas(usuarioId: string, periodo: { inicio: Date; fim: Date }): Promise<ResumoNotasPainel>`; `agregarGastos(usuarioId: string, periodo: { inicio: Date; fim: Date }): Promise<ResumoGastosPainel>`. Usados por: Task 3 (mesmo arquivo), Task 4 (rota).

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/lib/relatorios/test-agregacoes.ts`:

```ts
// Execução: npx tsx src/lib/relatorios/test-agregacoes.ts
import prisma from '@/lib/prisma';
import { resolverPeriodo, agregarNotas, agregarGastos } from './agregacoes';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };

(async () => {
  const agora = new Date('2026-07-17T12:00:00Z');

  // ── resolverPeriodo: casos puros ──
  const mes = resolverPeriodo('mes', agora);
  check('mes: início é dia 1 do mês atual', mes.inicio.getUTCDate() === 1 && mes.inicio.getUTCMonth() === 6);
  const seisMeses = resolverPeriodo('6meses', agora);
  check('6meses: início é 5 meses antes (6 meses incluindo o atual)', seisMeses.inicio.getUTCMonth() === 1);
  const ano = resolverPeriodo('ano', agora);
  check('ano: início é 1º de janeiro', ano.inicio.getUTCMonth() === 0 && ano.inicio.getUTCDate() === 1);
  const total = resolverPeriodo('total', agora);
  check('total: início é uma data bem no passado', total.inicio.getUTCFullYear() <= 2000);

  // ── agregarNotas / agregarGastos: integração real com o banco ──
  const email = `teste-agregacoes-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Agregacoes' } });

  const servico = await prisma.servico.create({
    data: { nome: 'Serviço Teste', valorContratado: 1000, usuarioId: usuario.id },
  });

  const dataEmissao = new Date('2026-07-10T12:00:00Z');
  await prisma.notaFiscal.create({
    data: {
      usuarioId: usuario.id, status: 'lancada', valorBruto: 500, valorLiquido: 480, valorIss: 20,
      dataEmissao,
    },
  });

  const dataGasto = new Date('2026-07-05T12:00:00Z');
  await prisma.gasto.create({
    data: { descricao: 'Material', valor: 200, data: dataGasto, fornecedor: 'Fornecedor X', servicoId: servico.id, usuarioId: usuario.id },
  });

  const periodo = resolverPeriodo('mes', agora);
  const resumoNotas  = await agregarNotas(usuario.id, periodo);
  const resumoGastos = await agregarGastos(usuario.id, periodo);

  check('agregarNotas: totalNotas = 1', resumoNotas.totalNotas === 1);
  check('agregarNotas: totalBruto = 500', resumoNotas.totalBruto === 500);
  check('agregarNotas: porStatus.lancada = 1', resumoNotas.porStatus['lancada'] === 1);
  check('agregarNotas: porMes tem a entrada 2026-07', resumoNotas.porMes.some(m => m.mes === '2026-07' && m.total === 500));

  check('agregarGastos: totalGastos = 200', resumoGastos.totalGastos === 200);
  check('agregarGastos: porServico agrupa pelo serviço certo', resumoGastos.porServico.some(s => s.servicoId === servico.id && s.total === 200));
  check('agregarGastos: porFornecedor agrupa certo', resumoGastos.porFornecedor.some(f => f.fornecedor === 'Fornecedor X' && f.total === 200));
  check('agregarGastos: ultimos inclui o gasto criado', resumoGastos.ultimos.some(g => g.descricao === 'Material'));

  // ── Limpeza ──
  // Usuario não tem onDelete: Cascade para Servico/NotaFiscal/Gasto no schema
  // (usuarioId é opcional nesses modelos, relação sem cascade) — por isso cada
  // um é apagado explicitamente, e Gasto vem antes de Servico porque referencia
  // servicoId sem cascade também.
  await prisma.gasto.deleteMany({ where: { usuarioId: usuario.id } });
  await prisma.servico.deleteMany({ where: { usuarioId: usuario.id } });
  await prisma.notaFiscal.deleteMany({ where: { usuarioId: usuario.id } });
  await prisma.usuario.delete({ where: { id: usuario.id } });

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx src/lib/relatorios/test-agregacoes.ts`
Expected: erro `Cannot find module './agregacoes'`.

- [ ] **Step 3: Implementar `resolverPeriodo`, `agregarNotas`, `agregarGastos` em `src/lib/relatorios/agregacoes.ts`**

```ts
/**
 * Camada de agregação compartilhada entre a Dashboard e (futuramente) os
 * Relatórios. Cada função é pura em relação ao request — recebe usuarioId e
 * um período já resolvido, nunca query params crus.
 */
import prisma from '@/lib/prisma';
import { calcularServico } from '@/lib/servico-calc';
import { serializarColaborador } from '@/lib/colaboradores/serializar';
import { diasRestantes } from '@/lib/colaboradores/status';
import { formatarMoeda } from '@/lib/validators';
import type {
  PeriodoDashboard, ResumoNotasPainel, ResumoGastosPainel, ServicoComLucro,
  ResumoServicosPainel, ImpostoProximo, ResumoImpostosPainel,
  ResumoColaboradoresPainel, AtividadeRecente, EvolucaoMensal,
} from '@/types';

export interface Periodo { inicio: Date; fim: Date }

export function resolverPeriodo(periodo: PeriodoDashboard, agora: Date = new Date()): Periodo {
  const fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59, 999);
  switch (periodo) {
    case 'mes':
      return { inicio: new Date(agora.getFullYear(), agora.getMonth(), 1), fim };
    case '6meses':
      return { inicio: new Date(agora.getFullYear(), agora.getMonth() - 5, 1), fim };
    case 'ano':
      return { inicio: new Date(agora.getFullYear(), 0, 1), fim };
    case 'total':
      return { inicio: new Date(2000, 0, 1), fim };
  }
}

function chaveMs(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

export async function agregarNotas(usuarioId: string, periodo: Periodo): Promise<ResumoNotasPainel> {
  const dateFilter = { gte: periodo.inicio, lte: periodo.fim };
  const notas = await prisma.notaFiscal.findMany({
    where: {
      usuarioId,
      OR: [
        { dataEmissao: dateFilter },
        { dataEmissao: null, createdAt: dateFilter },
      ],
    },
    select: { valorBruto: true, valorLiquido: true, valorIss: true, valorAproximadoTributos: true, status: true, dataEmissao: true, createdAt: true },
  });

  const totalBruto = notas.reduce((s, n) => s + (n.valorBruto || 0), 0);
  const totalLiquido = notas.reduce((s, n) => s + (n.valorLiquido || 0), 0);
  const totalIss = notas.reduce((s, n) => s + (n.valorIss || 0), 0);
  const totalTributos = notas.reduce((s, n) => s + (n.valorAproximadoTributos || 0), 0);

  const porStatus: Record<string, number> = {};
  for (const n of notas) porStatus[n.status] = (porStatus[n.status] || 0) + 1;

  const porMesMap: Record<string, { total: number; quantidade: number }> = {};
  for (const n of notas) {
    const mes = chaveMs(n.dataEmissao ?? n.createdAt);
    if (!porMesMap[mes]) porMesMap[mes] = { total: 0, quantidade: 0 };
    porMesMap[mes].total += n.valorBruto || 0;
    porMesMap[mes].quantidade += 1;
  }
  const porMes = Object.entries(porMesMap).map(([mes, v]) => ({ mes, ...v })).sort((a, b) => a.mes.localeCompare(b.mes));

  return { totalNotas: notas.length, totalBruto, totalLiquido, totalIss, totalTributos, porStatus, porMes };
}

export async function agregarGastos(usuarioId: string, periodo: Periodo): Promise<ResumoGastosPainel> {
  const gastos = await prisma.gasto.findMany({
    where: { usuarioId, data: { gte: periodo.inicio, lte: periodo.fim } },
    include: { servico: { select: { id: true, nome: true } } },
    orderBy: { data: 'desc' },
  });

  const totalGastos = gastos.reduce((s, g) => s + g.valor, 0);

  const porServicoMap: Record<string, { nome: string; total: number }> = {};
  for (const g of gastos) {
    const chave = g.servicoId ?? 'sem-servico';
    const nome = g.servico?.nome ?? 'Sem serviço';
    if (!porServicoMap[chave]) porServicoMap[chave] = { nome, total: 0 };
    porServicoMap[chave].total += g.valor;
  }
  const porServico = Object.entries(porServicoMap)
    .map(([servicoId, v]) => ({ servicoId: servicoId === 'sem-servico' ? null : servicoId, ...v }))
    .sort((a, b) => b.total - a.total);

  const porFornecedorMap: Record<string, number> = {};
  for (const g of gastos) {
    const nome = g.fornecedor?.trim() || 'Não informado';
    porFornecedorMap[nome] = (porFornecedorMap[nome] || 0) + g.valor;
  }
  const porFornecedor = Object.entries(porFornecedorMap)
    .map(([fornecedor, total]) => ({ fornecedor, total }))
    .sort((a, b) => b.total - a.total);

  const porMesMap: Record<string, { total: number; quantidade: number }> = {};
  for (const g of gastos) {
    const mes = chaveMs(g.data);
    if (!porMesMap[mes]) porMesMap[mes] = { total: 0, quantidade: 0 };
    porMesMap[mes].total += g.valor;
    porMesMap[mes].quantidade += 1;
  }
  const porMes = Object.entries(porMesMap).map(([mes, v]) => ({ mes, ...v })).sort((a, b) => a.mes.localeCompare(b.mes));

  const ultimos = gastos.slice(0, 5).map(g => ({
    id: g.id, descricao: g.descricao, valor: g.valor, data: g.data.toISOString(), fornecedor: g.fornecedor,
  }));

  return { totalGastos, quantidade: gastos.length, porServico, porFornecedor, porMes, ultimos };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsx src/lib/relatorios/test-agregacoes.ts`
Expected: todas as linhas ✅, `✅ Todos os testes passaram`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relatorios/agregacoes.ts src/lib/relatorios/test-agregacoes.ts
git commit -m "feat(painel): agregacoes.ts — resolverPeriodo, agregarNotas, agregarGastos"
```

---

### Task 3: Agregações — Serviços, Impostos, Colaboradores, Atividades, Evolução

**Files:**
- Modify: `src/lib/relatorios/agregacoes.ts`
- Modify: `src/lib/relatorios/test-agregacoes.ts`

**Interfaces:**
- Consumes: `calcularServico` (`@/lib/servico-calc`), `serializarColaborador` (`@/lib/colaboradores/serializar`), `diasRestantes` (`@/lib/colaboradores/status`), `agregarNotas`/`agregarGastos` (Task 2, mesmo arquivo).
- Produces: `agregarServicos(usuarioId): Promise<ResumoServicosPainel>`; `agregarImpostos(usuarioId, periodo): Promise<ResumoImpostosPainel>`; `agregarColaboradores(usuarioId): Promise<ResumoColaboradoresPainel>`; `agregarAtividadesRecentes(usuarioId, limite?): Promise<AtividadeRecente[]>`; `agregarEvolucaoMensal(usuarioId, meses?): Promise<EvolucaoMensal[]>`. Usados por: Task 4 (rota).

- [ ] **Step 1: Adicionar os novos testes a `test-agregacoes.ts`**

Primeiro, amplie o import estático do topo do arquivo (escrito no Task 2) para incluir as 5 funções novas:

```ts
import { resolverPeriodo, agregarNotas, agregarGastos, agregarServicos, agregarImpostos, agregarColaboradores, agregarAtividadesRecentes, agregarEvolucaoMensal } from './agregacoes';
```

Depois, adicione o bloco abaixo antes do bloco de limpeza (`// ── Limpeza ──`) em `src/lib/relatorios/test-agregacoes.ts`:

```ts
  // ── agregarServicos ──
  const resumoServicos = await agregarServicos(usuario.id);
  check('agregarServicos: 1 serviço em andamento', resumoServicos.emAndamento === 1);
  check('agregarServicos: lucroTotal = 1000 - 200 = 800', resumoServicos.lucroTotal === 800);
  check('agregarServicos: maisLucrativos inclui o serviço com percentual 20%', resumoServicos.maisLucrativos.some(s => s.id === servico.id && s.percentualConsumido === 20));

  // ── agregarImpostos ──
  const impostoPendente = await prisma.imposto.create({
    data: { usuarioId: usuario.id, imposto: 'ISS', valor: 100, status: 'pendente', dataVencimento: new Date('2026-08-01') },
  });
  const impostoVencido = await prisma.imposto.create({
    data: { usuarioId: usuario.id, imposto: 'ISS', valor: 50, status: 'vencido', dataVencimento: new Date('2026-06-01') },
  });
  const impostoPago = await prisma.imposto.create({
    data: { usuarioId: usuario.id, imposto: 'ISS', valor: 30, status: 'pago', dataPagamento: new Date('2026-07-10') },
  });
  const resumoImpostos = await agregarImpostos(usuario.id, periodo);
  check('agregarImpostos: totalPendente = 100', resumoImpostos.totalPendente === 100);
  check('agregarImpostos: totalVencido = 50', resumoImpostos.totalVencido === 50);
  check('agregarImpostos: totalPago (dentro do período de julho) = 30', resumoImpostos.totalPago === 30);
  check('agregarImpostos: proximos inclui o pendente', resumoImpostos.proximos.some(i => i.id === impostoPendente.id));
  check('agregarImpostos: proximos NÃO inclui o vencido (status != pendente)', !resumoImpostos.proximos.some(i => i.id === impostoVencido.id));

  // ── agregarColaboradores ──
  const colaborador = await prisma.colaborador.create({
    data: {
      nome: 'Colaborador Teste', usuarioId: usuario.id,
      documentos: {
        create: [
          { tipo: 'INTEGRACAO', dataInicio: new Date('2026-01-01'), dataFim: new Date('2026-07-25') }, // próximo do vencimento
          { tipo: 'ASO', dataInicio: new Date('2026-01-01'), dataFim: new Date('2027-01-01') },
        ],
      },
    },
  });
  const resumoColaboradores = await agregarColaboradores(usuario.id);
  check('agregarColaboradores: 1 próximo do vencimento', resumoColaboradores.proximoVencimento === 1);
  check('agregarColaboradores: proximos inclui o colaborador certo', resumoColaboradores.proximos.some(c => c.id === colaborador.id));

  // ── agregarAtividadesRecentes ──
  const atividades = await agregarAtividadesRecentes(usuario.id);
  check('agregarAtividadesRecentes: inclui a nota criada', atividades.some(a => a.tipo === 'nota'));
  check('agregarAtividadesRecentes: inclui o gasto criado', atividades.some(a => a.tipo === 'gasto'));
  check('agregarAtividadesRecentes: ordenado do mais recente pro mais antigo', atividades.every((a, i) => i === 0 || new Date(atividades[i - 1].data) >= new Date(a.data)));

  // ── agregarEvolucaoMensal ──
  const evolucao = await agregarEvolucaoMensal(usuario.id, 6);
  check('agregarEvolucaoMensal: retorna 6 meses', evolucao.length === 6);
  check('agregarEvolucaoMensal: mês de julho reflete faturamento e gastos criados', evolucao.some(e => e.mes === '2026-07' && e.faturamento === 500 && e.gastos === 200 && e.lucro === 300));

```

Em seguida, substitua o bloco `// ── Limpeza ──` inteiro (escrito no Task 2) por esta versão, que
também limpa impostos e colaborador, na ordem correta de dependências:

```ts
  // ── Limpeza ──
  // Usuario não tem onDelete: Cascade para Servico/NotaFiscal/Gasto/Imposto no
  // schema (usuarioId é opcional nesses modelos) — cada um é apagado
  // explicitamente. Colaborador → DocumentoColaborador → NotificacaoDocumento
  // JÁ têm onDelete: Cascade entre si — apagar o Colaborador basta.
  await prisma.colaborador.delete({ where: { id: colaborador.id } });
  await prisma.imposto.deleteMany({ where: { id: { in: [impostoPendente.id, impostoVencido.id, impostoPago.id] } } });
  await prisma.gasto.deleteMany({ where: { usuarioId: usuario.id } });
  await prisma.servico.deleteMany({ where: { usuarioId: usuario.id } });
  await prisma.notaFiscal.deleteMany({ where: { usuarioId: usuario.id } });
  await prisma.usuario.delete({ where: { id: usuario.id } });

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx src/lib/relatorios/test-agregacoes.ts`
Expected: erro de import — as funções novas ainda não existem em `agregacoes.ts`.

- [ ] **Step 3: Implementar as 5 funções novas, ao final de `src/lib/relatorios/agregacoes.ts`**

```ts
export async function agregarServicos(usuarioId: string): Promise<ResumoServicosPainel> {
  const servicos = await prisma.servico.findMany({
    where: { usuarioId },
    include: { gastos: { select: { valor: true } } },
  });

  const calculados: ServicoComLucro[] = servicos.map(s => {
    const { totalGastos, lucro } = calcularServico(s.valorContratado, s.gastos);
    return {
      id: s.id,
      nome: s.nome,
      valorContratado: s.valorContratado,
      status: s.status as ServicoComLucro['status'],
      totalGastos,
      lucro,
      percentualConsumido: s.valorContratado > 0 ? Math.round((totalGastos / s.valorContratado) * 100) : 0,
    };
  });

  const emAndamento = calculados.filter(s => s.status === 'em_andamento').length;
  const concluidos = calculados.filter(s => s.status === 'concluido').length;
  const valorContratadoTotal = calculados.reduce((s, v) => s + v.valorContratado, 0);
  const totalGastos = calculados.reduce((s, v) => s + v.totalGastos, 0);
  const lucroTotal = calculados.reduce((s, v) => s + v.lucro, 0);
  const maisLucrativos = [...calculados].sort((a, b) => b.lucro - a.lucro).slice(0, 5);

  return { emAndamento, concluidos, valorContratadoTotal, totalGastos, lucroTotal, maisLucrativos };
}

/**
 * Pendente/vencido são "estado atual" — nunca filtrados por período (uma
 * obrigação vencida há meses continua relevante mesmo filtrando "este mês").
 * Só o total pago respeita o período (usa dataPagamento).
 */
export async function agregarImpostos(usuarioId: string, periodo: Periodo): Promise<ResumoImpostosPainel> {
  const abertos = await prisma.imposto.findMany({
    where: { usuarioId, status: { in: ['pendente', 'vencido'] } },
  });
  const totalPendente = abertos.filter(i => i.status === 'pendente').reduce((s, i) => s + (i.valor || 0), 0);
  const totalVencido  = abertos.filter(i => i.status === 'vencido').reduce((s, i) => s + (i.valor || 0), 0);

  const proximos: ImpostoProximo[] = abertos
    .filter(i => i.status === 'pendente' && i.dataVencimento)
    .sort((a, b) => new Date(a.dataVencimento!).getTime() - new Date(b.dataVencimento!).getTime())
    .slice(0, 5)
    .map(i => ({
      id: i.id,
      imposto: i.imposto,
      valor: i.valor || 0,
      dataVencimento: i.dataVencimento ? i.dataVencimento.toISOString() : null,
      diasRestantes: i.dataVencimento ? diasRestantes(i.dataVencimento) : null,
    }));

  const pagosNoPeriodo = await prisma.imposto.findMany({
    where: { usuarioId, status: 'pago', dataPagamento: { gte: periodo.inicio, lte: periodo.fim } },
    select: { valor: true },
  });
  const totalPago = pagosNoPeriodo.reduce((s, i) => s + (i.valor || 0), 0);

  const canceladosNoPeriodo = await prisma.imposto.findMany({
    where: { usuarioId, status: 'cancelado', createdAt: { gte: periodo.inicio, lte: periodo.fim } },
    select: { valor: true },
  });
  const totalCancelado = canceladosNoPeriodo.reduce((s, i) => s + (i.valor || 0), 0);

  return { totalPendente, totalVencido, totalPago, totalCancelado, proximos };
}

export async function agregarColaboradores(usuarioId: string): Promise<ResumoColaboradoresPainel> {
  const rows = await prisma.colaborador.findMany({
    where: { usuarioId },
    include: { documentos: true },
  });
  const colaboradores = rows.map(serializarColaborador);

  const emDia = colaboradores.filter(c => c.statusGeral === 'em_dia').length;
  const proximoVencimento = colaboradores.filter(c => c.statusGeral === 'proximo_vencimento').length;
  const vencido = colaboradores.filter(c => c.statusGeral === 'vencido').length;

  const proximos = colaboradores
    .filter(c => c.statusGeral !== 'em_dia')
    .slice(0, 5)
    .map(c => ({ id: c.id, nome: c.nome, statusGeral: c.statusGeral, statusLabel: c.statusLabel }));

  return { emDia, proximoVencimento, vencido, proximos };
}

export async function agregarAtividadesRecentes(usuarioId: string, limite = 8): Promise<AtividadeRecente[]> {
  const [notas, gastos, servicos, impostos, colaboradores] = await Promise.all([
    prisma.notaFiscal.findMany({ where: { usuarioId }, orderBy: { createdAt: 'desc' }, take: limite, select: { id: true, nomeOrganizador: true, numeroNf: true, valorBruto: true, createdAt: true } }),
    prisma.gasto.findMany({ where: { usuarioId }, orderBy: { createdAt: 'desc' }, take: limite, select: { id: true, descricao: true, valor: true, createdAt: true } }),
    prisma.servico.findMany({ where: { usuarioId }, orderBy: { createdAt: 'desc' }, take: limite, select: { id: true, nome: true, createdAt: true } }),
    prisma.imposto.findMany({ where: { usuarioId }, orderBy: { createdAt: 'desc' }, take: limite, select: { id: true, imposto: true, valor: true, createdAt: true } }),
    prisma.colaborador.findMany({ where: { usuarioId }, orderBy: { createdAt: 'desc' }, take: limite, select: { id: true, nome: true, createdAt: true } }),
  ]);

  const atividades: AtividadeRecente[] = [
    ...notas.map(n => ({ tipo: 'nota' as const, titulo: n.nomeOrganizador || `NF ${n.numeroNf || 'S/N'}`, subtitulo: formatarMoeda(n.valorBruto), data: n.createdAt.toISOString(), href: `/notas/${n.id}` })),
    ...gastos.map(g => ({ tipo: 'gasto' as const, titulo: g.descricao, subtitulo: formatarMoeda(g.valor), data: g.createdAt.toISOString(), href: `/gastos/${g.id}` })),
    ...servicos.map(s => ({ tipo: 'servico' as const, titulo: s.nome, subtitulo: undefined, data: s.createdAt.toISOString(), href: `/gastos/servicos/${s.id}` })),
    ...impostos.map(i => ({ tipo: 'imposto' as const, titulo: i.imposto || 'Imposto', subtitulo: formatarMoeda(i.valor), data: i.createdAt.toISOString(), href: '/impostos' })),
    ...colaboradores.map(c => ({ tipo: 'colaborador' as const, titulo: c.nome, subtitulo: undefined, data: c.createdAt.toISOString(), href: '/integracao' })),
  ];

  return atividades.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).slice(0, limite);
}

/** Sempre os últimos N meses fixos — independe do seletor de período da Dashboard. */
export async function agregarEvolucaoMensal(usuarioId: string, meses = 6): Promise<EvolucaoMensal[]> {
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth() - (meses - 1), 1);
  const fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59, 999);

  const [notasResumo, gastosResumo] = await Promise.all([
    agregarNotas(usuarioId, { inicio, fim }),
    agregarGastos(usuarioId, { inicio, fim }),
  ]);

  const mesesLista: string[] = [];
  for (let i = 0; i < meses; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - (meses - 1) + i, 1);
    mesesLista.push(chaveMs(d));
  }

  const faturamentoPorMes = Object.fromEntries(notasResumo.porMes.map(m => [m.mes, m.total]));
  const gastosPorMes = Object.fromEntries(gastosResumo.porMes.map(m => [m.mes, m.total]));

  return mesesLista.map(mes => {
    const faturamento = faturamentoPorMes[mes] ?? 0;
    const gastos = gastosPorMes[mes] ?? 0;
    return { mes, faturamento, gastos, lucro: faturamento - gastos };
  });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsx src/lib/relatorios/test-agregacoes.ts`
Expected: todas as linhas ✅, `✅ Todos os testes passaram`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relatorios/agregacoes.ts src/lib/relatorios/test-agregacoes.ts
git commit -m "feat(painel): agregacoes.ts — servicos, impostos, colaboradores, atividades, evolucao mensal"
```

---

### Task 4: Rota `GET /api/painel/resumo`

**Files:**
- Create: `src/app/api/painel/resumo/route.ts`

**Interfaces:**
- Consumes: todas as funções de `@/lib/relatorios/agregacoes` (Tasks 2-3); `ResumoPainel`, `PeriodoDashboard` de `@/types` (Task 1).
- Produces: `GET /api/painel/resumo?periodo=mes|6meses|ano|total` → `ResumoPainel`. Consumido por `painel/page.tsx` (Task 6).

- [ ] **Step 1: Implementar a rota**

Crie `src/app/api/painel/resumo/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { verificarAcessoAssinatura } from '@/lib/assinatura/acesso';
import {
  resolverPeriodo, agregarNotas, agregarGastos, agregarServicos,
  agregarImpostos, agregarColaboradores, agregarAtividadesRecentes, agregarEvolucaoMensal,
} from '@/lib/relatorios/agregacoes';
import type { PeriodoDashboard, ResumoPainel } from '@/types';

export const dynamic = 'force-dynamic';

const PERIODOS_VALIDOS: PeriodoDashboard[] = ['mes', '6meses', 'ano', 'total'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    await verificarAcessoAssinatura(session.sub);
  } catch {
    return NextResponse.json({ error: 'Assinatura inativa ou trial expirado.' }, { status: 402 });
  }

  const { searchParams } = new URL(req.url);
  const periodoParam = searchParams.get('periodo') as PeriodoDashboard | null;
  const periodo: PeriodoDashboard = periodoParam && PERIODOS_VALIDOS.includes(periodoParam) ? periodoParam : 'mes';

  try {
    const range = resolverPeriodo(periodo);

    const [notas, gastos, servicos, impostos, colaboradores, atividades, evolucaoMensal] = await Promise.all([
      agregarNotas(session.sub, range),
      agregarGastos(session.sub, range),
      agregarServicos(session.sub),
      agregarImpostos(session.sub, range),
      agregarColaboradores(session.sub),
      agregarAtividadesRecentes(session.sub),
      agregarEvolucaoMensal(session.sub),
    ]);

    const resposta: ResumoPainel = { periodo, notas, gastos, servicos, impostos, colaboradores, atividades, evolucaoMensal };
    return NextResponse.json(resposta);
  } catch (err) {
    console.error('[GET /api/painel/resumo]', err);
    return NextResponse.json({ error: 'Erro ao buscar resumo do painel' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Teste manual contra o servidor de dev**

Com `npm run dev` rodando e um usuário de teste logado (cookie de sessão):

```bash
curl -s "http://localhost:3003/api/painel/resumo?periodo=6meses" -H "Cookie: nf_sess=<COOKIE>" | head -c 2000
```

(Use PowerShell `Invoke-WebRequest`/`Invoke-RestMethod` se `curl` estiver interceptado no seu ambiente — ver sessões anteriores deste projeto.)

Expected: JSON com as 7 chaves (`periodo`, `notas`, `gastos`, `servicos`, `impostos`, `colaboradores`, `atividades`, `evolucaoMensal`), valores compatíveis com o que já aparece em `/notas`, `/gastos`, `/gastos/servicos`, `/impostos`, `/integracao` para esse mesmo usuário.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/painel/resumo/route.ts
git commit -m "feat(painel): rota GET /api/painel/resumo"
```

---

### Task 5: Componentes de UI reutilizáveis — StatCard, ChartCard, ListPanel

**Files:**
- Create: `src/components/ui/StatCard.tsx`
- Create: `src/components/ui/ChartCard.tsx`
- Create: `src/components/ui/ListPanel.tsx`

**Interfaces:**
- Consumes: classes CSS `.card` (já existentes em `src/app/globals.css`).
- Produces: `StatCard`, `ChartCard`, `ListPanel` (default exports). Usados por `painel/page.tsx` (Task 6) e, futuramente, pelos Relatórios.

- [ ] **Step 1: Implementar `StatCard.tsx`**

```tsx
interface ParStatCard {
  label: string;
  value: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

interface StatCardProps {
  label: string;
  value?: string;
  pares?: ParStatCard[];
  sub?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
}

const VARIANT_TEXT: Record<string, string> = {
  default: 'text-gray-900',
  success: 'text-green-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
};

export default function StatCard({ label, value, pares, sub, variant = 'default', icon }: StatCardProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-gray-400">{label}</p>
        {icon}
      </div>

      {pares ? (
        <div className="flex items-baseline gap-4">
          {pares.map(p => (
            <div key={p.label}>
              <p className={`text-lg font-bold tabular-nums leading-tight ${VARIANT_TEXT[p.variant ?? 'default']}`}>{p.value}</p>
              <p className="text-[10px] text-gray-400 font-medium">{p.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className={`text-xl font-bold tabular-nums leading-tight ${VARIANT_TEXT[variant]}`}>{value}</p>
      )}

      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Implementar `ChartCard.tsx`**

```tsx
interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  altura?: number;
}

export default function ChartCard({ title, children, className, altura = 260 }: ChartCardProps) {
  return (
    <div className={`card p-5 ${className ?? ''}`}>
      <p className="font-bold text-gray-900 mb-4">{title}</p>
      <div className="w-full" style={{ height: altura }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implementar `ListPanel.tsx`**

```tsx
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface ListPanelProps {
  title: string;
  actionHref?: string;
  actionLabel?: string;
  emptyLabel?: string;
  isEmpty?: boolean;
  children: React.ReactNode;
}

export default function ListPanel({
  title, actionHref, actionLabel = 'Ver todos', emptyLabel = 'Nada por aqui ainda', isEmpty, children,
}: ListPanelProps) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="font-bold text-gray-900">{title}</p>
        {actionHref && (
          <Link href={actionHref} className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-0.5">
            {actionLabel} <ChevronRight size={14} />
          </Link>
        )}
      </div>
      {isEmpty ? (
        <p className="text-sm text-gray-400 text-center py-6">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/StatCard.tsx src/components/ui/ChartCard.tsx src/components/ui/ListPanel.tsx
git commit -m "feat(ui): componentes reutilizaveis StatCard, ChartCard, ListPanel"
```

---

### Task 6: Reescrever `painel/page.tsx`

**Files:**
- Modify: `src/app/painel/page.tsx`

**Interfaces:**
- Consumes: `GET /api/painel/resumo` (Task 4); `StatCard`/`ChartCard`/`ListPanel` (Task 5); `ResumoPainel`/`PeriodoDashboard` (Task 1); `formatarMoeda`/`formatarData` (`@/lib/validators`, já existentes); `STATUS_LABELS`/`STATUS_COLORS`/`STATUS_SERVICO_LABELS`/`STATUS_IMPOSTO_LABELS`/`STATUS_DOCUMENTO_COLORS` (`@/types`, já existentes); `recharts` (`ResponsiveContainer`, `ComposedChart`, `Bar`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid`, `PieChart`, `Pie`, `Cell`, `BarChart`, `Legend`).

- [ ] **Step 1: Substituir o conteúdo de `src/app/painel/page.tsx`**

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  PlusCircle, FileText, TrendingUp, Receipt, AlertCircle,
  Wallet, Package, Users, Percent,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, PieChart, Pie, Cell, BarChart, Legend,
} from 'recharts';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_LABELS, STATUS_IMPOSTO_LABELS } from '@/types';
import type { ResumoPainel, PeriodoDashboard } from '@/types';
import { useSession } from '@/context/SessionContext';
import StatCard from '@/components/ui/StatCard';
import ChartCard from '@/components/ui/ChartCard';
import ListPanel from '@/components/ui/ListPanel';

const PERIODOS: Array<{ value: PeriodoDashboard; label: string }> = [
  { value: 'mes',     label: 'Este mês' },
  { value: '6meses',  label: 'Últimos 6 meses' },
  { value: 'ano',     label: 'Este ano' },
  { value: 'total',   label: 'Total' },
];

const CORES_STATUS_NOTA: Record<string, string> = {
  rascunho: '#9CA3AF', lancada: '#3B82F6', recebida: '#22C55E', antecipada: '#A855F7',
  incompleta: '#EAB308', invalida: '#EF4444', substitutiva: '#06B6D4', substituida: '#F97316', cancelada: '#B91C1C',
};
const CORES_STATUS_IMPOSTO: Record<string, string> = {
  pendente: '#EAB308', pago: '#22C55E', vencido: '#EF4444', cancelado: '#9CA3AF',
};
const ATIVIDADE_ICONS: Record<string, React.ElementType> = {
  nota: FileText, gasto: Wallet, servico: Package, imposto: Receipt, colaborador: Users,
};

export default function Dashboard() {
  const { usuario } = useSession();
  const [periodo, setPeriodo]   = useState<PeriodoDashboard>('mes');
  const [resumo, setResumo]     = useState<ResumoPainel | null>(null);
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState(false);

  const carregar = useCallback((p: PeriodoDashboard) => {
    setLoading(true);
    setErro(false);
    fetch(`/api/painel/resumo?periodo=${p}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: ResumoPainel) => setResumo(d))
      .catch(() => setErro(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carregar(periodo); }, [periodo, carregar]);

  const userName = usuario?.nome?.split(' ')[0] ?? '';

  if (loading && !resumo) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const impostosPie = resumo
    ? (['pendente', 'pago', 'vencido', 'cancelado'] as const)
        .map(s => ({
          status: s,
          nome: STATUS_IMPOSTO_LABELS[s],
          // "pago" respeita o período selecionado; pendente/vencido são estado atual (ver agregarImpostos)
          valor: s === 'pendente' ? resumo.impostos.totalPendente
               : s === 'vencido'  ? resumo.impostos.totalVencido
               : s === 'pago'     ? resumo.impostos.totalPago
               : resumo.impostos.totalCancelado,
        }))
        .filter(d => d.valor > 0)
    : [];

  const notasPie = resumo
    ? Object.entries(resumo.notas.porStatus).map(([status, quantidade]) => ({
        status, nome: STATUS_LABELS[status] || status, quantidade,
      }))
    : [];

  const gastosPorServicoTop5 = resumo ? resumo.gastos.porServico.slice(0, 5) : [];

  return (
    <div className="p-5 md:p-8 max-w-6xl mx-auto space-y-8">

      {/* ── Cabeçalho ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pt-2">
        <div>
          <p className="text-gray-400 text-sm font-medium">Bem-vindo de volta</p>
          <h1 className="text-3xl font-bold text-gray-900 mt-0.5">Olá, {userName || 'Bem-vindo'} 👋</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={periodo}
            onChange={e => setPeriodo(e.target.value as PeriodoDashboard)}
            className="input-sm border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium bg-white"
          >
            {PERIODOS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <Link href="/notas/nova" className="btn-primary btn-lg shrink-0 hidden sm:flex">
            <PlusCircle size={18} /> Nova Nota
          </Link>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm">
          <AlertCircle size={15} className="shrink-0" />
          Não foi possível carregar o resumo executivo. Tente recarregar a página.
        </div>
      )}

      <Link href="/notas/nova" className="btn-primary w-full justify-center py-4 rounded-2xl text-base sm:hidden">
        <PlusCircle size={20} /> + Nova Nota
      </Link>

      {resumo && (
        <>
          {/* ── Indicadores: Financeiro ── */}
          <div>
            <p className="section-title">Financeiro</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Valor bruto" value={formatarMoeda(resumo.notas.totalBruto)} />
              <StatCard label="Valor líquido" value={formatarMoeda(resumo.notas.totalLiquido)} variant="success" />
              <StatCard label="Total de gastos" value={formatarMoeda(resumo.gastos.totalGastos)} variant="danger" />
              <StatCard label="Lucro geral" value={formatarMoeda(resumo.servicos.lucroTotal)} variant={resumo.servicos.lucroTotal >= 0 ? 'success' : 'danger'} />
              <StatCard
                label="Margem de lucro"
                value={resumo.servicos.valorContratadoTotal > 0
                  ? `${Math.round((resumo.servicos.lucroTotal / resumo.servicos.valorContratadoTotal) * 100)}%`
                  : '—'}
                icon={<Percent size={14} className="text-gray-300" />}
              />
              <StatCard
                label="Impostos"
                pares={[
                  { label: 'Pendente', value: formatarMoeda(resumo.impostos.totalPendente), variant: 'warning' },
                  { label: 'Vencido',  value: formatarMoeda(resumo.impostos.totalVencido),  variant: 'danger' },
                ]}
              />
            </div>
          </div>

          {/* ── Indicadores: Operacional ── */}
          <div>
            <p className="section-title">Operacional</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard label="Notas" value={String(resumo.notas.totalNotas)} />
              <StatCard label="Serviços em andamento" value={String(resumo.servicos.emAndamento)} />
              <StatCard label="Serviços concluídos" value={String(resumo.servicos.concluidos)} variant="success" />
              <StatCard label="Integrações em dia" value={String(resumo.colaboradores.emDia)} variant="success" />
              <StatCard
                label="Integrações a vencer"
                value={String(resumo.colaboradores.proximoVencimento + resumo.colaboradores.vencido)}
                variant={resumo.colaboradores.vencido > 0 ? 'danger' : resumo.colaboradores.proximoVencimento > 0 ? 'warning' : 'default'}
              />
            </div>
          </div>

          {/* ── Gráficos ── */}
          <div className="space-y-4">
            <p className="section-title">Análises</p>

            <ChartCard title={`Faturamento × Gastos × Lucro (últimos ${resumo.evolucaoMensal.length} meses)`} altura={300}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={resumo.evolucaoMensal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatarMoeda(v)} width={80} />
                  <Tooltip formatter={(v: number) => formatarMoeda(v)} />
                  <Legend />
                  <Bar dataKey="faturamento" name="Faturamento" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="gastos" name="Gastos" fill="#F87171" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="lucro" name="Lucro" stroke="#16A34A" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="grid md:grid-cols-3 gap-4">
              <ChartCard title="Notas por status">
                {notasPie.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center pt-16">Sem notas no período</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={notasPie} dataKey="quantidade" nameKey="nome" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {notasPie.map(d => <Cell key={d.status} fill={CORES_STATUS_NOTA[d.status] ?? '#9CA3AF'} />)}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard title="Gastos por serviço (top 5)">
                {gastosPorServicoTop5.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center pt-16">Sem gastos no período</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={gastosPorServicoTop5} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => formatarMoeda(v)} />
                      <YAxis type="category" dataKey="nome" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip formatter={(v: number) => formatarMoeda(v)} />
                      <Bar dataKey="total" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard title="Impostos por status">
                {impostosPie.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center pt-16">Sem impostos registrados</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={impostosPie} dataKey="valor" nameKey="nome" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {impostosPie.map(d => <Cell key={d.status} fill={CORES_STATUS_IMPOSTO[d.status]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatarMoeda(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
          </div>

          {/* ── Atalhos rápidos (mantidos do original) ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { href: '/relatorios', icon: TrendingUp, label: 'Relatório',  color: 'text-blue-600 bg-blue-50' },
              { href: '/impostos',   icon: Receipt,    label: 'Impostos',   color: 'text-orange-600 bg-orange-50' },
              { href: '/notas?status=incompleta', icon: FileText, label: 'Incompletas', color: 'text-amber-600 bg-amber-50' },
            ].map(({ href, icon: Icon, label, color }) => (
              <Link key={href} href={href} className="card-hover p-4 flex flex-col items-center gap-2 text-center">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${color}`}>
                  <Icon size={18} />
                </div>
                <span className="text-xs font-semibold text-gray-600">{label}</span>
              </Link>
            ))}
          </div>

          {/* ── Painéis ── */}
          <div className="grid md:grid-cols-2 gap-4">

            <ListPanel title="Últimas notas" actionHref="/notas" isEmpty={resumo.atividades.filter(a => a.tipo === 'nota').length === 0}>
              {resumo.atividades.filter(a => a.tipo === 'nota').slice(0, 5).map(a => (
                <Link key={a.href} href={a.href} className="card-hover flex items-center gap-3 p-3">
                  <FileText size={16} className="text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{a.titulo}</p>
                    <p className="text-xs text-gray-400">{formatarData(a.data)}</p>
                  </div>
                  {a.subtitulo && <p className="font-bold text-gray-900 text-sm shrink-0">{a.subtitulo}</p>}
                </Link>
              ))}
            </ListPanel>

            <ListPanel title="Últimos gastos" actionHref="/gastos" isEmpty={resumo.gastos.ultimos.length === 0}>
              {resumo.gastos.ultimos.map(g => (
                <Link key={g.id} href={`/gastos/${g.id}`} className="card-hover flex items-center gap-3 p-3">
                  <Wallet size={16} className="text-red-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{g.descricao}</p>
                    <p className="text-xs text-gray-400">{g.fornecedor || 'Sem fornecedor'} · {formatarData(g.data)}</p>
                  </div>
                  <p className="font-bold text-gray-900 text-sm shrink-0">{formatarMoeda(g.valor)}</p>
                </Link>
              ))}
            </ListPanel>

            <ListPanel title="Serviços com maior lucro" actionHref="/gastos/servicos" isEmpty={resumo.servicos.maisLucrativos.length === 0}>
              {resumo.servicos.maisLucrativos.map(s => (
                <Link key={s.id} href={`/gastos/servicos/${s.id}`} className="card-hover flex items-center gap-3 p-3">
                  <Package size={16} className="text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{s.nome}</p>
                    <p className="text-xs text-gray-400">{s.percentualConsumido}% do orçamento usado</p>
                  </div>
                  <p className={`font-bold text-sm shrink-0 ${s.lucro >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatarMoeda(s.lucro)}</p>
                </Link>
              ))}
            </ListPanel>

            <ListPanel title="Impostos próximos do vencimento" actionHref="/impostos" isEmpty={resumo.impostos.proximos.length === 0}>
              {resumo.impostos.proximos.map(i => (
                <div key={i.id} className="card p-3 flex items-center gap-3">
                  <Receipt size={16} className="text-orange-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{i.imposto || 'Imposto'}</p>
                    <p className={`text-xs ${(i.diasRestantes ?? 0) < 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                      {i.diasRestantes == null ? 'Sem vencimento' : i.diasRestantes < 0 ? `Vencido há ${Math.abs(i.diasRestantes)} dia(s)` : `Vence em ${i.diasRestantes} dia(s)`}
                    </p>
                  </div>
                  <p className="font-bold text-gray-900 text-sm shrink-0">{formatarMoeda(i.valor)}</p>
                </div>
              ))}
            </ListPanel>

            <ListPanel title="Integrações próximas da expiração" actionHref="/integracao" isEmpty={resumo.colaboradores.proximos.length === 0}>
              {resumo.colaboradores.proximos.map(c => (
                <Link key={c.id} href={`/integracao/${c.id}`} className="card-hover flex items-center gap-3 p-3">
                  <Users size={16} className={c.statusGeral === 'vencido' ? 'text-red-500 shrink-0' : 'text-amber-500 shrink-0'} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{c.nome}</p>
                    <p className="text-xs text-gray-400">{c.statusLabel}</p>
                  </div>
                </Link>
              ))}
            </ListPanel>

            <ListPanel title="Atividades recentes" isEmpty={resumo.atividades.length === 0}>
              {resumo.atividades.map((a, i) => {
                const Icon = ATIVIDADE_ICONS[a.tipo] ?? FileText;
                return (
                  <Link key={`${a.tipo}-${a.href}-${i}`} href={a.href} className="card-hover flex items-center gap-3 p-3">
                    <Icon size={16} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{a.titulo}</p>
                      <p className="text-xs text-gray-400">{formatarData(a.data)}</p>
                    </div>
                    {a.subtitulo && <p className="text-xs font-semibold text-gray-500 shrink-0">{a.subtitulo}</p>}
                  </Link>
                );
              })}
            </ListPanel>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Teste manual no navegador — dados corretos**

Com `npm run dev` rodando, abrir `/painel` logado com um usuário que já tenha notas/gastos/serviços/impostos/colaboradores cadastrados (dados reais de dev). Conferir:
- Os indicadores batem com os números já visíveis em `/notas`, `/gastos`, `/gastos/servicos`, `/impostos`, `/integracao`.
- Trocar o seletor de período e confirmar que os indicadores mudam (exceto Integrações, que não filtra por período).
- Os 4 gráficos renderizam sem erro no console.
- Os 6 painéis mostram itens reais, com links funcionando.

- [ ] **Step 4: Teste manual — responsividade**

Usar `resize_window` (preset mobile 375×812) no Browser pane e conferir que o grid de indicadores empilha em 2 colunas, os gráficos empilham verticalmente, e nada estoura a largura da tela.

- [ ] **Step 5: Teste manual — regressão**

Confirmar que o botão "Nova Nota" (desktop e mobile) e os 3 atalhos rápidos (Relatório/Impostos/Incompletas) continuam funcionando exatamente como antes.

- [ ] **Step 6: Commit**

```bash
git add src/app/painel/page.tsx
git commit -m "feat(painel): dashboard executiva — indicadores, graficos e paineis de todos os modulos"
```

---

### Task 7: Remover a rota antiga `/api/notas/resumo`

**Files:**
- Delete: `src/app/api/notas/resumo/route.ts`

**Interfaces:**
- Nenhuma — task de limpeza, sem produção de interface nova.

- [ ] **Step 1: Confirmar que não há mais nenhum consumidor**

Run: `grep -rn "notas/resumo" src/`
Expected: nenhuma ocorrência (a Task 6 já trocou `painel/page.tsx` para usar `/api/painel/resumo`).

- [ ] **Step 2: Deletar o arquivo**

```bash
rm src/app/api/notas/resumo/route.ts
```

Se o diretório `src/app/api/notas/resumo/` ficar vazio, remova o diretório também.

- [ ] **Step 3: Verificar tipos e rodar o servidor**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run dev` (ou confirmar que o servidor já rodando continua de pé) e recarregar `/painel` no navegador — deve continuar funcionando normalmente (não depende mais dessa rota).

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api/notas/resumo
git commit -m "chore(painel): remove /api/notas/resumo — substituida por /api/painel/resumo"
```

---

### Task 8: Validação final end-to-end

**Files:** nenhum arquivo novo — checklist de verificação manual.

- [ ] **Step 1: `npx tsc --noEmit` limpo em todo o projeto**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Todos os testes de agregação passam**

Run: `npx tsx src/lib/relatorios/test-agregacoes.ts`
Expected: `✅ Todos os testes passaram`.

- [ ] **Step 3: Consistência de dados — comparação manual**

Com um usuário de dev que já tenha dados reais em todos os módulos, abrir lado a lado (ou em sequência) `/painel`, `/notas`, `/gastos`, `/gastos/servicos`, `/impostos`, `/integracao`. Conferir que cada número mostrado na Dashboard bate exatamente com a soma/contagem visível na tela de origem daquele módulo, para o período "Total".

- [ ] **Step 4: Todos os 4 valores de período funcionam**

Trocar o seletor entre "Este mês" / "Últimos 6 meses" / "Este ano" / "Total" e confirmar que os indicadores financeiros/operacionais mudam de acordo, que o gráfico de evolução mensal **não muda** (sempre 6 meses fixos), e que os indicadores de Integrações **não mudam** (sempre estado atual).

- [ ] **Step 5: Responsividade final**

Testar em `resize_window` mobile (375×812), tablet (768×1024) e desktop (1280×800) — nenhum elemento deve estourar largura, quebrar layout ou ficar ilegível.

- [ ] **Step 6: Nenhuma regressão**

Confirmar que `/notas`, `/gastos`, `/gastos/servicos`, `/impostos`, `/integracao`, `/relatorios` continuam funcionando exatamente como antes desta mudança (a Dashboard não alterou nenhum desses módulos, só passou a consumir os mesmos dados).

Nenhum commit nesta task — é só verificação. Se qualquer step falhar, voltar à task correspondente, corrigir, e repetir a autorrevisão dessa task antes de continuar.
