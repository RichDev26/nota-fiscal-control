# Pagamento com Cartão de Crédito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar cartão de crédito como método de pagamento da assinatura, com cobrança síncrona (resposta definitiva do gateway durante a requisição), e endurecer o núcleo de confirmação de pagamento para que seja **impossível** conceder acesso sem aprovação real confirmada pelo backend.

**Architecture:** O frontend tokeniza o cartão via SDK oficial do Mercado Pago (dados do cartão nunca passam pelo nosso backend) e envia ao backend apenas `{ planoId, token, installments, payment_method_id, issuer_id }`. O backend resolve o preço a partir de um catálogo server-side, cria o pagamento com `binary_mode: true` (MP retorna `approved` ou `rejected`, sem estado intermediário), e **revalida a resposta** (status + valor + moeda + live_mode) antes de conceder acesso. A concessão passa por um compare-and-swap atômico que torna sync-response e webhook mutuamente idempotentes.

**Tech Stack:** Next.js 14 App Router, Prisma 5, `mercadopago@3.2.0` (SDK oficial já instalado), MercadoPago.js V2 (frontend, a carregar).

## Global Constraints

- **Regra crítica:** acesso é concedido **exclusivamente** por `processarPagamentoAprovado()`, e essa função só é chamada com um snapshot de pagamento **buscado do Mercado Pago pelo backend** (`payment.create` response ou `payment.get`). Nenhum campo vindo do cliente pode influenciar a decisão.
- Nunca persistir PAN, CVV, validade ou qualquer dado sensível de cartão. Só `token` (efêmero, do SDK), últimos 4 dígitos e bandeira são aceitáveis — e mesmo esses só se vierem da resposta do gateway.
- Preço, moeda, duração e plano são resolvidos **no servidor** a partir de `planoId`. O cliente nunca envia valor.
- Toda rota protegida mantém o padrão existente: `getSession()` (401) + `verificarAcessoAssinatura()` (402). **Exceção intencional:** rotas de pagamento (`/api/assinatura/*`) não exigem assinatura ativa — é exatamente quem está bloqueado que precisa pagar.
- Não quebrar PIX: o fluxo atual (`/api/assinatura/pix`, webhook, polling) deve continuar funcionando idêntico.
- Migrations são **aditivas**. Nenhum `DROP`, nenhuma coluna removida, nenhum dado de cliente alterado. Sistema tem clientes reais em produção.
- Testes seguem o padrão do projeto: script standalone via `npx tsx`, `console.log` com ✅/❌, `process.exit(1)` em falha. Sem jest/vitest.
- Todo dado escopado por `usuarioId`. Nunca consultar sem esse filtro.
- **Não fazer push para `master`.** Commits locais apenas.

## Vulnerabilidades pré-existentes corrigidas por este plano

Encontradas na auditoria do código atual (PIX), corrigidas nas Tasks 1 e 3:

- **V1 — Race condition (check-then-act):** `processarPagamentoAprovado` lê `cobranca.status`, decide, e só depois escreve. Sob READ COMMITTED (padrão do Postgres) duas confirmações concorrentes passam ambas pela verificação. Com cartão isso deixa de ser hipotético: a resposta síncrona e o webhook do mesmo pagamento chegam simultaneamente por construção.
- **V2 — Valor/moeda nunca validados:** `buscarPagamento()` retorna só `{ status }`, descartando `transaction_amount` e `currency_id`. Não há prova de que o valor pago corresponde ao cobrado.
- **V3 — `live_mode` nunca verificado:** um pagamento de teste poderia conceder acesso real se credenciais de teste vazassem para produção.
- **V4 — Sem rate limit na criação de cobrança:** endpoint de pagamento sem limite é o alvo clássico de card testing / enumeração de BIN.

---

### Task 1: Endurecer o núcleo de confirmação (corrige V1, V2, V3)

Fundação de segurança. Deve vir antes do cartão porque o cartão multiplica a concorrência.

**Files:**
- Modify: `src/lib/assinatura/servico.ts`
- Create: `src/lib/assinatura/test-confirmacao-segura.ts`

**Interfaces:**
- Consumes: `prisma` de `@/lib/prisma`; `temAcessoAtivo` de `./acesso`.
- Produces: `PagamentoConfirmado` (interface); `processarPagamentoAprovado(pagamento: PagamentoConfirmado, agora?: Date): Promise<ResultadoProcessamentoPagamento>` — **assinatura alterada**: agora recebe o snapshot completo do gateway, não só o id. `ResultadoProcessamentoPagamento` ganha novos motivos. Consumido por: webhook (Task 6), rota de cartão (Task 5).

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/lib/assinatura/test-confirmacao-segura.ts`:

```ts
// Execução: npx tsx src/lib/assinatura/test-confirmacao-segura.ts
import prisma from '@/lib/prisma';
import { processarPagamentoAprovado } from './servico';
import type { PagamentoConfirmado } from './servico';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

/** Snapshot válido (como viria do Mercado Pago) — os testes mutam campos específicos. */
function snapshot(over: Partial<PagamentoConfirmado> & { mpPaymentId: string }): PagamentoConfirmado {
  return {
    status: 'approved',
    statusDetail: 'accredited',
    valor: 149.9,
    moeda: 'BRL',
    liveMode: true,
    ...over,
  };
}

(async () => {
  const email = `teste-confirmacao-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Confirmacao' } });
  const assinatura = await prisma.assinatura.create({
    data: { usuarioId: usuario.id, trialFimEm: new Date(Date.now() - 30 * dia) }, // trial já expirado
  });

  const novaCobranca = async (mpPaymentId: string, valor = 149.9) =>
    prisma.cobranca.create({
      data: { assinaturaId: assinatura.id, valor, idempotencyKey: `idem-${mpPaymentId}`, mpPaymentId },
    });

  // ── 1. Caminho feliz ──
  const c1 = await novaCobranca(`mp-ok-${Date.now()}`);
  const r1 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c1.mpPaymentId! }));
  check('pagamento aprovado e válido → processado', r1.processado === true);

  const a1 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
  check('periodoFimEm foi estendido ~30 dias no futuro', a1!.periodoFimEm !== null && a1!.periodoFimEm! > new Date());

  // ── 2. Idempotência: mesmo pagamento de novo ──
  const periodoApos1 = a1!.periodoFimEm!;
  const r2 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c1.mpPaymentId! }));
  check('reprocessar o mesmo pagamento → recusado como já processado', r2.processado === false && r2.motivo === 'ja_processada');
  const a2 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
  check('período NÃO foi estendido duas vezes', a2!.periodoFimEm!.getTime() === periodoApos1.getTime());

  // ── 3. V2 — valor divergente deve ser REJEITADO ──
  const c3 = await novaCobranca(`mp-valor-${Date.now()}`);
  const r3 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c3.mpPaymentId!, valor: 1.0 }));
  check('valor pago menor que o cobrado → rejeitado', r3.processado === false && r3.motivo === 'valor_divergente');
  const c3After = await prisma.cobranca.findUnique({ where: { id: c3.id } });
  check('cobrança com valor divergente NÃO fica APROVADA', c3After!.status !== 'APROVADA');

  // ── 4. V2 — moeda divergente ──
  const c4 = await novaCobranca(`mp-moeda-${Date.now()}`);
  const r4 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c4.mpPaymentId!, moeda: 'USD' }));
  check('moeda diferente de BRL → rejeitado', r4.processado === false && r4.motivo === 'moeda_divergente');

  // ── 5. Status não-aprovado nunca concede ──
  for (const st of ['pending', 'in_process', 'rejected', 'cancelled', 'authorized', 'refunded', 'charged_back']) {
    const c = await novaCobranca(`mp-${st}-${Date.now()}`);
    const r = await processarPagamentoAprovado(snapshot({ mpPaymentId: c.mpPaymentId!, status: st }));
    check(`status "${st}" → NÃO concede acesso`, r.processado === false && r.motivo === 'status_nao_aprovado');
  }

  // ── 6. Pagamento desconhecido (id que não é nosso) ──
  const r6 = await processarPagamentoAprovado(snapshot({ mpPaymentId: 'mp-inexistente-999999' }));
  check('mpPaymentId desconhecido → recusado', r6.processado === false && r6.motivo === 'cobranca_nao_encontrada');

  // ── 7. V1 — CONCORRÊNCIA: mesma cobrança confirmada 5x em paralelo ──
  const c7 = await novaCobranca(`mp-race-${Date.now()}`);
  const snap7 = snapshot({ mpPaymentId: c7.mpPaymentId! });
  const antesRace = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const resultados = await Promise.all(Array.from({ length: 5 }, () => processarPagamentoAprovado(snap7)));
  const aprovados = resultados.filter(r => r.processado).length;
  check('5 confirmações simultâneas do MESMO pagamento → exatamente 1 processada', aprovados === 1, `processadas=${aprovados}`);

  const depoisRace = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const diffDias = Math.round((depoisRace.getTime() - antesRace.getTime()) / dia);
  check('período estendido EXATAMENTE 30 dias (não 150)', diffDias === 30, `estendeu ${diffDias} dias`);

  // ── 8. V1 — CONCORRÊNCIA: duas cobranças DIFERENTES em paralelo (não pode perder extensão) ──
  const cA = await novaCobranca(`mp-par-a-${Date.now()}`);
  const cB = await novaCobranca(`mp-par-b-${Date.now()}`);
  const antesPar = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const [rA, rB] = await Promise.all([
    processarPagamentoAprovado(snapshot({ mpPaymentId: cA.mpPaymentId! })),
    processarPagamentoAprovado(snapshot({ mpPaymentId: cB.mpPaymentId! })),
  ]);
  check('duas cobranças distintas → ambas processadas', rA.processado === true && rB.processado === true);
  const depoisPar = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const diffPar = Math.round((depoisPar.getTime() - antesPar.getTime()) / dia);
  check('dois pagamentos → 60 dias somados (sem lost update)', diffPar === 60, `estendeu ${diffPar} dias`);

  // ── Limpeza ──
  await prisma.cobranca.deleteMany({ where: { assinaturaId: assinatura.id } });
  await prisma.assinatura.delete({ where: { id: assinatura.id } });
  await prisma.usuario.delete({ where: { id: usuario.id } });

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx src/lib/assinatura/test-confirmacao-segura.ts`
Expected: erro de compilação/import — `PagamentoConfirmado` ainda não é exportado por `./servico`.

- [ ] **Step 3: Reescrever `processarPagamentoAprovado` em `src/lib/assinatura/servico.ts`**

Substitua o bloco `ResultadoProcessamentoPagamento` + `processarPagamentoAprovado` inteiro (linhas 21–59 do arquivo atual) por:

```ts
/**
 * Snapshot do pagamento COMO RETORNADO PELO MERCADO PAGO. Só o backend produz
 * este objeto (resposta de payment.create ou payment.get). Nenhum campo aqui
 * pode ter origem no cliente — é essa a fronteira de confiança do sistema.
 */
export interface PagamentoConfirmado {
  mpPaymentId: string;
  status: string;
  statusDetail: string | null;
  valor: number;
  moeda: string;
  liveMode: boolean;
}

export interface ResultadoProcessamentoPagamento {
  processado: boolean;
  motivo?:
    | 'cobranca_nao_encontrada'
    | 'ja_processada'
    | 'status_nao_aprovado'
    | 'valor_divergente'
    | 'moeda_divergente'
    | 'ambiente_divergente';
  novoPeriodoFimEm?: Date;
}

/** Tolerância de centavo para comparação de float (o gateway devolve number). */
const TOLERANCIA_VALOR = 0.01;
const MOEDA_ESPERADA = 'BRL';

/** Erro interno de concorrência — dispara retry, nunca vaza para o cliente. */
class ConflitoConcorrencia extends Error {}

/**
 * ÚNICO ponto do sistema que concede acesso pago. Idempotente e seguro sob
 * concorrência (resposta síncrona do cartão + webhook chegam juntos por
 * construção).
 *
 * Defesas, nesta ordem:
 *   1. Status deve ser exatamente 'approved' — qualquer outro estado (inclusive
 *      'authorized', que é pré-autorização sem captura) não concede nada.
 *   2. Ambiente: em produção só pagamento live_mode conta.
 *   3. Valor e moeda devem bater com a cobrança que NÓS criamos.
 *   4. Compare-and-swap atômico no status da Cobrança: só uma execução vence.
 *   5. Update condicional na Assinatura usando periodoFimEm como versão
 *      (optimistic locking) — impede lost update entre cobranças distintas.
 */
export async function processarPagamentoAprovado(
  pagamento: PagamentoConfirmado,
  agora: Date = new Date(),
): Promise<ResultadoProcessamentoPagamento> {
  // ── Defesa 1: só 'approved' concede. Tudo mais é recusa explícita. ──
  if (pagamento.status !== 'approved') {
    return { processado: false, motivo: 'status_nao_aprovado' };
  }

  // ── Defesa 2: pagamento de teste nunca concede acesso em produção. ──
  if (process.env.NODE_ENV === 'production' && pagamento.liveMode !== true) {
    return { processado: false, motivo: 'ambiente_divergente' };
  }

  // ── Defesa 3: moeda ──
  if (pagamento.moeda !== MOEDA_ESPERADA) {
    return { processado: false, motivo: 'moeda_divergente' };
  }

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const cobranca = await tx.cobranca.findUnique({
          where: { mpPaymentId: pagamento.mpPaymentId },
          include: { assinatura: true },
        });
        if (!cobranca) return { processado: false, motivo: 'cobranca_nao_encontrada' as const };

        // ── Defesa 3 (cont.): o valor pago deve bater com o que cobramos. ──
        if (Math.abs(pagamento.valor - cobranca.valor) > TOLERANCIA_VALOR) {
          return { processado: false, motivo: 'valor_divergente' as const };
        }

        // ── Defesa 4: compare-and-swap atômico. Só quem sai daqui com
        // count === 1 tem o direito de conceder acesso. Concorrentes veem 0. ──
        const cas = await tx.cobranca.updateMany({
          where: { id: cobranca.id, status: { in: ['PENDENTE', 'PROCESSANDO'] } },
          data: {
            status: 'APROVADA',
            statusDetalhe: pagamento.statusDetail,
            processadaEm: agora,
          },
        });
        if (cas.count === 0) return { processado: false, motivo: 'ja_processada' as const };

        // ── Defesa 5: estende o período com optimistic locking. periodoFimEm
        // funciona como coluna de versão: se outra transação alterou entre a
        // leitura e a escrita, count === 0 e refazemos tudo. ──
        const periodoAtual = cobranca.assinatura.periodoFimEm;
        const base = periodoAtual && periodoAtual > agora ? periodoAtual : agora;
        const novoPeriodoFimEm = new Date(base.getTime() + DURACAO_PERIODO_MS);

        const upd = await tx.assinatura.updateMany({
          where: { id: cobranca.assinaturaId, periodoFimEm: periodoAtual },
          data: {
            periodoFimEm: novoPeriodoFimEm,
            status: 'ATIVA',
            // Novo ciclo pode gerar novo lembrete de vencimento.
            lembreteEnviadoEm: null,
          },
        });
        if (upd.count === 0) throw new ConflitoConcorrencia();

        return { processado: true as const, novoPeriodoFimEm };
      });
    } catch (err) {
      if (err instanceof ConflitoConcorrencia) continue; // refaz a transação
      throw err;
    }
  }

  // 3 tentativas perdidas seguidas: não concede. Falha fechada. O webhook do
  // Mercado Pago reentrega depois e a cobrança é processada então.
  return { processado: false, motivo: 'ja_processada' };
}
```

**Nota:** `statusDetalhe` e `processadaEm` são colunas novas, criadas na Task 2. Rodar este teste antes da Task 2 falha no Prisma Client — a ordem Task 2 → re-rodar Task 1 está prevista no Step 5 abaixo.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: erros em `statusDetalhe` / `processadaEm` (colunas ainda não existem) e no webhook (assinatura da função mudou). Ambos são resolvidos nas Tasks 2 e 6 — esperado neste ponto.

- [ ] **Step 5: Commit (código, teste roda após a Task 2)**

```bash
git add src/lib/assinatura/servico.ts src/lib/assinatura/test-confirmacao-segura.ts
git commit -m "feat(pagamento): endurece confirmacao — CAS atomico, validacao de valor/moeda/ambiente"
```

---

### Task 2: Schema — estados de pagamento e campos de auditoria

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgresql.prisma`
- Create: `prisma/migrations/20260819000000_cartao_credito/migration.sql`

**Interfaces:**
- Produces: colunas novas em `Cobranca`: `statusDetalhe String?`, `processadaEm DateTime?`, `moeda String @default("BRL")`, `planoId String @default("mensal")`, `ultimosDigitos String?`, `bandeira String?`, `parcelas Int?`. Usadas por Tasks 1, 5, 6.

- [ ] **Step 1: Editar `prisma/schema.prisma`**

Substitua o modelo `Cobranca` inteiro por:

```prisma
model Cobranca {
  id             String     @id @default(cuid())
  assinaturaId   String
  metodo         String     @default("PIX")     // 'PIX' | 'CARTAO'
  planoId        String     @default("mensal")  // referência ao catálogo server-side
  valor          Float
  moeda          String     @default("BRL")
  // 'PENDENTE' | 'PROCESSANDO' | 'APROVADA' | 'REJEITADA' | 'CANCELADA' | 'FALHA' | 'EXPIRADA'
  // Só 'APROVADA' concede acesso — ver processarPagamentoAprovado().
  status         String     @default("PENDENTE")
  statusDetalhe  String?                        // status_detail do gateway (ex: cc_rejected_high_risk)
  processadaEm   DateTime?                      // quando o acesso foi efetivamente concedido
  mpPaymentId    String?    @unique
  idempotencyKey String     @unique
  qrCode         String?
  qrCodeBase64   String?
  // Cartão: SOMENTE dados não-sensíveis vindos da resposta do gateway.
  // NUNCA armazenar PAN completo, CVV ou validade.
  ultimosDigitos String?
  bandeira       String?
  parcelas       Int?
  expiraEm       DateTime?
  assinatura     Assinatura @relation(fields: [assinaturaId], references: [id], onDelete: Cascade)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  @@index([status])
  @@index([assinaturaId, status])
}
```

- [ ] **Step 2: Aplicar exatamente a mesma edição em `prisma/schema.postgresql.prisma`**

Os dois arquivos devem ficar idênticos exceto pelo bloco `datasource`.

- [ ] **Step 3: Escrever a migration Postgres (aditiva)**

Crie `prisma/migrations/20260819000000_cartao_credito/migration.sql`:

```sql
-- Aditiva: só ADD COLUMN com default/nullable. Nenhuma coluna removida,
-- nenhum dado existente alterado. Cobranças PIX atuais continuam válidas:
-- herdam planoId='mensal', moeda='BRL' e mantêm status/metodo intactos.
ALTER TABLE "Cobranca" ADD COLUMN "planoId" TEXT NOT NULL DEFAULT 'mensal';
ALTER TABLE "Cobranca" ADD COLUMN "moeda" TEXT NOT NULL DEFAULT 'BRL';
ALTER TABLE "Cobranca" ADD COLUMN "statusDetalhe" TEXT;
ALTER TABLE "Cobranca" ADD COLUMN "processadaEm" TIMESTAMP(3);
ALTER TABLE "Cobranca" ADD COLUMN "ultimosDigitos" TEXT;
ALTER TABLE "Cobranca" ADD COLUMN "bandeira" TEXT;
ALTER TABLE "Cobranca" ADD COLUMN "parcelas" INTEGER;

-- Índice de apoio para consultas de cobranças por assinatura+status.
CREATE INDEX "Cobranca_assinaturaId_status_idx" ON "Cobranca"("assinaturaId", "status");

-- Marca as cobranças JÁ aprovadas com processadaEm, para que o CAS e a
-- auditoria tenham a data. Usa updatedAt (aproximação segura do momento da
-- aprovação). NÃO altera status de nenhuma linha.
UPDATE "Cobranca" SET "processadaEm" = "updatedAt" WHERE "status" = 'APROVADA' AND "processadaEm" IS NULL;
```

- [ ] **Step 4: Sincronizar o banco local e gerar o client**

Run: `npx prisma db push && npx prisma generate`
Expected: `Your database is now in sync with your Prisma schema.` seguido de `✔ Generated Prisma Client`.

Se `prisma generate` falhar com `EPERM ... query_engine-windows.dll.node`, o servidor de dev está segurando o arquivo — pare o dev server e rode `npx prisma generate` de novo.

- [ ] **Step 5: Rodar o teste da Task 1 (agora deve passar)**

Run: `npx tsx src/lib/assinatura/test-confirmacao-segura.ts`
Expected: todas as linhas ✅, incluindo os dois testes de concorrência (`exatamente 1 processada` e `60 dias somados`).

Se `duas cobranças distintas → 60 dias somados` falhar com 30, o optimistic locking não está retentando — verifique se `ConflitoConcorrencia` está sendo capturado pelo `catch` e continuando o loop, e não escapando.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/schema.postgresql.prisma prisma/migrations/20260819000000_cartao_credito
git commit -m "feat(pagamento): schema — estados, plano, moeda e auditoria de cobranca"
```

---

### Task 3: Catálogo de planos server-side (preço nunca vem do cliente)

**Files:**
- Modify: `src/lib/assinatura/config.ts`
- Create: `src/lib/assinatura/test-planos.ts`

**Interfaces:**
- Produces: `type PlanoId = 'mensal'`; `interface Plano { id, nome, valor, moeda, duracaoDias, descricao }`; `PLANOS: Record<PlanoId, Plano>`; `resolverPlano(planoId: unknown): Plano | null`; `PLANO_PADRAO: Plano`. Mantém `VALOR_ASSINATURA` e `VALOR_ASSINATURA_FORMATADO` como estão (compatibilidade). Usado por Tasks 5, 6.

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/lib/assinatura/test-planos.ts`:

```ts
// Execução: npx tsx src/lib/assinatura/test-planos.ts
import { resolverPlano, PLANOS, PLANO_PADRAO, VALOR_ASSINATURA } from './config';

let falhas = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? '✅' : '❌'} ${n}`); if (!ok) falhas++; };

check('plano "mensal" existe e custa 149.90', PLANOS.mensal.valor === 149.9);
check('plano padrão é o mensal', PLANO_PADRAO.id === 'mensal');
check('VALOR_ASSINATURA continua igual ao plano mensal (compat PIX)', VALOR_ASSINATURA === PLANOS.mensal.valor);
check('resolverPlano("mensal") retorna o plano', resolverPlano('mensal')?.valor === 149.9);

// ── Entradas maliciosas: tudo que não for um id conhecido vira null ──
for (const entrada of [
  'inexistente', '', null, undefined, 123, {}, [],
  { valor: 1 },                 // objeto tentando injetar preço
  'mensal ',                    // espaço
  'MENSAL',                     // caixa diferente
  '__proto__', 'constructor',   // prototype pollution
  'toString',
]) {
  check(`resolverPlano(${JSON.stringify(entrada)}) → null`, resolverPlano(entrada) === null);
}

console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx src/lib/assinatura/test-planos.ts`
Expected: erro de import — `resolverPlano` / `PLANOS` não existem.

- [ ] **Step 3: Reescrever `src/lib/assinatura/config.ts`**

```ts
/**
 * Catálogo de planos — FONTE ÚNICA E SERVER-SIDE do preço.
 *
 * O cliente nunca envia valor, moeda ou duração: envia só um `planoId`, e o
 * backend resolve o resto aqui. Isso torna impossível manipular preço pelo
 * frontend (alterar JS, interceptar request, forjar body).
 */

export type PlanoId = 'mensal';

export interface Plano {
  id: PlanoId;
  nome: string;
  valor: number;
  moeda: 'BRL';
  duracaoDias: number;
  descricao: string;
}

export const PLANOS: Record<PlanoId, Plano> = {
  mensal: {
    id: 'mensal',
    nome: 'Mensal',
    valor: 149.9,
    moeda: 'BRL',
    duracaoDias: 30,
    descricao: 'Assinatura WorkPro Control — 30 dias',
  },
};

export const PLANO_PADRAO: Plano = PLANOS.mensal;

/**
 * Resolve um planoId vindo do cliente. Retorna null para QUALQUER entrada que
 * não seja exatamente um id conhecido — inclusive chaves herdadas do prototype
 * ('toString', '__proto__'), por isso o Object.prototype.hasOwnProperty.call.
 */
export function resolverPlano(planoId: unknown): Plano | null {
  if (typeof planoId !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(PLANOS, planoId)) return null;
  return PLANOS[planoId as PlanoId] ?? null;
}

// ── Compatibilidade: usados hoje pelo PIX e pela UI. Derivados do catálogo. ──
export const VALOR_ASSINATURA = PLANO_PADRAO.valor;
export const VALOR_ASSINATURA_FORMATADO = PLANO_PADRAO.valor.toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL',
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsx src/lib/assinatura/test-planos.ts`
Expected: todas ✅.

- [ ] **Step 5: Confirmar que a UI não quebrou (o formato de moeda mudou de literal para toLocaleString)**

Run: `node -e "console.log((149.9).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}))"`
Expected: `R$ 149,90` (com espaço não-quebrável — visualmente idêntico ao literal anterior).

- [ ] **Step 6: Commit**

```bash
git add src/lib/assinatura/config.ts src/lib/assinatura/test-planos.ts
git commit -m "feat(pagamento): catalogo de planos server-side — preco nunca vem do cliente"
```

---

### Task 4: Camada de gateway — cartão, busca enriquecida e mapeamento de erros

**Files:**
- Modify: `src/lib/payments/mercadopago.ts`
- Create: `src/lib/payments/erros-cartao.ts`
- Create: `src/lib/payments/test-erros-cartao.ts`

**Interfaces:**
- Consumes: SDK `mercadopago@3.2.0` (`Payment`, `MercadoPagoConfig`).
- Produces: `criarPagamentoCartao(input: CriarPagamentoCartaoInput): Promise<PagamentoCartaoResultado>`; `buscarPagamento(id)` **com retorno ampliado** `{ status, statusDetail, valor, moeda, liveMode }`; `mensagemErroCartao(status, statusDetail): string`. Usados por Tasks 5 e 6.

**Campos confirmados na tipagem do SDK instalado** (`node_modules/mercadopago/dist/clients/payment/`): request aceita `token`, `installments`, `issuer_id`, `payment_method_id`, `binary_mode`, `transaction_amount`, `description`, `external_reference`, `statement_descriptor`, `capture`, `payer`; response expõe `id`, `status`, `status_detail`, `transaction_amount`, `currency_id`, `live_mode`, `card`, `three_ds_info`.

- [ ] **Step 1: Escrever o teste do mapeamento de erros (falhando)**

Crie `src/lib/payments/test-erros-cartao.ts`:

```ts
// Execução: npx tsx src/lib/payments/test-erros-cartao.ts
import { mensagemErroCartao } from './erros-cartao';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };

const casos: Array<[string, string, string]> = [
  ['rejected', 'cc_rejected_insufficient_amount', 'limite'],
  ['rejected', 'cc_rejected_bad_filled_security_code', 'segurança'],
  ['rejected', 'cc_rejected_bad_filled_date', 'validade'],
  ['rejected', 'cc_rejected_bad_filled_card_number', 'número'],
  ['rejected', 'cc_rejected_call_for_authorize', 'autoriz'],
  ['rejected', 'cc_rejected_card_disabled', 'desabilitad'],
  ['rejected', 'cc_rejected_high_risk', 'recusado'],
  ['cancelled', 'by_collector', 'cancelad'],
];

for (const [status, detail, trecho] of casos) {
  const msg = mensagemErroCartao(status, detail);
  check(`${detail} → mensagem contém "${trecho}"`, msg.toLowerCase().includes(trecho.toLowerCase()), msg);
}

// ── Nunca vazar detalhe interno do gateway para o usuário ──
const msgDesconhecido = mensagemErroCartao('rejected', 'cc_rejected_algum_codigo_novo_do_mp');
check('status_detail desconhecido → mensagem genérica segura', msgDesconhecido.length > 0 && !msgDesconhecido.includes('cc_rejected'), msgDesconhecido);
check('mensagem genérica não expõe nome do gateway', !msgDesconhecido.toLowerCase().includes('mercado'), msgDesconhecido);

const msgNull = mensagemErroCartao('rejected', null);
check('status_detail null → mensagem genérica', msgNull.length > 0);

console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx src/lib/payments/test-erros-cartao.ts`
Expected: `Cannot find module './erros-cartao'`.

- [ ] **Step 3: Implementar `src/lib/payments/erros-cartao.ts`**

```ts
/**
 * Tradução de status/status_detail do Mercado Pago para mensagens seguras ao
 * usuário final.
 *
 * Regras:
 *   - Nunca expor código interno do gateway, nome do provedor ou detalhe técnico.
 *   - Nunca dizer "aprovado" em nenhum caminho de erro.
 *   - Código desconhecido cai numa mensagem genérica (o MP adiciona detalhes
 *     novos sem aviso; o default precisa ser seguro).
 */

const MENSAGENS: Record<string, string> = {
  // Dados preenchidos errado — o usuário consegue corrigir e tentar de novo.
  cc_rejected_bad_filled_card_number: 'Confira o número do cartão e tente novamente.',
  cc_rejected_bad_filled_date:        'Confira a data de validade do cartão e tente novamente.',
  cc_rejected_bad_filled_security_code: 'Confira o código de segurança (CVV) e tente novamente.',
  cc_rejected_bad_filled_other:       'Confira os dados do cartão e tente novamente.',

  // Limite / saldo
  cc_rejected_insufficient_amount:    'O cartão não tem limite disponível para esta compra.',

  // Requer ação do titular junto ao banco
  cc_rejected_call_for_authorize:     'Seu banco precisa autorizar esta compra. Entre em contato com o banco e tente novamente.',
  cc_rejected_card_disabled:          'Este cartão está desabilitado. Fale com o banco emissor ou use outro cartão.',
  cc_rejected_card_error:             'Não foi possível processar este cartão. Tente outro cartão.',
  cc_rejected_invalid_installments:   'Este cartão não aceita o número de parcelas escolhido.',
  cc_rejected_max_attempts:           'Muitas tentativas com este cartão. Aguarde alguns minutos ou use outro cartão.',
  cc_rejected_duplicated_payment:     'Já existe um pagamento igual em processamento. Aguarde antes de tentar de novo.',

  // Risco / antifraude — deliberadamente vago (não dar pistas a fraudador).
  cc_rejected_high_risk:              'Pagamento recusado. Tente outro cartão ou outro meio de pagamento.',
  cc_rejected_blacklist:              'Pagamento recusado. Tente outro cartão ou outro meio de pagamento.',

  // Cancelamento
  by_collector:                       'Pagamento cancelado.',
  by_payer:                           'Pagamento cancelado.',
  expired:                            'O prazo para concluir este pagamento expirou. Gere uma nova cobrança.',
};

const GENERICA = 'Não foi possível concluir o pagamento. Tente novamente ou use outro cartão.';

export function mensagemErroCartao(status: string, statusDetail: string | null): string {
  if (statusDetail && Object.prototype.hasOwnProperty.call(MENSAGENS, statusDetail)) {
    return MENSAGENS[statusDetail];
  }
  if (status === 'cancelled') return 'Pagamento cancelado.';
  if (status === 'in_process' || status === 'pending') {
    return 'Pagamento em análise. Assim que for confirmado, seu acesso é liberado automaticamente.';
  }
  return GENERICA;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsx src/lib/payments/test-erros-cartao.ts`
Expected: todas ✅.

- [ ] **Step 5: Ampliar `buscarPagamento` e adicionar `criarPagamentoCartao` em `src/lib/payments/mercadopago.ts`**

Substitua a função `buscarPagamento` existente (linhas 67–71) e adicione o bloco de cartão:

```ts
/** Snapshot completo do pagamento no gateway — base de TODA decisão de acesso. */
export interface PagamentoGateway {
  mpPaymentId: string;
  status: string;
  statusDetail: string | null;
  valor: number;
  moeda: string;
  liveMode: boolean;
  ultimosDigitos: string | null;
  bandeira: string | null;
  parcelas: number | null;
}

function mapearResposta(response: {
  id?: number | string; status?: string; status_detail?: string;
  transaction_amount?: number; currency_id?: string; live_mode?: boolean;
  installments?: number; payment_method_id?: string;
  card?: { last_four_digits?: string };
}): PagamentoGateway {
  return {
    mpPaymentId:    String(response.id ?? ''),
    status:         response.status ?? 'unknown',
    statusDetail:   response.status_detail ?? null,
    valor:          response.transaction_amount ?? 0,
    moeda:          response.currency_id ?? '',
    liveMode:       response.live_mode === true,
    ultimosDigitos: response.card?.last_four_digits ?? null,
    bandeira:       response.payment_method_id ?? null,
    parcelas:       response.installments ?? null,
  };
}

/**
 * Busca o pagamento REAL no gateway. Fonte da verdade para conceder acesso —
 * nunca confiar no corpo do webhook nem em nada vindo do cliente.
 */
export async function buscarPagamento(mpPaymentId: string): Promise<PagamentoGateway> {
  const payment  = new Payment(getClient());
  const response = await payment.get({ id: mpPaymentId });
  return mapearResposta(response);
}

export interface CriarPagamentoCartaoInput {
  valor: number;
  descricao: string;
  idempotencyKey: string;
  /** Token gerado pelo MercadoPago.js no browser. PAN/CVV nunca chegam aqui. */
  token: string;
  installments: number;
  paymentMethodId: string;
  issuerId?: string;
  payerEmail: string;
  payerCpfCnpj: string;
  /** Referência interna para reconciliação (id da nossa Cobranca). */
  externalReference: string;
}

/**
 * Cria o pagamento com cartão de forma SÍNCRONA e definitiva.
 *
 * binary_mode: true — documentado no SDK como "the payment is either instantly
 * approved or rejected (no pending state)". É o mecanismo oficial do Mercado
 * Pago para o comportamento pedido: a resposta desta chamada já é a decisão.
 *
 * capture não é enviado (default true) — cobrança capturada na hora, não
 * pré-autorização. 'authorized' (autorizado sem captura) NÃO concede acesso
 * em processarPagamentoAprovado().
 */
export async function criarPagamentoCartao(input: CriarPagamentoCartaoInput): Promise<PagamentoGateway> {
  const payment = new Payment(getClient());
  const cpfCnpj = input.payerCpfCnpj.replace(/\D/g, '');
  const tipoDoc = cpfCnpj.length === 14 ? 'CNPJ' : 'CPF';

  const response = await payment.create({
    body: {
      transaction_amount: input.valor,
      description:        input.descricao,
      token:              input.token,
      installments:       input.installments,
      payment_method_id:  input.paymentMethodId,
      ...(input.issuerId ? { issuer_id: Number(input.issuerId) } : {}),
      binary_mode:        true,
      external_reference: input.externalReference,
      statement_descriptor: 'WORKPROCONTROL',
      payer: {
        email: input.payerEmail,
        identification: { type: tipoDoc, number: cpfCnpj },
      },
    },
    requestOptions: { idempotencyKey: input.idempotencyKey },
  });

  if (!response.id) throw new Error('Resposta do gateway sem id de pagamento');
  return mapearResposta(response);
}
```

- [ ] **Step 6: Ajustar o webhook para o novo retorno (mantém PIX funcionando)**

Em `src/app/api/webhooks/mercadopago/route.ts`, substitua o bloco `try` (linhas 27–35) por:

```ts
  try {
    const pagamento = await buscarPagamento(dataId);
    // Toda a decisão (status, valor, moeda, ambiente, idempotência) é do núcleo.
    const resultado = await processarPagamentoAprovado(pagamento);
    logInfo('webhooks.mercadopago', 'Webhook processado', { dataId, status: pagamento.status, ...resultado });
    return NextResponse.json({ ok: true });
  } catch (err) {
```

**Por que remover o `if (status !== 'approved') return` daqui:** essa checagem agora vive dentro de `processarPagamentoAprovado`, junto com valor/moeda/ambiente. Uma única porta de entrada para a decisão, impossível de contornar por um caminho novo esquecer a validação.

- [ ] **Step 7: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Regressão do PIX — o webhook ainda concede acesso corretamente**

Run: `npx tsx src/lib/assinatura/test-confirmacao-segura.ts`
Expected: todas ✅ (o núcleo não mudou, só quem o chama).

- [ ] **Step 9: Commit**

```bash
git add src/lib/payments/mercadopago.ts src/lib/payments/erros-cartao.ts src/lib/payments/test-erros-cartao.ts src/app/api/webhooks/mercadopago/route.ts
git commit -m "feat(pagamento): gateway de cartao (binary_mode) + snapshot completo + erros seguros"
```

---

### Task 5: Rate limiting de pagamento (corrige V4)

**Files:**
- Create: `src/lib/payments/rate-limit-pagamento.ts`
- Create: `src/lib/payments/test-rate-limit-pagamento.ts`

**Interfaces:**
- Produces: `checkPagamentoRateLimit(chave: string): { allowed: boolean; retryAfter: number }`. Usado pelas rotas de cartão (Task 6) e PIX (Task 6).

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/lib/payments/test-rate-limit-pagamento.ts`:

```ts
// Execução: npx tsx src/lib/payments/test-rate-limit-pagamento.ts
import { checkPagamentoRateLimit, MAX_TENTATIVAS } from './rate-limit-pagamento';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };

const chave = `usuario-teste-${Date.now()}`;

let permitidas = 0;
for (let i = 0; i < MAX_TENTATIVAS; i++) {
  if (checkPagamentoRateLimit(chave).allowed) permitidas++;
}
check(`primeiras ${MAX_TENTATIVAS} tentativas são permitidas`, permitidas === MAX_TENTATIVAS, `permitidas=${permitidas}`);

const excedente = checkPagamentoRateLimit(chave);
check('tentativa acima do limite é bloqueada', excedente.allowed === false);
check('bloqueio informa retryAfter em segundos', excedente.retryAfter > 0);

const outraChave = checkPagamentoRateLimit(`outro-usuario-${Date.now()}`);
check('outro usuário não é afetado pelo limite do primeiro', outraChave.allowed === true);

console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx src/lib/payments/test-rate-limit-pagamento.ts`
Expected: `Cannot find module './rate-limit-pagamento'`.

- [ ] **Step 3: Implementar `src/lib/payments/rate-limit-pagamento.ts`**

```ts
/**
 * Rate limit de tentativas de pagamento — mesmo padrão de
 * src/lib/auth-rate-limit.ts (janela deslizante em memória).
 *
 * Motivação de segurança: endpoint de cobrança sem limite é o alvo clássico de
 * card testing (validar listas de cartões roubados) e de enumeração de BIN.
 * Limita por USUÁRIO (sessão autenticada), não por IP — o atacante já precisa
 * de conta válida para chegar aqui, e o IP é trivialmente rotacionável.
 *
 * Em produção multi-instância, substituir por Redis (mesma ressalva do
 * auth-rate-limit atual).
 */

interface Bucket { count: number; resetAt: number }

const store = new Map<string, Bucket>();

const WINDOW_MS = 10 * 60 * 1000;  // 10 minutos
export const MAX_TENTATIVAS = 5;   // 5 tentativas de cobrança por janela

function clean(): void {
  const now = Date.now();
  store.forEach((bucket, key) => { if (now > bucket.resetAt) store.delete(key); });
}

export interface PagamentoRateLimitResult {
  allowed: boolean;
  retryAfter: number; // segundos até liberar (0 = liberado)
}

export function checkPagamentoRateLimit(chave: string): PagamentoRateLimitResult {
  if (Math.random() < 0.01) clean();

  const now = Date.now();
  const bucket = store.get(chave);

  if (!bucket || now > bucket.resetAt) {
    store.set(chave, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= MAX_TENTATIVAS) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsx src/lib/payments/test-rate-limit-pagamento.ts`
Expected: todas ✅.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/rate-limit-pagamento.ts src/lib/payments/test-rate-limit-pagamento.ts
git commit -m "feat(pagamento): rate limit por usuario nas tentativas de cobranca"
```

---

### Task 6: Endpoint de cartão + rate limit no PIX

**Files:**
- Create: `src/app/api/assinatura/cartao/route.ts`
- Modify: `src/app/api/assinatura/pix/route.ts`

**Interfaces:**
- Consumes: `resolverPlano` (Task 3); `criarPagamentoCartao`, `mensagemErroCartao` (Task 4); `processarPagamentoAprovado`, `PagamentoConfirmado` (Task 1); `checkPagamentoRateLimit` (Task 5); `validarCpfCnpj` de `@/lib/validators`.
- Produces: `POST /api/assinatura/cartao` → `{ aprovado: true }` **ou** `{ aprovado: false, mensagem: string }`. Consumido pelo frontend (Task 7).

- [ ] **Step 1: Implementar `src/app/api/assinatura/cartao/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { validarCpfCnpj } from '@/lib/validators';
import { criarPagamentoCartao } from '@/lib/payments/mercadopago';
import { mensagemErroCartao } from '@/lib/payments/erros-cartao';
import { checkPagamentoRateLimit } from '@/lib/payments/rate-limit-pagamento';
import { processarPagamentoAprovado } from '@/lib/assinatura/servico';
import { resolverPlano } from '@/lib/assinatura/config';
import { logError, logInfo } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

/**
 * Cobrança com cartão — síncrona.
 *
 * FRONTEIRA DE CONFIANÇA: do corpo da requisição usamos APENAS
 *   - planoId  → resolvido contra o catálogo server-side (preço nunca vem do cliente)
 *   - token, installments, paymentMethodId, issuerId → opacos, repassados ao gateway
 *   - cpfCnpj  → só quando o usuário ainda não tem um salvo
 * Qualquer outro campo enviado é ignorado. Status, valor, id de pagamento e
 * usuário JAMAIS são lidos do cliente.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  // Rate limit por usuário — anti card testing.
  const rl = checkPagamentoRateLimit(session.sub);
  if (!rl.allowed) {
    return NextResponse.json(
      { aprovado: false, mensagem: `Muitas tentativas de pagamento. Aguarde ${Math.ceil(rl.retryAfter / 60)} minuto(s) e tente novamente.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  // ── Plano: preço/moeda/duração vêm do servidor, nunca do cliente ──
  const plano = resolverPlano(body.planoId ?? 'mensal');
  if (!plano) return NextResponse.json({ aprovado: false, mensagem: 'Plano inválido.' }, { status: 400 });

  // ── Dados do cartão: opacos, só repassados ao gateway ──
  const token           = typeof body.token === 'string' ? body.token : '';
  const paymentMethodId = typeof body.paymentMethodId === 'string' ? body.paymentMethodId : '';
  const issuerId        = typeof body.issuerId === 'string' ? body.issuerId : undefined;
  const installments    = Number.isInteger(body.installments) ? Number(body.installments) : 1;

  if (!token || !paymentMethodId) {
    return NextResponse.json({ aprovado: false, mensagem: 'Dados do cartão incompletos. Tente novamente.' }, { status: 400 });
  }
  // Nesta fase só há plano à vista. Impede manipulação de parcelas.
  if (installments !== 1) {
    return NextResponse.json({ aprovado: false, mensagem: 'Número de parcelas inválido.' }, { status: 400 });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: session.sub } });
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

  let cpfCnpj = usuario.cpfCnpj;
  if (!cpfCnpj) {
    if (typeof body.cpfCnpj !== 'string' || !validarCpfCnpj(body.cpfCnpj)) {
      return NextResponse.json({ aprovado: false, mensagem: 'Informe um CPF ou CNPJ válido.', precisaCpfCnpj: true }, { status: 400 });
    }
    cpfCnpj = body.cpfCnpj.replace(/\D/g, '');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { cpfCnpj } });
  }

  // A assinatura é sempre a DO USUÁRIO DA SESSÃO — nunca um id vindo do corpo.
  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
  if (!assinatura) return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 });

  // Cobrança criada ANTES da chamada ao gateway: garante que todo pagamento
  // tenha registro local, mesmo se o processo cair no meio.
  const idempotencyKey = randomUUID();
  const cobranca = await prisma.cobranca.create({
    data: {
      assinaturaId: assinatura.id,
      metodo:       'CARTAO',
      planoId:      plano.id,
      valor:        plano.valor,
      moeda:        plano.moeda,
      status:       'PROCESSANDO',
      parcelas:     installments,
      idempotencyKey,
    },
  });

  let pagamento;
  try {
    pagamento = await criarPagamentoCartao({
      valor:             plano.valor,
      descricao:         plano.descricao,
      idempotencyKey,
      token,
      installments,
      paymentMethodId,
      issuerId,
      payerEmail:        usuario.email,
      payerCpfCnpj:      cpfCnpj,
      externalReference: cobranca.id,
    });
  } catch (err) {
    // Gateway indisponível / timeout / resposta inválida.
    // NUNCA concede acesso. Estado FALHA é terminal e auditável.
    logError('assinatura.cartao', `Falha ao criar pagamento com cartão (cobranca ${cobranca.id})`, err as Error);
    await prisma.cobranca.update({ where: { id: cobranca.id }, data: { status: 'FALHA' } });
    return NextResponse.json(
      { aprovado: false, mensagem: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' },
      { status: 502 },
    );
  }

  // Vincula o pagamento do gateway à nossa cobrança e guarda só metadados
  // não-sensíveis (últimos 4 dígitos e bandeira vêm da RESPOSTA do gateway).
  await prisma.cobranca.update({
    where: { id: cobranca.id },
    data: {
      mpPaymentId:    pagamento.mpPaymentId,
      statusDetalhe:  pagamento.statusDetail,
      ultimosDigitos: pagamento.ultimosDigitos,
      bandeira:       pagamento.bandeira,
    },
  });

  // ── DECISÃO: delegada ao núcleo, que revalida status/valor/moeda/ambiente
  // e é idempotente contra o webhook do mesmo pagamento. ──
  const resultado = await processarPagamentoAprovado(pagamento);

  logInfo('assinatura.cartao', 'Pagamento com cartão processado', {
    cobrancaId: cobranca.id,
    status: pagamento.status,
    processado: resultado.processado,
    motivo: resultado.motivo,
  });

  if (resultado.processado) {
    return NextResponse.json({ aprovado: true });
  }

  // Não aprovado: registra o estado real e devolve mensagem segura.
  // 'ja_processada' significa que o webhook chegou primeiro — o acesso JÁ está
  // liberado, então para o usuário isso é sucesso.
  if (resultado.motivo === 'ja_processada') {
    return NextResponse.json({ aprovado: true });
  }

  const statusFinal =
    pagamento.status === 'rejected'  ? 'REJEITADA' :
    pagamento.status === 'cancelled' ? 'CANCELADA' :
    pagamento.status === 'approved'  ? 'FALHA' : // aprovado mas reprovado na validação → auditar
    'PENDENTE';

  await prisma.cobranca.update({ where: { id: cobranca.id }, data: { status: statusFinal } });

  return NextResponse.json({
    aprovado: false,
    mensagem: mensagemErroCartao(pagamento.status, pagamento.statusDetail),
  });
}
```

- [ ] **Step 2: Aplicar rate limit e plano ao PIX**

Em `src/app/api/assinatura/pix/route.ts`, adicione os imports:

```ts
import { checkPagamentoRateLimit } from '@/lib/payments/rate-limit-pagamento';
import { resolverPlano } from '@/lib/assinatura/config';
```

Substitua a linha `import { VALOR_ASSINATURA } from '@/lib/assinatura/config';` pelo import acima (o `VALOR_ASSINATURA` deixa de ser usado nesta rota).

Logo após o bloco `if (!session) return ...`, insira:

```ts
  const rl = checkPagamentoRateLimit(session.sub);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Muitas tentativas de pagamento. Aguarde ${Math.ceil(rl.retryAfter / 60)} minuto(s).` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }
```

Troque a declaração do body e adicione a resolução de plano:

```ts
  let body: { cpfCnpj?: string; planoId?: string };
  try { body = await req.json(); } catch { body = {}; }

  const plano = resolverPlano(body.planoId ?? 'mensal');
  if (!plano) return NextResponse.json({ error: 'Plano inválido.' }, { status: 400 });
```

E troque as duas ocorrências de `VALOR_ASSINATURA` por `plano.valor`, adicionando `planoId`/`moeda`/`metodo` no create:

```ts
  const cobranca = await prisma.cobranca.create({
    data: {
      assinaturaId: assinatura.id,
      metodo:  'PIX',
      planoId: plano.id,
      valor:   plano.valor,
      moeda:   plano.moeda,
      idempotencyKey,
    },
  });
```

e em `criarCobrancaPix({ valor: plano.valor, descricao: plano.descricao, ... })`.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Confirmar que a rota de cartão exige sessão**

Com `npm run dev` rodando (porta 3003 neste projeto):

```powershell
try { Invoke-WebRequest -Uri "http://localhost:3003/api/assinatura/cartao" -Method POST -ContentType "application/json" -Body '{"planoId":"mensal"}' -UseBasicParsing } catch { Write-Output "Status: $($_.Exception.Response.StatusCode.value__)" }
```
Expected: `Status: 401`.

(Use PowerShell — `curl` é interceptado por um hook neste ambiente.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/assinatura/cartao/route.ts src/app/api/assinatura/pix/route.ts
git commit -m "feat(pagamento): endpoint sincrono de cartao + rate limit e plano no PIX"
```

---

### Task 7: Frontend — seleção de método e tokenização

**Files:**
- Modify: `src/components/assinatura/TelaBloqueio.tsx`
- Create: `src/components/assinatura/FormularioCartao.tsx`

**Interfaces:**
- Consumes: `POST /api/assinatura/cartao` (Task 6); `VALOR_ASSINATURA_FORMATADO`, `PLANO_PADRAO` (Task 3).
- Produces: componente `FormularioCartao` com props `{ onAprovado: () => void }`.

**Restrição de segurança do frontend:** o componente **nunca** decide aprovação. Ele envia o token e renderiza exatamente o que `aprovado` do backend disser. Não existe caminho no código que chame `router.refresh()` sem `aprovado === true` vindo da resposta HTTP do nosso backend.

- [ ] **Step 1: Confirmar a API real do SDK antes de escrever o componente**

O SDK do browser é carregado por script (`https://sdk.mercadopago.com/js/v2`) e **não** está em `node_modules` — portanto sua superfície de API não pode ser verificada por leitura de tipos como foi feita com o SDK de servidor.

Antes de escrever `FormularioCartao.tsx`, confirme na documentação oficial vigente do Mercado Pago:
1. O método de inicialização (`new MercadoPago(publicKey)`).
2. A API de campos seguros/CardForm em uso e o formato exato do callback que devolve `token`, `payment_method_id` e `issuer_id`.
3. Se a conta exige tratamento de 3DS (resposta com `three_ds_info`).

Não escreva o componente com base em memória. Se a API divergir do esboço do Step 2, ajuste o componente à API real e registre a divergência no commit.

- [ ] **Step 2: Implementar `src/components/assinatura/FormularioCartao.tsx`**

Esboço a ser conferido contra a API real (Step 1). A lógica de segurança — estados de submissão, ausência de decisão no cliente, tratamento de erro — é obrigatória e não muda.

**A única peça deliberadamente não escrita aqui é `tokenizarEEnviar`**, porque sua implementação depende da API exata do SDK do browser confirmada no Step 1. O contrato dela é fixo e não negociável:

1. Pede ao SDK do Mercado Pago para tokenizar os campos do cartão.
2. Se a tokenização falhar → `setErro(<mensagem amigável>)`, `setEstado('pronto')`, **e retorna sem chamar o backend**.
3. Se a tokenização der certo → chama `submeter({ token, paymentMethodId, issuerId })` com os valores devolvidos pelo SDK.
4. **Nunca** chama `onAprovado()` diretamente — só `submeter()` pode, e só após `aprovado === true` do backend.

Escreva `tokenizarEEnviar` conforme a API real do SDK, respeitando esse contrato:

```tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { VALOR_ASSINATURA_FORMATADO, PLANO_PADRAO } from '@/lib/assinatura/config';

declare global {
  interface Window { MercadoPago?: new (publicKey: string, options?: { locale?: string }) => unknown }
}

interface Props { onAprovado: () => void }

type Estado = 'carregando_sdk' | 'pronto' | 'processando' | 'erro';

export default function FormularioCartao({ onAprovado }: Props) {
  const [estado, setEstado] = useState<Estado>('carregando_sdk');
  const [erro, setErro]     = useState('');
  const mpRef = useRef<unknown>(null);
  // Trava sincrônica contra duplo clique: useState é assíncrono demais para
  // impedir dois submits disparados no mesmo tick.
  const enviandoRef = useRef(false);

  // Carrega o SDK oficial uma única vez.
  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
    if (!publicKey) { setEstado('erro'); setErro('Pagamento com cartão indisponível no momento.'); return; }

    const existente = document.querySelector<HTMLScriptElement>('script[data-mp-sdk]');
    const init = () => {
      if (!window.MercadoPago) { setEstado('erro'); setErro('Não foi possível carregar o formulário de pagamento.'); return; }
      mpRef.current = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      setEstado('pronto');
    };

    if (existente) { if (window.MercadoPago) init(); else existente.addEventListener('load', init); return; }

    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.dataset.mpSdk = 'true';
    script.onload = init;
    script.onerror = () => { setEstado('erro'); setErro('Não foi possível carregar o formulário de pagamento.'); };
    document.body.appendChild(script);
  }, []);

  const submeter = useCallback(async (dadosTokenizados: {
    token: string; paymentMethodId: string; issuerId?: string;
  }) => {
    if (enviandoRef.current) return;      // trava dura contra duplo envio
    enviandoRef.current = true;
    setEstado('processando');
    setErro('');

    try {
      const r = await fetch('/api/assinatura/cartao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planoId: PLANO_PADRAO.id,   // referência, nunca preço
          token: dadosTokenizados.token,
          paymentMethodId: dadosTokenizados.paymentMethodId,
          issuerId: dadosTokenizados.issuerId,
          installments: 1,
        }),
      });
      const d = await r.json();

      // ÚNICO caminho de sucesso do componente: o backend afirmou aprovado.
      if (r.ok && d.aprovado === true) { onAprovado(); return; }

      setErro(d.mensagem || 'Não foi possível concluir o pagamento.');
      setEstado('pronto');
    } catch {
      // Falha de rede: o pagamento PODE ter sido processado. Nunca assumir
      // sucesso nem falha — orientar o usuário a verificar.
      setErro('Não foi possível confirmar o pagamento. Atualize a página antes de tentar de novo.');
      setEstado('pronto');
    } finally {
      enviandoRef.current = false;
    }
  }, [onAprovado]);

  if (estado === 'carregando_sdk') {
    return <p className="text-sm text-gray-400 text-center py-6">Carregando formulário seguro...</p>;
  }

  return (
    <div>
      {/* Campos do cartão renderizados pelo SDK do Mercado Pago — os dados
          sensíveis ficam isolados e nunca tocam nosso DOM nem nosso backend. */}
      <div id="form-cartao" />

      {erro && <p className="text-red-600 text-sm mt-3 text-center">{erro}</p>}

      <button
        type="button"
        disabled={estado === 'processando'}
        className="w-full bg-blue-600 text-white font-semibold rounded-xl py-3 mt-4 disabled:opacity-50"
        onClick={tokenizarEEnviar}
      >
        {estado === 'processando' ? 'Processando pagamento...' : `Pagar ${VALOR_ASSINATURA_FORMATADO}`}
      </button>

      <p className="text-gray-400 text-xs mt-3 text-center">
        Não guardamos os dados do seu cartão.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar seleção de método em `TelaBloqueio.tsx`**

Na etapa `'inicial'`, ofereça dois botões — "Pagar com PIX" (fluxo atual, inalterado) e "Pagar com cartão" (novo estado `'cartao'`, que renderiza `<FormularioCartao onAprovado={() => router.refresh()} />`).

Amplie o `useState` de etapa para incluir o novo estado:

```tsx
const [etapa, setEtapa] = useState<'inicial' | 'checkout' | 'qrcode' | 'cartao'>('inicial');
```

O `onAprovado` só é chamado pelo `FormularioCartao` quando o backend respondeu `aprovado: true` — não há caminho de sucesso no cliente sem essa confirmação.

- [ ] **Step 4: Documentar a variável de ambiente**

Em `.env.example`, adicione:

```
# Mercado Pago — chave PÚBLICA (frontend, tokenização de cartão).
# É pública por natureza: só permite tokenizar, nunca cobrar.
NEXT_PUBLIC_MP_PUBLIC_KEY="APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

- [ ] **Step 5: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

- [ ] **Step 6: Verificação visual**

Com o dev server rodando e um usuário de teste com trial expirado, abrir o painel e confirmar: a tela de bloqueio mostra as duas opções; escolher cartão carrega o formulário; o botão fica desabilitado durante o processamento; **nenhuma navegação para tela de sucesso ocorre antes da resposta do backend**.

- [ ] **Step 7: Commit**

```bash
git add src/components/assinatura/TelaBloqueio.tsx src/components/assinatura/FormularioCartao.tsx .env.example
git commit -m "feat(pagamento): UI de cartao com tokenizacao — frontend nunca decide aprovacao"
```

---

### Task 8: Suíte adversarial — tentativas reais de burlar o pagamento

Esta é a task que prova a exigência central: **é impossível conceder acesso sem aprovação real**.

**Files:**
- Create: `scripts/test-seguranca-pagamento.ts`

**Interfaces:**
- Consumes: servidor de dev rodando em `http://localhost:3003`; `prisma` direto para montar cenários e verificar estado final.

- [ ] **Step 1: Escrever a suíte**

Crie `scripts/test-seguranca-pagamento.ts`:

```ts
/**
 * Suíte adversarial: tenta CONCEDER ACESSO SEM PAGAR de todas as formas
 * plausíveis. Todo teste passa quando o ataque FALHA.
 *
 * Pré-requisito: servidor de dev rodando em http://localhost:3003.
 * Execução: npx tsx scripts/test-seguranca-pagamento.ts
 */
import prisma from '../src/lib/prisma';
import { processarPagamentoAprovado } from '../src/lib/assinatura/servico';
import { temAcessoAtivo } from '../src/lib/assinatura/acesso';

const BASE = 'http://localhost:3003';
let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

async function criarUsuarioBloqueado(sufixo: string) {
  const email = `sec-${sufixo}-${Date.now()}@exemplo.com`;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha: 'Teste1234', nome: 'Sec Teste' }),
  });
  if (!r.ok) throw new Error(`register falhou: ${r.status}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  // Expira o trial: usuário passa a estar BLOQUEADO.
  await prisma.assinatura.update({
    where: { usuarioId: usuario!.id },
    data: { trialFimEm: new Date(Date.now() - dia), periodoFimEm: null },
  });
  return { usuario: usuario!, cookie, email };
}

const temAcesso = async (usuarioId: string) =>
  temAcessoAtivo(await prisma.assinatura.findUnique({ where: { usuarioId } }));

(async () => {
  const criados: string[] = [];

  // ══ ATAQUE 1: forjar aprovação no corpo da requisição ══
  {
    const { usuario, cookie } = await criarUsuarioBloqueado('forjar');
    criados.push(usuario.id);
    const r = await fetch(`${BASE}/api/assinatura/cartao`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        planoId: 'mensal', token: 'token-falso', paymentMethodId: 'visa', installments: 1,
        // campos maliciosos:
        aprovado: true, status: 'approved', paymentStatus: 'approved',
        valor: 0.01, transaction_amount: 0.01,
      }),
    });
    const d = await r.json().catch(() => ({}));
    check('ATAQUE forjar aprovado=true no body → não concede', d.aprovado !== true);
    check('ATAQUE forjar → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
  }

  // ══ ATAQUE 2: manipular o preço ══
  {
    const { usuario, cookie } = await criarUsuarioBloqueado('preco');
    criados.push(usuario.id);
    await fetch(`${BASE}/api/assinatura/cartao`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ planoId: 'mensal', valor: 0.01, preco: 0.01, token: 'x', paymentMethodId: 'visa', installments: 1 }),
    });
    const cobrancas = await prisma.cobranca.findMany({
      where: { assinatura: { usuarioId: usuario.id } },
    });
    const precoErrado = cobrancas.some(c => c.valor !== 149.9);
    check('ATAQUE manipular preço → cobrança sempre com o valor do catálogo', !precoErrado);
    check('ATAQUE preço → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
  }

  // ══ ATAQUE 3: plano inexistente / prototype pollution ══
  {
    const { usuario, cookie } = await criarUsuarioBloqueado('plano');
    criados.push(usuario.id);
    for (const planoId of ['gratis', '__proto__', 'constructor', 'toString']) {
      const r = await fetch(`${BASE}/api/assinatura/cartao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ planoId, token: 'x', paymentMethodId: 'visa', installments: 1 }),
      });
      check(`ATAQUE planoId="${planoId}" → rejeitado (400)`, r.status === 400);
    }
    check('ATAQUE plano → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
  }

  // ══ ATAQUE 4: reutilizar pagamento aprovado de OUTRO usuário ══
  {
    const vitima  = await criarUsuarioBloqueado('vitima');
    const atacante = await criarUsuarioBloqueado('atacante');
    criados.push(vitima.usuario.id, atacante.usuario.id);

    const assinaturaVitima = await prisma.assinatura.findUnique({ where: { usuarioId: vitima.usuario.id } });
    const mpId = `mp-vitima-${Date.now()}`;
    await prisma.cobranca.create({
      data: { assinaturaId: assinaturaVitima!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
    });
    // Pagamento REAL e aprovado — mas pertence à vítima.
    await processarPagamentoAprovado({
      mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
      valor: 149.9, moeda: 'BRL', liveMode: true,
    });

    check('vítima que pagou recebeu acesso', (await temAcesso(vitima.usuario.id)) === true);
    check('ATAQUE reusar pagamento de outro → atacante NÃO recebe acesso', (await temAcesso(atacante.usuario.id)) === false);

    // Reprocessar o mesmo pagamento não estende nada
    const antes = (await prisma.assinatura.findUnique({ where: { usuarioId: vitima.usuario.id } }))!.periodoFimEm!;
    const replay = await processarPagamentoAprovado({
      mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
      valor: 149.9, moeda: 'BRL', liveMode: true,
    });
    const depois = (await prisma.assinatura.findUnique({ where: { usuarioId: vitima.usuario.id } }))!.periodoFimEm!;
    check('ATAQUE replay do mesmo pagamento → recusado', replay.processado === false);
    check('ATAQUE replay → período inalterado', antes.getTime() === depois.getTime());
  }

  // ══ ATAQUE 5: webhook forjado (sem assinatura HMAC válida) ══
  {
    const { usuario } = await criarUsuarioBloqueado('webhook');
    criados.push(usuario.id);
    const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
    const mpId = `mp-forjado-${Date.now()}`;
    await prisma.cobranca.create({
      data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
    });

    for (const [nome, headers] of [
      ['sem assinatura', {}],
      ['assinatura forjada', { 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'req-falso' }],
    ] as Array<[string, Record<string, string>]>) {
      const r = await fetch(`${BASE}/api/webhooks/mercadopago?data.id=${mpId}`, { method: 'POST', headers });
      check(`ATAQUE webhook ${nome} → 401`, r.status === 401);
    }
    check('ATAQUE webhook forjado → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
  }

  // ══ ATAQUE 6: acessar rota protegida sem assinatura ══
  {
    const { usuario, cookie } = await criarUsuarioBloqueado('rota');
    criados.push(usuario.id);
    for (const rota of ['/api/notas', '/api/gastos', '/api/impostos', '/api/relatorios']) {
      const r = await fetch(`${BASE}${rota}`, { headers: { Cookie: cookie } });
      check(`ATAQUE acessar ${rota} sem assinatura → 402`, r.status === 402, `status=${r.status}`);
    }
  }

  // ══ ATAQUE 7: status não-aprovado nunca concede (todos os estados do MP) ══
  {
    const { usuario } = await criarUsuarioBloqueado('status');
    criados.push(usuario.id);
    const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });

    for (const status of ['pending', 'in_process', 'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back', 'authorized']) {
      const mpId = `mp-${status}-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });
      await processarPagamentoAprovado({
        mpPaymentId: mpId, status, statusDetail: null, valor: 149.9, moeda: 'BRL', liveMode: true,
      });
      check(`ATAQUE status "${status}" → NÃO concede acesso`, (await temAcesso(usuario.id)) === false);
    }
  }

  // ══ ATAQUE 8: pagar menos que o preço do plano ══
  {
    const { usuario } = await criarUsuarioBloqueado('valor');
    criados.push(usuario.id);
    const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
    const mpId = `mp-barato-${Date.now()}`;
    await prisma.cobranca.create({
      data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
    });
    const r = await processarPagamentoAprovado({
      mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
      valor: 0.01, moeda: 'BRL', liveMode: true,
    });
    check('ATAQUE pagar R$0,01 por plano de R$149,90 → recusado', r.processado === false && r.motivo === 'valor_divergente');
    check('ATAQUE valor menor → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
  }

  // ══ ATAQUE 9: rajada de requisições simultâneas (duplo clique / retry) ══
  {
    const { usuario, cookie } = await criarUsuarioBloqueado('rajada');
    criados.push(usuario.id);
    const disparos = Array.from({ length: 10 }, () =>
      fetch(`${BASE}/api/assinatura/cartao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ planoId: 'mensal', token: 'token-invalido', paymentMethodId: 'visa', installments: 1 }),
      }).then(r => r.status).catch(() => 0),
    );
    const status = await Promise.all(disparos);
    check('ATAQUE 10 requisições simultâneas → nenhuma concede acesso', (await temAcesso(usuario.id)) === false);
    check('ATAQUE rajada → rate limit ativou (429 presente)', status.includes(429), `status=${status.join(',')}`);
  }

  // ── Limpeza: só o que esta suíte criou ──
  for (const id of criados) {
    await prisma.cobranca.deleteMany({ where: { assinatura: { usuarioId: id } } });
    await prisma.assinatura.deleteMany({ where: { usuarioId: id } });
    await prisma.usuario.deleteMany({ where: { id } });
  }

  console.log(falhas === 0 ? '\n✅ TODOS OS ATAQUES FORAM BLOQUEADOS' : `\n❌ ${falhas} ATAQUE(S) NÃO FORAM BLOQUEADOS`);
  process.exit(falhas === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Rodar a suíte**

Com `npm run dev` rodando:

Run: `npx tsx scripts/test-seguranca-pagamento.ts`
Expected: `✅ TODOS OS ATAQUES FORAM BLOQUEADOS`.

**Se qualquer ataque passar, isso é um bug de segurança real.** Corrija a causa (não o teste), re-rode toda a suíte, e só então siga.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-seguranca-pagamento.ts
git commit -m "test(pagamento): suite adversarial — 9 vetores de burla de pagamento"
```

---

### Task 9: Regressão, teste em sandbox e auditoria final

**Files:** nenhum arquivo novo — verificação.

- [ ] **Step 1: Todos os testes automatizados passam**

```bash
npx tsx src/lib/assinatura/test-planos.ts
npx tsx src/lib/assinatura/test-confirmacao-segura.ts
npx tsx src/lib/payments/test-erros-cartao.ts
npx tsx src/lib/payments/test-rate-limit-pagamento.ts
npx tsx src/lib/assinatura/test-acesso.ts
npx tsx src/lib/assinatura/test-servico.ts
npx tsx scripts/test-seguranca-pagamento.ts
```
Expected: todos ✅.

`test-servico.ts` é pré-existente e chama `processarPagamentoAprovado` com a assinatura **antiga** (só o id). Ele vai falhar a compilação — atualize-o para passar o snapshot completo (`{ mpPaymentId, status: 'approved', statusDetail: 'accredited', valor: <valor da cobrança>, moeda: 'BRL', liveMode: true }`), preservando a intenção original de cada asserção.

- [ ] **Step 2: Compilação e lint limpos**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 3: Regressão do PIX (não pode ter quebrado)**

Com dev server rodando e credenciais de **teste** do Mercado Pago em `.env`:
1. Login com usuário de trial expirado → tela de bloqueio aparece.
2. Escolher PIX → QR Code é gerado normalmente.
3. Conferir no banco: `Cobranca` criada com `metodo='PIX'`, `planoId='mensal'`, `valor=149.9`, `moeda='BRL'`, `status='PENDENTE'`.
4. Confirmar que o polling de `/api/assinatura/status` segue respondendo.

- [ ] **Step 4: Fluxo de cartão em sandbox — aprovado**

Usando os **cartões de teste** do Mercado Pago (painel → Suas integrações → Contas de teste) e credenciais de teste:
1. Escolher cartão, preencher com um cartão de teste de aprovação.
2. Confirmar: botão desabilita, mostra "Processando pagamento...".
3. Backend responde `aprovado: true` → tela de bloqueio some, painel libera.
4. Banco: `Cobranca` com `metodo='CARTAO'`, `status='APROVADA'`, `processadaEm` preenchido, `mpPaymentId` presente, `ultimosDigitos`/`bandeira` preenchidos.
5. **Confirmar que NÃO há PAN, CVV ou validade em nenhuma coluna.**

- [ ] **Step 5: Fluxo de cartão em sandbox — recusado**

Usando um cartão de teste de recusa (o MP documenta valores de nome do titular que forçam cada `status_detail`):
1. Confirmar mensagem de erro clara e específica ao usuário.
2. Confirmar que o acesso **permanece bloqueado**.
3. Banco: `Cobranca` com `status='REJEITADA'` e `statusDetalhe` preenchido.
4. Confirmar que a mensagem exibida **não** contém código interno do gateway.

- [ ] **Step 6: Webhook + resposta síncrona no mesmo pagamento**

Após um pagamento aprovado com cartão, reenviar manualmente o webhook daquele `mpPaymentId` (simulador de notificações do painel do MP, ou repetindo a requisição com assinatura válida):
1. Webhook responde 200.
2. `periodoFimEm` **não muda** (idempotência entre sync e webhook comprovada em produção real, não só em teste unitário).

- [ ] **Step 7: Auditoria final — varredura de superfície**

```bash
# Nenhum caminho concede acesso fora do núcleo:
grep -rn "periodoFimEm" src --include=*.ts --include=*.tsx | grep -v "test-\|acesso.ts\|servico.ts\|types/index.ts"
```
Expected: nenhuma escrita em `periodoFimEm` fora de `servico.ts`. Qualquer outro lugar que escreva esse campo é um bypass — investigar e remover.

```bash
# Nenhum dado sensível de cartão em lugar nenhum:
grep -rniE "cvv|card_number|cardNumber|security_code|numero_cartao" src prisma --include=*.ts --include=*.tsx --include=*.prisma
```
Expected: nenhuma ocorrência que persista ou logue esses valores.

```bash
# Confirmar que status do cliente nunca vira decisão:
grep -rn "body.status\|body.aprovado\|body.paymentStatus\|body.valor\|body.preco" src/app/api
```
Expected: nenhuma ocorrência.

- [ ] **Step 8: Confirmar que nada foi para produção**

Run: `git log --oneline origin/master..HEAD && git status --short`
Expected: commits presentes apenas localmente; **nenhum push executado**.

Nenhum commit nesta task — é verificação. Se qualquer passo falhar, voltar à task correspondente, corrigir, e re-rodar a suíte inteira (Step 1) antes de prosseguir.

---

## Pendências externas (fora do controle do código)

Registrar no relatório final — dependem de configuração no painel do Mercado Pago ou no Railway:

1. **`NEXT_PUBLIC_MP_PUBLIC_KEY`** — chave pública, necessária no frontend para tokenizar. Sem ela o cartão fica indisponível (o componente degrada com mensagem, não quebra).
2. **Cartão habilitado na conta MP** — a conta precisa aceitar cartão de crédito além de PIX.
3. **3DS** — se a conta exigir autenticação 3DS, a resposta pode trazer `three_ds_info` com um desafio. O fluxo atual **não implementa o desafio 3DS**: nesse caso o pagamento não retorna `approved` e o acesso corretamente não é concedido, mas o usuário vê uma mensagem genérica. Implementar o desafio é escopo separado — confirmar com o Mercado Pago se a conta exige 3DS antes de ativar cartão em produção.
4. **Webhook** — o mesmo endpoint já registrado para PIX serve cartão; nenhuma configuração nova. Confirmar que o evento "Pagamentos" continua marcado.
5. **Credenciais de teste vs produção** — validar o fluxo inteiro em sandbox antes de trocar para produção.
