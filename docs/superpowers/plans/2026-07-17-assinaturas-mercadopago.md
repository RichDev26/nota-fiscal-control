# Sistema de Assinaturas via Mercado Pago (PIX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o NF Control / WorkPro Control em SaaS por assinatura: 7 dias de trial automático, bloqueio total do painel quando o trial ou o período pago expira, e liberação de acesso apenas mediante confirmação oficial de pagamento PIX pelo Mercado Pago.

**Architecture:** Duas tabelas novas (`Assinatura`, `Cobranca`) com acesso calculado sob demanda (sem cache de status); gating em duas camadas — Server Component (`AssinaturaGate`) para páginas e um helper (`verificarAcessoAssinatura`) chamado em cada rota de API protegida; integração PIX via SDK oficial `mercadopago` (Payment resource + `WebhookSignatureValidator`); webhook processado de forma idempotente dentro de uma transação Prisma.

**Tech Stack:** Next.js 14 (App Router), Prisma 5, `mercadopago` SDK (Node, v2 — a instalar), `nodemailer` (já existente), `npx tsx` para scripts de teste (padrão já usado no projeto, não é `jest`).

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-07-17-assinaturas-mercadopago-design.md` — qualquer dúvida de comportamento remete a esse arquivo.
- Preço: R$ 49,90 (mesma unidade monetária usada em `NotaFiscal.valorBruto` — reais, não centavos), ciclo de 30 dias corridos.
- Trial: 7 dias corridos a partir da criação da conta.
- **Fail-closed**: usuário sem nenhuma linha em `Assinatura` nunca tem acesso liberado.
- Nenhum campo de status/período é gravável a partir do frontend — só o webhook grava `Cobranca.status`/`Assinatura.periodoFimEm`, e só após validar a assinatura oficial do Mercado Pago.
- `ADMIN_EMAIL` (usado em `/api/fila/*`) **não** tem exceção — segue as mesmas regras de qualquer usuário nas rotas cobertas por este plano.
- Sem botão de "cancelar assinatura" nesta fase.
- Todo arquivo Prisma tem DOIS lugares para editar em sincronia: `prisma/schema.prisma` (SQLite, dev local) e `prisma/schema.postgresql.prisma` (Postgres, produção via Railway — ver `nixpacks.toml`/`scripts/railway-start.sh`). Migrations hand-escritas em `prisma/migrations/` usam sintaxe Postgres (`migration_lock.toml` fixa `provider = "postgresql"`), mesmo com o dev local rodando em SQLite via `db push`.
- Scripts de teste seguem o padrão já estabelecido no projeto (`src/lib/extractors/test-danfe.ts` etc.): script standalone, `console.log` com ✅/❌, `process.exit(1)` se algo falhar, executado via `npx tsx caminho/do/arquivo.ts`. Não introduzir jest/vitest.
- Mercado Pago PIX exige `payer.identification` (CPF/CNPJ) — `Usuario` ganha um campo `cpfCnpj` opcional; é coletado uma única vez, na primeira geração de PIX, e reaproveitado depois.

---

### Task 1: Modelo de dados — Prisma (Assinatura, Cobranca, Usuario.cpfCnpj)

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgresql.prisma`
- Create: `prisma/migrations/20260717000000_add_assinaturas/migration.sql`
- Create: `src/lib/assinatura/test-schema.ts`

**Interfaces:**
- Produces: modelos Prisma `Assinatura` (`id, usuarioId, status, trialFimEm, periodoFimEm, lembreteEnviadoEm, createdAt, updatedAt`) e `Cobranca` (`id, assinaturaId, metodo, valor, status, mpPaymentId, idempotencyKey, qrCode, qrCodeBase64, expiraEm, createdAt, updatedAt`); `Usuario.cpfCnpj String?`; `Usuario.assinatura Assinatura?`. Todas as tasks seguintes dependem deste schema existir no client Prisma gerado.

- [ ] **Step 1: Editar `prisma/schema.prisma`** — adicionar campo em `Usuario` e os dois modelos novos

Abra `prisma/schema.prisma`. No modelo `Usuario`, adicione o campo `cpfCnpj` e a relação `assinatura`:

```prisma
model Usuario {
  id           String       @id @default(cuid())
  email        String       @unique
  senhaHash    String
  nome         String
  cpfCnpj      String?
  criadoEm    DateTime     @default(now())
  atualizadoEm DateTime     @updatedAt
  notas        NotaFiscal[]
  impostos     Imposto[]
  gastos       Gasto[]
  servicos     Servico[]
  colaboradores Colaborador[]
  assinatura   Assinatura?
}
```

Ao final do arquivo (depois do modelo `Usuario`), adicione:

```prisma
// ─── Assinaturas (Mercado Pago / PIX) ──────────────────────────────────────────
model Assinatura {
  id                String     @id @default(cuid())
  usuarioId         String     @unique
  status            String     @default("TRIAL") // informativo — o acesso real é calculado por temAcessoAtivo()
  trialFimEm        DateTime
  periodoFimEm      DateTime?
  lembreteEnviadoEm DateTime?
  usuario           Usuario    @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  cobrancas         Cobranca[]
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
}

model Cobranca {
  id             String     @id @default(cuid())
  assinaturaId   String
  metodo         String     @default("PIX")
  valor          Float
  status         String     @default("PENDENTE") // 'PENDENTE' | 'APROVADA' | 'REJEITADA' | 'EXPIRADA'
  mpPaymentId    String?    @unique
  idempotencyKey String     @unique
  qrCode         String?
  qrCodeBase64   String?
  expiraEm       DateTime?
  assinatura     Assinatura @relation(fields: [assinaturaId], references: [id], onDelete: Cascade)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  @@index([status])
}
```

- [ ] **Step 2: Repetir exatamente a mesma edição em `prisma/schema.postgresql.prisma`**

Abra `prisma/schema.postgresql.prisma` e aplique as MESMAS duas edições do Step 1 (campo `cpfCnpj`/`assinatura` em `Usuario`, modelos `Assinatura` e `Cobranca` no final). Os dois arquivos devem ficar idênticos exceto pelo bloco `datasource`.

- [ ] **Step 3: Escrever a migration Postgres à mão**

Crie `prisma/migrations/20260717000000_add_assinaturas/migration.sql`:

```sql
-- AlterTable: Usuario ganha CPF/CNPJ (necessário como payer.identification do PIX)
ALTER TABLE "Usuario" ADD COLUMN "cpfCnpj" TEXT;

-- CreateTable: Assinatura (trial + período pago — 1:1 com Usuario)
CREATE TABLE "Assinatura" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "trialFimEm" TIMESTAMP(3) NOT NULL,
    "periodoFimEm" TIMESTAMP(3),
    "lembreteEnviadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Cobranca (histórico de cobranças — PIX hoje, outros métodos no futuro via "metodo")
CREATE TABLE "Cobranca" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "metodo" TEXT NOT NULL DEFAULT 'PIX',
    "valor" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "mpPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "qrCode" TEXT,
    "qrCodeBase64" TEXT,
    "expiraEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assinatura_usuarioId_key" ON "Assinatura"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_mpPaymentId_key" ON "Cobranca"("mpPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_idempotencyKey_key" ON "Cobranca"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Cobranca_status_idx" ON "Cobranca"("status");

-- AddForeignKey
ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranca" ADD CONSTRAINT "Cobranca_assinaturaId_fkey"
  FOREIGN KEY ("assinaturaId") REFERENCES "Assinatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Sincronizar o banco local (SQLite) e gerar o client**

Run: `npx prisma db push && npx prisma generate`
Expected: `Your database is now in sync with your schema.` seguido de `✔ Generated Prisma Client`.

- [ ] **Step 5: Escrever e rodar o smoke test do schema**

Crie `src/lib/assinatura/test-schema.ts`:

```ts
// Verifica que os modelos Assinatura/Cobranca e Usuario.cpfCnpj existem e funcionam.
// Execução: npx tsx src/lib/assinatura/test-schema.ts
import prisma from '@/lib/prisma';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };

(async () => {
  const email = `teste-schema-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({
    data: { email, senhaHash: 'x', nome: 'Teste Schema', cpfCnpj: '11144477735' },
  });
  check('Usuario criado com cpfCnpj', usuario.cpfCnpj === '11144477735');

  const trialFimEm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const assinatura = await prisma.assinatura.create({
    data: { usuarioId: usuario.id, trialFimEm },
  });
  check('Assinatura criada com status TRIAL por padrão', assinatura.status === 'TRIAL');
  check('Assinatura vinculada 1:1 ao usuário', assinatura.usuarioId === usuario.id);

  const cobranca = await prisma.cobranca.create({
    data: { assinaturaId: assinatura.id, valor: 49.9, idempotencyKey: `idem-${Date.now()}` },
  });
  check('Cobranca criada com metodo PIX e status PENDENTE por padrão', cobranca.metodo === 'PIX' && cobranca.status === 'PENDENTE');

  // Limpeza
  await prisma.cobranca.delete({ where: { id: cobranca.id } });
  await prisma.assinatura.delete({ where: { id: assinatura.id } });
  await prisma.usuario.delete({ where: { id: usuario.id } });

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
```

Run: `npx tsx src/lib/assinatura/test-schema.ts`
Expected: 4 linhas ✅, `✅ Todos os testes passaram`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/schema.postgresql.prisma prisma/migrations/20260717000000_add_assinaturas src/lib/assinatura/test-schema.ts
git commit -m "feat(assinatura): modelo de dados Assinatura/Cobranca + Usuario.cpfCnpj"
```

---

### Task 2: Núcleo de acesso — `temAcessoAtivo`, `verificarAcessoAssinatura`

**Files:**
- Create: `src/lib/assinatura/acesso.ts`
- Create: `src/lib/assinatura/test-acesso.ts`

**Interfaces:**
- Consumes: `prisma` de `@/lib/prisma` (default export); modelos `Assinatura` do Task 1.
- Produces: `temAcessoAtivo(assinatura: { trialFimEm: Date; periodoFimEm: Date | null } | null, agora?: Date): boolean`; `class AssinaturaInativaError extends Error`; `verificarAcessoAssinatura(usuarioId: string): Promise<void>` (lança `AssinaturaInativaError` se sem acesso). Usado por: `AssinaturaGate` (Task 9), rotas de API protegidas (Task 12), `servico.ts` (Task 3).

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/lib/assinatura/test-acesso.ts`:

```ts
// Execução: npx tsx src/lib/assinatura/test-acesso.ts
import { temAcessoAtivo, verificarAcessoAssinatura, AssinaturaInativaError } from './acesso';
import prisma from '@/lib/prisma';

let falhas = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? '✅' : '❌'} ${n}`); if (!ok) falhas++; };

(async () => {
  const agora = new Date('2026-07-17T12:00:00Z');
  const dia = 24 * 60 * 60 * 1000;

  // ── temAcessoAtivo: casos puros, sem banco ──
  check('sem assinatura -> sem acesso (fail-closed)', temAcessoAtivo(null, agora) === false);
  check('trial ainda válido -> acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() + dia), periodoFimEm: null }, agora) === true);
  check('trial expirado, sem pagamento -> sem acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() - dia), periodoFimEm: null }, agora) === false);
  check('trial expirado, período pago futuro -> acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() - dia), periodoFimEm: new Date(agora.getTime() + dia) }, agora) === true);
  check('trial expirado, período pago também expirado -> sem acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() - dia), periodoFimEm: new Date(agora.getTime() - dia) }, agora) === false);
  check('trial expira exatamente agora -> sem acesso (borda exclusiva)', temAcessoAtivo({ trialFimEm: agora, periodoFimEm: null }, agora) === false);

  // ── verificarAcessoAssinatura: integração real com o banco ──
  const email = `teste-acesso-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Acesso' } });

  let lancouSemAssinatura = false;
  try { await verificarAcessoAssinatura(usuario.id); } catch (e) { lancouSemAssinatura = e instanceof AssinaturaInativaError; }
  check('usuário sem linha de Assinatura -> AssinaturaInativaError', lancouSemAssinatura);

  await prisma.assinatura.create({ data: { usuarioId: usuario.id, trialFimEm: new Date(Date.now() + dia) } });
  let passouComTrialValido = true;
  try { await verificarAcessoAssinatura(usuario.id); } catch { passouComTrialValido = false; }
  check('usuário com trial válido -> não lança', passouComTrialValido);

  await prisma.usuario.delete({ where: { id: usuario.id } }); // cascade apaga a Assinatura

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Rodar e confirmar que falha (arquivo `acesso.ts` ainda não existe)**

Run: `npx tsx src/lib/assinatura/test-acesso.ts`
Expected: erro `Cannot find module './acesso'`.

- [ ] **Step 3: Implementar `src/lib/assinatura/acesso.ts`**

```ts
/**
 * Núcleo de decisão de acesso à assinatura. O acesso NUNCA é decidido por um
 * campo booleano gravado antecipadamente — é sempre calculado na hora, a partir
 * das datas (trialFimEm / periodoFimEm). Datas não ficam desatualizadas por um
 * bug que "esqueceu" de desativar um flag.
 *
 * Fail-closed: usuário sem nenhuma linha de Assinatura nunca tem acesso.
 */
import prisma from '@/lib/prisma';

export interface AssinaturaAcesso {
  trialFimEm: Date;
  periodoFimEm: Date | null;
}

export function temAcessoAtivo(assinatura: AssinaturaAcesso | null, agora: Date = new Date()): boolean {
  if (!assinatura) return false;
  if (assinatura.trialFimEm > agora) return true;
  if (assinatura.periodoFimEm && assinatura.periodoFimEm > agora) return true;
  return false;
}

export class AssinaturaInativaError extends Error {
  constructor() {
    super('Assinatura inativa ou trial expirado.');
    this.name = 'AssinaturaInativaError';
  }
}

/** Lança AssinaturaInativaError se o usuário não tiver acesso ativo. Fail-closed. */
export async function verificarAcessoAssinatura(usuarioId: string): Promise<void> {
  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId } });
  if (!temAcessoAtivo(assinatura)) throw new AssinaturaInativaError();
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsx src/lib/assinatura/test-acesso.ts`
Expected: 8 linhas ✅, `✅ Todos os testes passaram`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assinatura/acesso.ts src/lib/assinatura/test-acesso.ts
git commit -m "feat(assinatura): temAcessoAtivo + verificarAcessoAssinatura (fail-closed)"
```

---

### Task 3: Serviço de assinatura — trial, processamento de pagamento, status

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/lib/assinatura/servico.ts`
- Create: `src/lib/assinatura/test-servico.ts`

**Interfaces:**
- Consumes: `temAcessoAtivo` de `./acesso` (Task 2); `prisma` de `@/lib/prisma`.
- Produces: `criarAssinaturaTrial(usuarioId: string, inicioTrial?: Date): Promise<Assinatura>`; `processarPagamentoAprovado(mpPaymentId: string, agora?: Date): Promise<{ processado: boolean; motivo?: 'cobranca_nao_encontrada' | 'ja_processada'; novoPeriodoFimEm?: Date }>`; `obterStatusParaCliente(usuarioId: string): Promise<StatusAssinatura>`. Usado por: register route (Task 4), backfill script (Task 5), webhook route (Task 7), status endpoint (Task 8).
- `StatusAssinatura` (novo tipo em `src/types/index.ts`): `{ ativo: boolean; motivo: 'trial_expirado' | 'assinatura_vencida' | null; trialFimEm: Date | string | null; periodoFimEm: Date | string | null }`.

- [ ] **Step 1: Adicionar `StatusAssinatura` em `src/types/index.ts`**

Abra `src/types/index.ts` e adicione ao final do arquivo:

```ts
export interface StatusAssinatura {
  ativo: boolean;
  motivo: 'trial_expirado' | 'assinatura_vencida' | null;
  trialFimEm: Date | string | null;
  periodoFimEm: Date | string | null;
}
```

- [ ] **Step 2: Escrever o teste (falhando)**

Crie `src/lib/assinatura/test-servico.ts`:

```ts
// Execução: npx tsx src/lib/assinatura/test-servico.ts
import prisma from '@/lib/prisma';
import { criarAssinaturaTrial, processarPagamentoAprovado, obterStatusParaCliente } from './servico';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

(async () => {
  const email = `teste-servico-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Servico' } });

  // ── Trial: início customizado (simula backfill de usuário antigo) ──
  const criadoHa10Dias = new Date(Date.now() - 10 * dia);
  const assinatura = await criarAssinaturaTrial(usuario.id, criadoHa10Dias);
  check('trialFimEm = inicioTrial + 7 dias', Math.abs(assinatura.trialFimEm.getTime() - (criadoHa10Dias.getTime() + 7 * dia)) < 1000);

  const status1 = await obterStatusParaCliente(usuario.id);
  check('usuário com trial de conta "antiga" (10 dias) -> bloqueado', status1.ativo === false);
  check('motivo = trial_expirado (nunca pagou)', status1.motivo === 'trial_expirado');

  // ── Pagamento aprovado: cria uma Cobranca PENDENTE e processa ──
  const cobranca = await prisma.cobranca.create({
    data: { assinaturaId: assinatura.id, valor: 49.9, idempotencyKey: `idem-${Date.now()}`, mpPaymentId: `mp-${Date.now()}` },
  });

  const r1 = await processarPagamentoAprovado(cobranca.mpPaymentId!);
  check('primeira confirmação processa e estende o período', r1.processado === true);

  const status2 = await obterStatusParaCliente(usuario.id);
  check('depois do pagamento -> acesso ativo', status2.ativo === true);

  // ── Idempotência: reprocessar o MESMO mpPaymentId não deve estender de novo ──
  const periodoFimApos1 = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const r2 = await processarPagamentoAprovado(cobranca.mpPaymentId!);
  check('reprocessar mesmo pagamento -> não processado de novo (idempotente)', r2.processado === false && r2.motivo === 'ja_processada');
  const periodoFimApos2 = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  check('período NÃO foi estendido duas vezes', periodoFimApos1.getTime() === periodoFimApos2.getTime());

  // ── mpPaymentId desconhecido -> não processado, sem erro ──
  const r3 = await processarPagamentoAprovado('mp-inexistente-999');
  check('mpPaymentId desconhecido -> não processado, motivo correto', r3.processado === false && r3.motivo === 'cobranca_nao_encontrada');

  // Limpeza
  await prisma.usuario.delete({ where: { id: usuario.id } }); // cascade: Assinatura + Cobranca

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx tsx src/lib/assinatura/test-servico.ts`
Expected: erro `Cannot find module './servico'`.

- [ ] **Step 4: Implementar `src/lib/assinatura/servico.ts`**

```ts
/**
 * Camada de negócio da assinatura: criação do trial, processamento idempotente
 * de pagamento confirmado, e status consumível pelo cliente/telas.
 */
import prisma from '@/lib/prisma';
import type { Assinatura } from '@prisma/client';
import type { StatusAssinatura } from '@/types';
import { temAcessoAtivo } from './acesso';

const DURACAO_TRIAL_MS  = 7 * 24 * 60 * 60 * 1000;
const DURACAO_PERIODO_MS = 30 * 24 * 60 * 60 * 1000;

/** Cria a Assinatura em TRIAL. `inicioTrial` permite reaproveitar esta função no
 *  backfill de usuários existentes (inicioTrial = usuario.criadoEm), já que o
 *  trial deles conta a partir da criação da conta, não do momento do backfill. */
export async function criarAssinaturaTrial(usuarioId: string, inicioTrial: Date = new Date()): Promise<Assinatura> {
  const trialFimEm = new Date(inicioTrial.getTime() + DURACAO_TRIAL_MS);
  return prisma.assinatura.create({ data: { usuarioId, trialFimEm } });
}

export interface ResultadoProcessamentoPagamento {
  processado: boolean;
  motivo?: 'cobranca_nao_encontrada' | 'ja_processada';
  novoPeriodoFimEm?: Date;
}

/**
 * Idempotente: chamado pelo webhook toda vez que o Mercado Pago confirma um
 * pagamento. Releitura do status dentro da transação protege contra entregas
 * duplicadas/simultâneas do webhook (o MP reenvia notificações).
 */
export async function processarPagamentoAprovado(
  mpPaymentId: string,
  agora: Date = new Date(),
): Promise<ResultadoProcessamentoPagamento> {
  return prisma.$transaction(async (tx) => {
    const cobranca = await tx.cobranca.findUnique({
      where: { mpPaymentId },
      include: { assinatura: true },
    });
    if (!cobranca) return { processado: false, motivo: 'cobranca_nao_encontrada' as const };
    if (cobranca.status === 'APROVADA') return { processado: false, motivo: 'ja_processada' as const };

    const baseAtual = cobranca.assinatura.periodoFimEm && cobranca.assinatura.periodoFimEm > agora
      ? cobranca.assinatura.periodoFimEm
      : agora;
    const novoPeriodoFimEm = new Date(baseAtual.getTime() + DURACAO_PERIODO_MS);

    await tx.cobranca.update({ where: { id: cobranca.id }, data: { status: 'APROVADA' } });
    await tx.assinatura.update({
      where: { id: cobranca.assinaturaId },
      // lembreteEnviadoEm volta a null: a renovação abre um novo ciclo, que também
      // deve poder gerar um lembrete de vencimento 3 dias antes do PRÓXIMO fim.
      data: { periodoFimEm: novoPeriodoFimEm, status: 'ATIVA', lembreteEnviadoEm: null },
    });

    return { processado: true as const, novoPeriodoFimEm };
  });
}

export async function obterStatusParaCliente(usuarioId: string): Promise<StatusAssinatura> {
  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId } });
  const ativo = temAcessoAtivo(assinatura);
  return {
    ativo,
    motivo: ativo ? null : (!assinatura?.periodoFimEm ? 'trial_expirado' : 'assinatura_vencida'),
    trialFimEm: assinatura?.trialFimEm ?? null,
    periodoFimEm: assinatura?.periodoFimEm ?? null,
  };
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx tsx src/lib/assinatura/test-servico.ts`
Expected: 8 linhas ✅, `✅ Todos os testes passaram`.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/assinatura/servico.ts src/lib/assinatura/test-servico.ts
git commit -m "feat(assinatura): servico.ts — trial, processamento idempotente de pagamento, status"
```

---

### Task 4: Trial automático no cadastro

**Files:**
- Modify: `src/app/api/auth/register/route.ts`

**Interfaces:**
- Não consome `criarAssinaturaTrial` diretamente (ver nota abaixo) — apenas replica sua constante de duração dentro da transação do Prisma.

- [ ] **Step 1: Envolver a criação do usuário numa transação que também cria o trial**

Em `src/app/api/auth/register/route.ts`, substitua o bloco de criação:

```ts
  // Criar usuário
  const usuario = await prisma.usuario.create({
    data: { email: emailNorm, senhaHash, nome: nome.trim() },
    select: { id: true, email: true, nome: true },
  });
```

por:

```ts
  // Criar usuário + iniciar trial de 7 dias na mesma transação
  const usuario = await prisma.$transaction(async (tx) => {
    const novoUsuario = await tx.usuario.create({
      data: { email: emailNorm, senhaHash, nome: nome.trim() },
      select: { id: true, email: true, nome: true },
    });
    await tx.assinatura.create({
      data: { usuarioId: novoUsuario.id, trialFimEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    return novoUsuario;
  });
```

Não reutilizamos `criarAssinaturaTrial` diretamente aqui porque ela usa o `prisma` global, não o `tx` da transação — chamar `tx.assinatura.create(...)` diretamente mantém as duas escritas (usuário + assinatura) atômicas. `criarAssinaturaTrial` continua sendo o ponto único usado pelo backfill (Task 5), que não precisa dessa atomicidade com a criação do usuário (o usuário já existe).

- [ ] **Step 2: Verificar manualmente com o servidor de dev rodando**

Run: `npm run dev` (em um terminal separado, deixe rodando)

Em outro terminal:
```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"novo-teste@exemplo.com","senha":"Teste1234","nome":"Novo Teste"}' | head -c 300
```
Expected: JSON com `{"usuario":{"nome":"Novo Teste","email":"novo-teste@exemplo.com"}}` e status 201.

Depois, confirme que a Assinatura foi criada:
Run: `npx prisma studio` (abre em http://localhost:5555) e verifique a tabela `Assinatura` — deve haver uma linha para o usuário recém-criado com `trialFimEm` ~7 dias no futuro.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/register/route.ts
git commit -m "feat(assinatura): cadastro inicia trial de 7 dias automaticamente"
```

---

### Task 5: Backfill de usuários existentes

**Files:**
- Create: `scripts/backfill-assinaturas.ts`

**Interfaces:**
- Consumes: `criarAssinaturaTrial(usuarioId, inicioTrial)` de `@/lib/assinatura/servico` (Task 3); `temAcessoAtivo` de `@/lib/assinatura/acesso` (Task 2, usado só para o relatório final).

- [ ] **Step 1: Escrever o script de backfill**

Crie `scripts/backfill-assinaturas.ts`:

```ts
/**
 * Backfill único: cria Assinatura para todo Usuario que ainda não tem uma.
 * trialFimEm = usuario.criadoEm + 7 dias — contas com mais de 7 dias de vida
 * ficam bloqueadas imediatamente (temAcessoAtivo calcula isso sozinho).
 *
 * Execução: npx tsx scripts/backfill-assinaturas.ts
 */
import prisma from '../src/lib/prisma';
import { criarAssinaturaTrial } from '../src/lib/assinatura/servico';
import { temAcessoAtivo } from '../src/lib/assinatura/acesso';

(async () => {
  const usuariosSemAssinatura = await prisma.usuario.findMany({
    where: { assinatura: { is: null } },
    select: { id: true, email: true, criadoEm: true },
  });

  console.log(`Encontrados ${usuariosSemAssinatura.length} usuário(s) sem Assinatura.`);

  let bloqueados = 0;
  let dentroTrial = 0;

  for (const u of usuariosSemAssinatura) {
    const assinatura = await criarAssinaturaTrial(u.id, u.criadoEm);
    const ativo = temAcessoAtivo(assinatura);
    if (ativo) dentroTrial++; else bloqueados++;
    console.log(`  ${ativo ? '🟢' : '🔴'} ${u.email} — criado em ${u.criadoEm.toISOString()} — ${ativo ? 'ainda dentro do trial' : 'bloqueado (mais de 7 dias)'}`);
  }

  console.log(`\nConcluído: ${dentroTrial} ainda dentro do trial, ${bloqueados} bloqueados imediatamente.`);
  process.exit(0);
})();
```

- [ ] **Step 2: Rodar contra o banco de dev e conferir o resultado**

Run: `npx tsx scripts/backfill-assinaturas.ts`
Expected: uma linha por usuário existente no banco de dev; usuários criados há mais de 7 dias aparecem com 🔴 "bloqueado".

- [ ] **Step 3: Rodar de novo (idempotência do próprio script)**

Run: `npx tsx scripts/backfill-assinaturas.ts`
Expected: `Encontrados 0 usuário(s) sem Assinatura.` — confirma que rodar duas vezes não duplica nem falha (o `where: { assinatura: { is: null } }` já filtra quem já foi processado).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-assinaturas.ts
git commit -m "feat(assinatura): script de backfill para usuários existentes"
```

**Nota de produção:** depois do deploy, rodar `npx tsx scripts/backfill-assinaturas.ts` uma vez contra o banco de produção (mesma forma que outros scripts one-off deste projeto são rodados — via shell do Railway).

---

### Task 6: Integração Mercado Pago — SDK, criação de PIX, busca de pagamento, validação de webhook

**Files:**
- Modify: `package.json` (nova dependência)
- Modify: `.env.example`
- Create: `src/lib/payments/mercadopago.ts`
- Create: `src/lib/payments/test-mercadopago.ts`

**Interfaces:**
- Produces: `criarCobrancaPix(input: CriarCobrancaPixInput): Promise<CobrancaPixResultado>`; `buscarPagamento(mpPaymentId: string): Promise<{ status: string }>`; `validarAssinaturaWebhook(input: ValidarWebhookInput): boolean`. Usado por: PIX endpoint (Task 8), webhook route (Task 7).

**Por que o SDK oficial em vez de `fetch` direto:** a documentação oficial do Mercado Pago (verificada nesta sessão em
`https://www.mercadopago.com.br/developers/en/docs/your-integrations/notifications/webhooks`) só documenta a validação
de assinatura do webhook através do `WebhookSignatureValidator` do SDK oficial — não expõe mais publicamente o template
manual do manifest HMAC. Para código de segurança crítico (validação de origem do webhook), usar o validador mantido
pelo próprio Mercado Pago é mais seguro do que reconstruir o algoritmo por conta própria. Já que o SDK entra por causa
disso, usamos também o recurso `Payment` dele (em vez de misturar SDK + fetch cru no mesmo módulo).

- [ ] **Step 1: Instalar o SDK**

Run: `npm install mercadopago`
Expected: `package.json` ganha `"mercadopago": "^2.x.x"` em `dependencies`.

- [ ] **Step 2: Adicionar as variáveis de ambiente**

Em `.env.example`, adicione:

```
# Mercado Pago — assinaturas via PIX
MP_ACCESS_TOKEN="seu-access-token-de-producao-ou-teste"
MP_WEBHOOK_SECRET="segredo-mostrado-em-Suas-integracoes-Webhooks-Configurar-notificacao"
```

E no `.env` local (não versionado), adicione as CREDENCIAIS DE TESTE do Mercado Pago (Suas integrações → Credenciais → Credenciais de teste) para os próximos passos funcionarem contra o sandbox.

- [ ] **Step 3: Implementar `src/lib/payments/mercadopago.ts`**

```ts
/**
 * Integração com o Mercado Pago via SDK oficial (não fetch cru — ver justificativa
 * no plano de implementação, Task 6): criação de cobrança PIX, busca do status
 * real de um pagamento, e validação da assinatura do webhook.
 */
import { MercadoPagoConfig, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';

function getClient(): MercadoPagoConfig {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado');
  return new MercadoPagoConfig({ accessToken });
}

export interface CriarCobrancaPixInput {
  valor: number;
  descricao: string;
  idempotencyKey: string;
  payerEmail: string;
  payerNome: string;
  payerCpfCnpj: string; // somente dígitos
}

export interface CobrancaPixResultado {
  mpPaymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string;
}

export async function criarCobrancaPix(input: CriarCobrancaPixInput): Promise<CobrancaPixResultado> {
  const payment = new Payment(getClient());

  const partesNome = input.payerNome.trim().split(/\s+/);
  const firstName  = partesNome[0];
  const lastName   = partesNome.slice(1).join(' ') || partesNome[0];
  const cpfCnpj    = input.payerCpfCnpj.replace(/\D/g, '');
  const tipoDoc    = cpfCnpj.length === 14 ? 'CNPJ' : 'CPF';

  const response = await payment.create({
    body: {
      transaction_amount: input.valor,
      description: input.descricao,
      payment_method_id: 'pix',
      payer: {
        email: input.payerEmail,
        first_name: firstName,
        last_name: lastName,
        identification: { type: tipoDoc, number: cpfCnpj },
      },
    },
    requestOptions: { idempotencyKey: input.idempotencyKey },
  });

  const transactionData = response.point_of_interaction?.transaction_data;
  if (!response.id || !transactionData?.qr_code || !transactionData?.qr_code_base64) {
    throw new Error('Resposta do Mercado Pago sem dados de QR Code PIX');
  }

  return {
    mpPaymentId:  String(response.id),
    status:       response.status ?? 'pending',
    qrCode:       transactionData.qr_code,
    qrCodeBase64: transactionData.qr_code_base64,
  };
}

export async function buscarPagamento(mpPaymentId: string): Promise<{ status: string }> {
  const payment  = new Payment(getClient());
  const response = await payment.get({ id: mpPaymentId });
  return { status: response.status ?? 'unknown' };
}

export interface ValidarWebhookInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}

/** true = assinatura autêntica do Mercado Pago. false = rejeitar com 401, sem processar nada. */
export function validarAssinaturaWebhook(input: ValidarWebhookInput): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret || !input.xSignature || !input.dataId) return false;
  try {
    WebhookSignatureValidator.validate({
      xSignature: input.xSignature,
      xRequestId: input.xRequestId ?? '',
      dataId:     input.dataId,
      secret,
    });
    return true;
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) return false;
    throw err;
  }
}
```

- [ ] **Step 4: Rodar `tsc` e ajustar contra os tipos reais do pacote instalado**

Run: `npx tsc --noEmit`
Expected: sem erros. Se houver erro de tipo (nome de campo diferente do documentado, ex. `response.point_of_interaction` com shape distinto), abra `node_modules/mercadopago/dist/**/*.d.ts` para conferir o shape exato exportado pela versão instalada e ajuste `mercadopago.ts` de acordo — a documentação pública pode estar um passo atrás da versão publicada no npm.

- [ ] **Step 5: Escrever e rodar o teste da validação de assinatura do webhook**

Crie `src/lib/payments/test-mercadopago.ts`:

```ts
// Execução: npx tsx src/lib/payments/test-mercadopago.ts
import crypto from 'crypto';
import { validarAssinaturaWebhook } from './mercadopago';

process.env.MP_WEBHOOK_SECRET = 'segredo-de-teste-123';

let falhas = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? '✅' : '❌'} ${n}`); if (!ok) falhas++; };

check('sem x-signature -> inválido', validarAssinaturaWebhook({ xSignature: null, xRequestId: 'req-1', dataId: '123' }) === false);
check('sem dataId -> inválido', validarAssinaturaWebhook({ xSignature: 'ts=1,v1=abc', xRequestId: 'req-1', dataId: null }) === false);
check('x-signature mal formado -> inválido', validarAssinaturaWebhook({ xSignature: 'lixo-invalido', xRequestId: 'req-1', dataId: '123' }) === false);

// Assinatura construída com o manifest documentado publicamente pelo Mercado Pago
// (id:{dataId};request-id:{xRequestId};ts:{ts};, HMAC-SHA256 com o secret).
const ts          = Math.floor(Date.now() / 1000);
const dataId      = '123456789';
const xRequestId  = 'req-abc';
const manifest    = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
const v1          = crypto.createHmac('sha256', 'segredo-de-teste-123').update(manifest).digest('hex');
const xSignature  = `ts=${ts},v1=${v1}`;

const resultado = validarAssinaturaWebhook({ xSignature, xRequestId, dataId });
check('assinatura válida (manifest id;request-id;ts) -> aceita', resultado === true);
if (!resultado) {
  console.log('   Este teste assume o template público id:{id};request-id:{request-id};ts:{ts};.');
  console.log('   Se o SDK instalado usar um formato diferente, inspecione');
  console.log('   node_modules/mercadopago/dist/**/webhook*.js (procure por "manifest" ou');
  console.log('   "createHmac") para confirmar o template exato e ajuste este teste.');
}

const xSignatureAdulterada = `ts=${ts},v1=${v1.slice(0, -4)}0000`;
check('v1 adulterado -> inválido', validarAssinaturaWebhook({ xSignature: xSignatureAdulterada, xRequestId, dataId }) === false);

console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
```

Run: `npx tsx src/lib/payments/test-mercadopago.ts`
Expected: 5 linhas ✅. Se o teste 4 (assinatura válida) falhar, siga a instrução impressa pelo próprio teste antes de prosseguir — é a única parte deste módulo que depende de um detalhe não 100% confirmável sem o SDK em mãos.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example src/lib/payments/mercadopago.ts src/lib/payments/test-mercadopago.ts
git commit -m "feat(assinatura): integração Mercado Pago — criar PIX, buscar pagamento, validar webhook"
```

---

### Task 7: Rota de webhook do Mercado Pago

**Files:**
- Create: `src/app/api/webhooks/mercadopago/route.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `validarAssinaturaWebhook`, `buscarPagamento` de `@/lib/payments/mercadopago` (Task 6); `processarPagamentoAprovado` de `@/lib/assinatura/servico` (Task 3).

- [ ] **Step 1: Adicionar o prefixo público no middleware**

Em `src/middleware.ts`, altere:

```ts
const PUBLIC_API_PREFIXES  = ['/api/auth/'];
```

para:

```ts
// /api/webhooks/mercadopago é chamado pelo servidor do Mercado Pago, sem
// cookie de sessão — protegido por validação de assinatura HMAC dentro da
// própria rota, não por login de usuário (mesmo padrão de PUBLIC_API_EXACT
// já usado para /api/colaboradores/sweep).
const PUBLIC_API_PREFIXES  = ['/api/auth/', '/api/webhooks/'];
```

- [ ] **Step 2: Implementar a rota do webhook**

Crie `src/app/api/webhooks/mercadopago/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { validarAssinaturaWebhook, buscarPagamento } from '@/lib/payments/mercadopago';
import { processarPagamentoAprovado } from '@/lib/assinatura/servico';
import { logInfo, logError } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

/**
 * Chamado pelo Mercado Pago quando o status de um pagamento muda. Nunca confia
 * no corpo da notificação — sempre busca o pagamento de verdade via
 * buscarPagamento() antes de liberar qualquer acesso (ver auditoria de
 * segurança no spec, docs/superpowers/specs/2026-07-17-assinaturas-mercadopago-design.md).
 */
export async function POST(req: NextRequest) {
  const dataId     = req.nextUrl.searchParams.get('data.id');
  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');

  const valido = validarAssinaturaWebhook({ xSignature, xRequestId, dataId });
  if (!valido) {
    logError('webhooks.mercadopago', 'Assinatura de webhook inválida — requisição rejeitada');
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
  }

  if (!dataId) return NextResponse.json({ ok: true }); // notificação sem data.id — nada a fazer

  try {
    const pagamento = await buscarPagamento(dataId);
    if (pagamento.status !== 'approved') {
      return NextResponse.json({ ok: true }); // pendente/rejeitado — nada a liberar ainda
    }

    const resultado = await processarPagamentoAprovado(dataId);
    logInfo('webhooks.mercadopago', 'Webhook processado', { dataId, ...resultado });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError('webhooks.mercadopago', `Falha ao processar webhook do pagamento ${dataId}`, err as Error);
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Teste manual — assinatura inválida é rejeitada**

Com `npm run dev` rodando e `MP_WEBHOOK_SECRET` configurado no `.env`:

```bash
curl -s -X POST "http://localhost:3000/api/webhooks/mercadopago?data.id=123" \
  -H "x-signature: ts=1,v1=assinatura-forjada" \
  -H "x-request-id: req-fake" \
  -i | head -5
```
Expected: `HTTP/1.1 401`.

- [ ] **Step 4: Teste manual — sem assinatura nenhuma também é rejeitado**

```bash
curl -s -X POST "http://localhost:3000/api/webhooks/mercadopago?data.id=123" -i | head -5
```
Expected: `HTTP/1.1 401`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/mercadopago/route.ts src/middleware.ts
git commit -m "feat(assinatura): rota de webhook do Mercado Pago (idempotente, fail-closed)"
```

---

### Task 8: Endpoints `/api/assinatura/pix` e `/api/assinatura/status`

**Files:**
- Create: `src/app/api/assinatura/pix/route.ts`
- Create: `src/app/api/assinatura/status/route.ts`

**Interfaces:**
- Consumes: `criarCobrancaPix` de `@/lib/payments/mercadopago` (Task 6); `obterStatusParaCliente` de `@/lib/assinatura/servico` (Task 3); `validarCpfCnpj` de `@/lib/validators` (já existente).
- Produces: `POST /api/assinatura/pix` → `{ cobrancaId, qrCode, qrCodeBase64 }` ou `{ error, precisaCpfCnpj? }`; `GET /api/assinatura/status` → `StatusAssinatura`. Consumidos por `TelaBloqueio` (Task 10).

- [ ] **Step 1: Implementar `POST /api/assinatura/pix`**

Crie `src/app/api/assinatura/pix/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { validarCpfCnpj } from '@/lib/validators';
import { criarCobrancaPix } from '@/lib/payments/mercadopago';
import { logError } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

const VALOR_ASSINATURA = 49.9;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  let body: { cpfCnpj?: string };
  try { body = await req.json(); } catch { body = {}; }

  const usuario = await prisma.usuario.findUnique({ where: { id: session.sub } });
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

  let cpfCnpj = usuario.cpfCnpj;
  if (!cpfCnpj) {
    if (!body.cpfCnpj || !validarCpfCnpj(body.cpfCnpj)) {
      return NextResponse.json({ error: 'Informe um CPF ou CNPJ válido para gerar o PIX.', precisaCpfCnpj: true }, { status: 400 });
    }
    cpfCnpj = body.cpfCnpj.replace(/\D/g, '');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { cpfCnpj } });
  }

  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
  if (!assinatura) return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 });

  const idempotencyKey = randomUUID();
  const cobranca = await prisma.cobranca.create({
    data: { assinaturaId: assinatura.id, valor: VALOR_ASSINATURA, idempotencyKey },
  });

  try {
    const resultado = await criarCobrancaPix({
      valor:         VALOR_ASSINATURA,
      descricao:     'Assinatura WorkPro Control — 30 dias',
      idempotencyKey,
      payerEmail:    usuario.email,
      payerNome:     usuario.nome,
      payerCpfCnpj:  cpfCnpj,
    });

    await prisma.cobranca.update({
      where: { id: cobranca.id },
      data: {
        mpPaymentId:  resultado.mpPaymentId,
        qrCode:       resultado.qrCode,
        qrCodeBase64: resultado.qrCodeBase64,
        expiraEm:     new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    return NextResponse.json({ cobrancaId: cobranca.id, qrCode: resultado.qrCode, qrCodeBase64: resultado.qrCodeBase64 });
  } catch (err) {
    logError('assinatura.pix', `Falha ao criar cobrança PIX para usuário ${usuario.id}`, err as Error);
    await prisma.cobranca.update({ where: { id: cobranca.id }, data: { status: 'REJEITADA' } });
    return NextResponse.json({ error: 'Falha ao gerar cobrança PIX. Tente novamente.' }, { status: 502 });
  }
}
```

- [ ] **Step 2: Implementar `GET /api/assinatura/status`**

Crie `src/app/api/assinatura/status/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { obterStatusParaCliente } from '@/lib/assinatura/servico';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const status = await obterStatusParaCliente(session.sub);
  return NextResponse.json(status);
}
```

- [ ] **Step 3: Teste manual completo contra o sandbox do Mercado Pago**

Com `npm run dev` rodando, `MP_ACCESS_TOKEN` de TESTE configurado no `.env`, e um usuário logado (cookie de sessão no navegador ou copiado para o `curl`):

```bash
curl -s -X POST http://localhost:3000/api/assinatura/pix \
  -H "Content-Type: application/json" \
  -H "Cookie: nf_sess=<COOKIE_DA_SESSAO>" \
  -d '{"cpfCnpj":"11144477735"}'
```
Expected: JSON com `cobrancaId`, `qrCode` (string longa começando com dados do PIX copia-e-cola) e `qrCodeBase64` (string base64 longa).

```bash
curl -s http://localhost:3000/api/assinatura/status -H "Cookie: nf_sess=<COOKIE_DA_SESSAO>"
```
Expected: `{"ativo":false,"motivo":"trial_expirado"|"assinatura_vencida",...}` (ainda não pago).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/assinatura/pix/route.ts src/app/api/assinatura/status/route.ts
git commit -m "feat(assinatura): endpoints de criação de PIX e status para o cliente"
```

---

### Task 9: Gating de páginas — `route-access.ts`, `x-pathname`, `AssinaturaGate`

**Files:**
- Create: `src/lib/route-access.ts`
- Modify: `src/middleware.ts`
- Create: `src/components/assinatura/AssinaturaGate.tsx`

**Interfaces:**
- Consumes: `temAcessoAtivo` de `@/lib/assinatura/acesso` (Task 2); `getSession` de `@/lib/auth` (já existente); `prisma` de `@/lib/prisma`.
- Produces: `isPublicPage(pathname: string): boolean` (compartilhado entre middleware e o gate); componente `AssinaturaGate` usado no `layout.tsx` (Task 11).

- [ ] **Step 1: Extrair a lista de rotas públicas de página para um módulo compartilhado**

Crie `src/lib/route-access.ts`:

```ts
/**
 * Lista única de rotas de PÁGINA públicas — compartilhada entre o middleware
 * (Edge, decide redirect de autenticação) e o AssinaturaGate (Node, decide
 * bloqueio por assinatura), para as duas camadas nunca divergirem sobre o que
 * é público.
 */
export const PUBLIC_PAGE_PREFIXES = ['/auth', '/landing'];
export const PUBLIC_PAGE_EXACT    = ['/'];

export function isPublicPage(pathname: string): boolean {
  if (PUBLIC_PAGE_EXACT.includes(pathname)) return true;
  return PUBLIC_PAGE_PREFIXES.some(p => pathname.startsWith(p));
}
```

- [ ] **Step 2: Atualizar o middleware para usar o módulo compartilhado e propagar `x-pathname`**

Em `src/middleware.ts`, troque:

```ts
// Rotas que não exigem autenticação
const PUBLIC_PAGE_PREFIXES = ['/auth', '/landing'];
const PUBLIC_PAGE_EXACT    = ['/'];
const PUBLIC_API_PREFIXES  = ['/api/auth/', '/api/webhooks/'];
```

por:

```ts
import { isPublicPage } from '@/lib/route-access';

// Rotas de API que não exigem autenticação (rotas de PÁGINA usam isPublicPage, importado acima)
const PUBLIC_API_PREFIXES  = ['/api/auth/', '/api/webhooks/'];
```

E troque a função `isPublic`:

```ts
function isPublic(pathname: string): boolean {
  if (isPublicPage(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p)))  return true;
  if (PUBLIC_API_EXACT.includes(pathname))                     return true;
  return false;
}
```

Por fim, adicione o header `x-pathname` nas DUAS respostas `NextResponse.next()` da função `middleware`:

```ts
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    const res = NextResponse.next();
    res.headers.set('x-pathname', pathname);
    return res;
  }

  const session = await getSessionFromRequest(req);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/auth';
    return NextResponse.redirect(url);
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const res   = NextResponse.next();
  res.headers.set('x-pathname', pathname);
  if (token) {
    try {
      const { exp } = JSON.parse(atob(token.split('.')[1]));
      const secsLeft = (exp as number) - Math.floor(Date.now() / 1000);
      if (secsLeft < 60 * 60 * 24 * 15) {
        const newToken = await signToken({ sub: session.sub, email: session.email, nome: session.nome });
        setSessionCookie(res, newToken);
      }
    } catch { /* ignora erros de parsing */ }
  }
  return res;
}
```

(Import e demais imports do arquivo continuam iguais; apenas a origem de `PUBLIC_PAGE_PREFIXES`/`PUBLIC_PAGE_EXACT` muda e o header novo é setado.)

- [ ] **Step 3: Implementar `AssinaturaGate`**

Crie `src/components/assinatura/AssinaturaGate.tsx`:

```tsx
import { headers } from 'next/headers';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { temAcessoAtivo } from '@/lib/assinatura/acesso';
import { isPublicPage } from '@/lib/route-access';
import TelaBloqueio from './TelaBloqueio';

export default async function AssinaturaGate({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-pathname') ?? '';
  if (isPublicPage(pathname)) return <>{children}</>;

  const session = await getSession();
  if (!session) return <>{children}</>; // sem sessão: o middleware já redirecionou para /auth

  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: session.sub } });
  if (temAcessoAtivo(assinatura)) return <>{children}</>;

  const motivo = !assinatura?.periodoFimEm ? 'trial_expirado' as const : 'assinatura_vencida' as const;
  return <TelaBloqueio motivo={motivo} />;
}
```

Este arquivo importa `TelaBloqueio`, criado na Task 10 — a ordem de tasks já prevê isso; se rodar `tsc` antes da Task 10, o erro esperado é `Cannot find module './TelaBloqueio'`, não um bug.

- [ ] **Step 4: Commit**

```bash
git add src/lib/route-access.ts src/middleware.ts src/components/assinatura/AssinaturaGate.tsx
git commit -m "feat(assinatura): gating de páginas via AssinaturaGate (Server Component, checagem direta no banco)"
```

---

### Task 10: Tela de bloqueio

**Files:**
- Create: `src/components/assinatura/TelaBloqueio.tsx`

**Interfaces:**
- Consumes: `POST /api/assinatura/pix`, `GET /api/assinatura/status` (Task 8); `validarCpfCnpj` de `@/lib/validators` (já existente).
- Produces: componente `TelaBloqueio({ motivo: 'trial_expirado' | 'assinatura_vencida' })`, consumido por `AssinaturaGate` (Task 9).

- [ ] **Step 1: Implementar o componente**

Crie `src/components/assinatura/TelaBloqueio.tsx`:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { validarCpfCnpj } from '@/lib/validators';

interface Props {
  motivo: 'trial_expirado' | 'assinatura_vencida';
}

export default function TelaBloqueio({ motivo }: Props) {
  const router = useRouter();
  const [precisaCpfCnpj, setPrecisaCpfCnpj] = useState(false);
  const [cpfCnpj, setCpfCnpj]               = useState('');
  const [erro, setErro]                     = useState('');
  const [carregando, setCarregando]         = useState(false);
  const [qrCode, setQrCode] = useState<{ qrCode: string; qrCodeBase64: string } | null>(null);

  const gerarPix = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const r = await fetch('/api/assinatura/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cpfCnpj ? { cpfCnpj: cpfCnpj.replace(/\D/g, '') } : {}),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.precisaCpfCnpj) setPrecisaCpfCnpj(true);
        setErro(d.error || 'Erro ao gerar cobrança.');
        return;
      }
      setQrCode({ qrCode: d.qrCode, qrCodeBase64: d.qrCodeBase64 });
    } catch {
      setErro('Erro de conexão.');
    } finally {
      setCarregando(false);
    }
  }, [cpfCnpj]);

  useEffect(() => {
    if (!qrCode) return;
    const id = setInterval(async () => {
      const r = await fetch('/api/assinatura/status');
      if (!r.ok) return;
      const d = await r.json();
      if (d.ativo) {
        clearInterval(id);
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(id);
  }, [qrCode, router]);

  const titulo      = motivo === 'trial_expirado' ? 'Seu teste gratuito expirou' : 'Renove seu plano para continuar utilizando';
  const textoBotao   = motivo === 'trial_expirado' ? 'Assinar Agora' : 'Renovar Plano';
  const cpfCnpjValido = validarCpfCnpj(cpfCnpj);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#F4F6FB] px-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-sm p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">{titulo}</h1>
        <p className="text-gray-500 text-sm mb-8">
          Para continuar utilizando o WorkPro Control, é necessário assinar o plano (R$ 49,90/mês via PIX).
        </p>

        {!qrCode && (
          <>
            {precisaCpfCnpj && (
              <input
                type="text"
                placeholder="CPF ou CNPJ"
                value={cpfCnpj}
                onChange={e => setCpfCnpj(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 text-center"
              />
            )}
            {erro && <p className="text-red-600 text-sm mb-4">{erro}</p>}
            <button
              onClick={gerarPix}
              disabled={carregando || (precisaCpfCnpj && !cpfCnpjValido)}
              className="w-full bg-blue-600 text-white font-semibold rounded-xl py-3 disabled:opacity-50"
            >
              {carregando ? 'Gerando...' : textoBotao}
            </button>
          </>
        )}

        {qrCode && (
          <div>
            <img
              src={`data:image/png;base64,${qrCode.qrCodeBase64}`}
              alt="QR Code PIX"
              className="mx-auto mb-4 w-56 h-56"
            />
            <textarea
              readOnly
              value={qrCode.qrCode}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs mb-4"
              rows={3}
              onFocus={e => e.currentTarget.select()}
            />
            <p className="text-gray-400 text-xs">Aguardando confirmação do pagamento...</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (o import de `AssinaturaGate` na Task 9 agora resolve).

- [ ] **Step 3: Commit**

```bash
git add src/components/assinatura/TelaBloqueio.tsx
git commit -m "feat(assinatura): tela de bloqueio com geração de PIX e polling de status"
```

---

### Task 11: Ligar o `AssinaturaGate` ao layout raiz

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `AssinaturaGate` (Task 9).

- [ ] **Step 1: Inserir o `AssinaturaGate` entre o body e o `AppShell`**

Em `src/app/layout.tsx`, troque:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'NF Control',
  description: 'Controle de notas fiscais simplificado',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

por:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/layout/AppShell';
import AssinaturaGate from '@/components/assinatura/AssinaturaGate';

export const metadata: Metadata = {
  title: 'NF Control',
  description: 'Controle de notas fiscais simplificado',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AssinaturaGate>
          <AppShell>{children}</AppShell>
        </AssinaturaGate>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Teste manual de regressão — usuário com trial ativo não é afetado**

Com `npm run dev` rodando, faça login com um usuário recém-criado (dentro dos 7 dias de trial) e navegue por `/home`, `/painel`, `/notas`. Expected: tudo funciona exatamente como antes, sem tela de bloqueio.

- [ ] **Step 3: Teste manual — usuário sem acesso vê a tela de bloqueio**

No Prisma Studio (`npx prisma studio`), edite manualmente a `Assinatura` de um usuário de teste, colocando `trialFimEm` no passado e `periodoFimEm` nulo. Recarregue `/painel` no navegador logado como esse usuário. Expected: `TelaBloqueio` com título "Seu teste gratuito expirou", nenhuma nav lateral/inferior visível.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(assinatura): liga AssinaturaGate ao layout raiz"
```

---

### Task 12: Gating de rotas de API protegidas

**Files:**
- Modify: `src/app/api/notas/route.ts`
- Modify: `src/app/api/notas/[id]/route.ts`
- Modify: `src/app/api/notas/resumo/route.ts`
- Modify: `src/app/api/gastos/route.ts`
- Modify: `src/app/api/gastos/[id]/route.ts`
- Modify: `src/app/api/gastos/export-pdf/route.ts`
- Modify: `src/app/api/impostos/route.ts`
- Modify: `src/app/api/impostos/[id]/route.ts`
- Modify: `src/app/api/servicos/route.ts`
- Modify: `src/app/api/servicos/[id]/route.ts`
- Modify: `src/app/api/colaboradores/route.ts`
- Modify: `src/app/api/colaboradores/[id]/route.ts`
- Modify: `src/app/api/relatorios/route.ts`
- Modify: `src/app/api/relatorios/export-excel/route.ts`
- Modify: `src/app/api/relatorios/export-pdf/route.ts`
- Modify: `src/app/api/pdf-extract/route.ts`
- Modify: `src/app/api/upload/route.ts`
- Modify: `src/app/api/uploads/[filename]/route.ts`

**Interfaces:**
- Consumes: `verificarAcessoAssinatura`, `AssinaturaInativaError` de `@/lib/assinatura/acesso` (Task 2).

Este é um bloco de edições mecânicas e idênticas em 18 arquivos: em CADA handler exportado (`GET`/`POST`/`PUT`/`DELETE`) que já tem o bloco

```ts
const session = await getSession();
if (!session) return NextResponse.json({ error: '...' }, { status: 401 });
```

adicionar logo depois:

```ts
try {
  await verificarAcessoAssinatura(session.sub);
} catch {
  return NextResponse.json({ error: 'Assinatura inativa ou trial expirado.' }, { status: 402 });
}
```

E adicionar o import no topo do arquivo:

```ts
import { verificarAcessoAssinatura } from '@/lib/assinatura/acesso';
```

Alguns arquivos têm mais de um handler (ex.: `notas/[id]/route.ts` tem `GET`, `PUT`, `DELETE` — 3 blocos `getSession()`) — repetir a inserção em CADA ocorrência do bloco acima dentro do mesmo arquivo, uma vez por handler.

- [ ] **Step 1:** `src/app/api/notas/route.ts` — 2 handlers (`GET`, `POST`)
- [ ] **Step 2:** `src/app/api/notas/[id]/route.ts` — 3 handlers (`GET`, `PUT`, `DELETE`)
- [ ] **Step 3:** `src/app/api/notas/resumo/route.ts` — 1 handler
- [ ] **Step 4:** `src/app/api/gastos/route.ts` — 2 handlers
- [ ] **Step 5:** `src/app/api/gastos/[id]/route.ts` — 3 handlers
- [ ] **Step 6:** `src/app/api/gastos/export-pdf/route.ts` — 1 handler
- [ ] **Step 7:** `src/app/api/impostos/route.ts` — 2 handlers
- [ ] **Step 8:** `src/app/api/impostos/[id]/route.ts` — 2 handlers
- [ ] **Step 9:** `src/app/api/servicos/route.ts` — 2 handlers
- [ ] **Step 10:** `src/app/api/servicos/[id]/route.ts` — 2 handlers
- [ ] **Step 11:** `src/app/api/colaboradores/route.ts` — 2 handlers
- [ ] **Step 12:** `src/app/api/colaboradores/[id]/route.ts` — 3 handlers
- [ ] **Step 13:** `src/app/api/relatorios/route.ts` — 1 handler
- [ ] **Step 14:** `src/app/api/relatorios/export-excel/route.ts` — 1 handler
- [ ] **Step 15:** `src/app/api/relatorios/export-pdf/route.ts` — 1 handler
- [ ] **Step 16:** `src/app/api/pdf-extract/route.ts` — 1 handler
- [ ] **Step 17:** `src/app/api/upload/route.ts` — 1 handler
- [ ] **Step 18:** `src/app/api/uploads/[filename]/route.ts` — 1 handler

- [ ] **Step 19: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. Se algum arquivo acusar `verificarAcessoAssinatura` não usado ou import duplicado, é sinal de uma inserção feita no lugar errado ou repetida — revisar esse arquivo específico.

- [ ] **Step 20: Teste manual — rota bloqueada mesmo manipulando a requisição direto**

Usando o mesmo usuário de teste da Task 11 Step 3 (assinatura já expirada manualmente no Prisma Studio):

```bash
curl -s -X GET http://localhost:3000/api/notas -H "Cookie: nf_sess=<COOKIE_DO_USUARIO_BLOQUEADO>" -i | head -5
```
Expected: `HTTP/1.1 402` — bloqueado mesmo chamando a API diretamente, sem passar pela tela.

- [ ] **Step 21: Teste manual — usuário com trial ativo continua funcionando (sem regressão)**

```bash
curl -s -X GET http://localhost:3000/api/notas -H "Cookie: nf_sess=<COOKIE_DE_USUARIO_COM_TRIAL_VALIDO>" -i | head -5
```
Expected: `HTTP/1.1 200`, resposta normal da lista de notas.

- [ ] **Step 22: Commit**

```bash
git add src/app/api/notas src/app/api/gastos src/app/api/impostos src/app/api/servicos src/app/api/colaboradores src/app/api/relatorios src/app/api/pdf-extract/route.ts src/app/api/upload/route.ts src/app/api/uploads
git commit -m "feat(assinatura): gating de assinatura em todas as rotas de API do painel"
```

---

### Task 13: Lembrete por e-mail (3 dias antes do vencimento)

**Files:**
- Create: `src/lib/email/templates/assinatura-vencendo.ts`
- Create: `src/lib/assinatura/lembretes.ts`
- Create: `src/app/api/assinatura/sweep/route.ts`
- Modify: `src/instrumentation.ts`

**Interfaces:**
- Consumes: `enviarEmail` de `@/lib/email/mailer` (já existente); `formatarData` de `@/lib/validators` (já existente); `logInfo`/`logError` de `@/lib/extractors/logger` (já existente).
- Produces: `processarLembretesVencimento(agora?: Date): Promise<{ verificadas: number; enviados: number; falhas: number }>`.

- [ ] **Step 1: Criar o template de e-mail**

Crie `src/lib/email/templates/assinatura-vencendo.ts`:

```ts
import { formatarData } from '@/lib/validators';

export interface DadosAssinaturaVencendo {
  nome: string;
  dataVencimento: Date;
}

/** Mesmo padrão de layout de src/lib/email/templates/vencimento-documento.ts. */
export function templateAssinaturaVencendo(d: DadosAssinaturaVencendo): { subject: string; html: string } {
  const subject = 'Sua assinatura do WorkPro Control vence em breve';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:#1e3a8a;padding:20px 24px;">
              <span style="color:#ffffff;font-size:15px;font-weight:700;">WorkPro Control</span>
              <br>
              <span style="color:#bfdbfe;font-size:12px;">Assinatura</span>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 24px;">
              <p style="margin:0 0 12px 0;color:#111827;font-size:18px;font-weight:700;">Olá, ${d.nome.split(' ')[0]}!</p>
              <p style="margin:0 0 20px 0;color:#374151;font-size:14px;line-height:1.6;">
                Sua assinatura vence em <strong>${formatarData(d.dataVencimento)}</strong>. Para continuar usando o
                WorkPro Control sem interrupção, renove seu plano (R$ 49,90/mês via PIX) antes dessa data.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 24px 24px;">
              <div style="height:1px;background:#f3f4f6;margin-bottom:16px;"></div>
              <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5;">
                Notificação automática do WorkPro Control. Se já renovou, ignore este e-mail.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
```

- [ ] **Step 2: Implementar o sweep de lembretes**

Crie `src/lib/assinatura/lembretes.ts`:

```ts
/**
 * Sweep de lembretes de vencimento — mesmo padrão de
 * src/lib/colaboradores/notificacoes.ts. Roda periodicamente (ver
 * src/instrumentation.ts). lembreteEnviadoEm evita reenvio duplicado; é
 * resetado para null em processarPagamentoAprovado() a cada renovação, para
 * que o lembrete do PRÓXIMO ciclo também possa ser enviado.
 */
import prisma from '@/lib/prisma';
import { enviarEmail } from '@/lib/email/mailer';
import { templateAssinaturaVencendo } from '@/lib/email/templates/assinatura-vencendo';
import { logInfo, logError } from '@/lib/extractors/logger';

const JANELA_LEMBRETE_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias

export interface ResultadoSweepLembretes {
  verificadas: number;
  enviados: number;
  falhas: number;
}

export async function processarLembretesVencimento(agora: Date = new Date()): Promise<ResultadoSweepLembretes> {
  const limite = new Date(agora.getTime() + JANELA_LEMBRETE_MS);

  const assinaturas = await prisma.assinatura.findMany({
    where: {
      periodoFimEm: { not: null, lte: limite, gt: agora },
      lembreteEnviadoEm: null,
    },
    include: { usuario: { select: { email: true, nome: true } } },
  });

  let enviados = 0;
  let falhas = 0;

  for (const a of assinaturas) {
    if (!a.usuario?.email || !a.periodoFimEm) continue;
    try {
      const { subject, html } = templateAssinaturaVencendo({ nome: a.usuario.nome, dataVencimento: a.periodoFimEm });
      const resultado = await enviarEmail({ to: a.usuario.email, subject, html });
      if (!resultado.enviado) continue; // SMTP indisponível — tenta de novo no próximo sweep

      await prisma.assinatura.update({ where: { id: a.id }, data: { lembreteEnviadoEm: agora } });
      enviados++;
    } catch (err) {
      falhas++;
      logError('assinatura.lembretes', `Falha ao lembrar assinatura ${a.id}`, err as Error);
    }
  }

  logInfo('assinatura.lembretes', 'Sweep de lembretes de vencimento concluído', {
    verificadas: assinaturas.length, enviados, falhas,
  });

  return { verificadas: assinaturas.length, enviados, falhas };
}
```

- [ ] **Step 3: Rota interna do sweep**

Crie `src/app/api/assinatura/sweep/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { processarLembretesVencimento } from '@/lib/assinatura/lembretes';

export const dynamic = 'force-dynamic';

/** Protegido por segredo compartilhado — mesmo padrão de /api/colaboradores/sweep. */
export async function POST(req: NextRequest) {
  const secret = process.env.SWEEP_SECRET;
  if (secret && req.headers.get('x-sweep-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const resultado = await processarLembretesVencimento();
    return NextResponse.json(resultado);
  } catch (err) {
    console.error('[POST /api/assinatura/sweep]', err);
    return NextResponse.json({ error: 'Erro ao processar lembretes' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Agendar o sweep em `src/instrumentation.ts`**

Em `src/instrumentation.ts`, dentro da função `register()`, depois do bloco existente do `tick` de colaboradores (depois de `setInterval(tick, INTERVALO_MS);`), adicione:

```ts
  const tickAssinatura = async () => {
    try {
      const r = await fetch(`${baseUrl}/api/assinatura/sweep`, {
        method:  'POST',
        headers: process.env.SWEEP_SECRET ? { 'x-sweep-secret': process.env.SWEEP_SECRET } : {},
      });
      if (!r.ok) console.error(`[assinatura.scheduler] sweep retornou status ${r.status}`);
    } catch (err) {
      console.error('[assinatura.scheduler] falha ao disparar sweep de lembretes de assinatura', err);
    }
  };

  console.log('[assinatura.scheduler] iniciado (intervalo: 24h)');
  setTimeout(tickAssinatura, 10_000);
  setInterval(tickAssinatura, 24 * 60 * 60 * 1000); // 1x/dia é suficiente — janela de lembrete é de 3 dias
```

(`baseUrl` já existe no escopo da função, reaproveitado do tick de colaboradores.)

- [ ] **Step 5: Teste manual do sweep**

Com `npm run dev` rodando e um usuário de teste com `Assinatura.periodoFimEm` daqui a 2 dias (editar no Prisma Studio) e `lembreteEnviadoEm` nulo:

```bash
curl -s -X POST http://localhost:3000/api/assinatura/sweep -i
```
Expected: `HTTP/1.1 200`, corpo `{"verificadas":1,"enviados":1,"falhas":0}` (ou `enviados:0` se `SMTP_HOST` não estiver configurado no `.env` — nesse caso o log deve mostrar o aviso de SMTP não configurado, sem falha).

Rodar de novo o mesmo curl: `enviados` deve ser `0` (já marcado `lembreteEnviadoEm`, sem duplicar).

- [ ] **Step 6: Commit**

```bash
git add src/lib/email/templates/assinatura-vencendo.ts src/lib/assinatura/lembretes.ts src/app/api/assinatura/sweep/route.ts src/instrumentation.ts
git commit -m "feat(assinatura): lembrete por e-mail 3 dias antes do vencimento"
```

---

### Task 14: Validação final end-to-end

**Files:** nenhum arquivo novo — checklist de verificação manual.

- [ ] **Step 1: Cadastro cria trial automaticamente**

Registrar um usuário novo via `/auth` no navegador. Verificar no Prisma Studio que `Assinatura.trialFimEm` ≈ agora + 7 dias, `status = 'TRIAL'`, `periodoFimEm = null`.

- [ ] **Step 2: Acesso liberado durante o trial**

Logado com esse usuário, navegar por `/home`, `/painel`, `/notas`, `/gastos`, `/impostos`, `/relatorios`, `/integracao` — tudo deve funcionar normalmente, sem tela de bloqueio.

- [ ] **Step 3: Bloqueio exato após o trial expirar**

No Prisma Studio, editar `trialFimEm` desse mesmo usuário para 1 minuto no passado. Recarregar qualquer página protegida. Expected: `TelaBloqueio` com "Seu teste gratuito expirou".

- [ ] **Step 4: Backfill bloqueia usuário "antigo" imediatamente**

Criar um usuário direto no Prisma Studio com `criadoEm` de 10 dias atrás e SEM linha de `Assinatura`. Rodar `npx tsx scripts/backfill-assinaturas.ts`. Fazer login com esse usuário (definir uma senha via hash bcrypt, ou usar o fluxo de "esqueci senha" se existir — caso não exista, criar via `register` e depois editar `criadoEm` manualmente para 10 dias atrás e rodar o backfill de novo). Expected: bloqueado imediatamente, sem nunca ter visto acesso liberado.

- [ ] **Step 5: Fluxo PIX completo em sandbox**

Na tela de bloqueio, informar CPF de teste válido (ex.: `11144477735`), clicar em "Assinar Agora". Expected: QR code aparece. Usando o simulador de pagamentos de teste do Mercado Pago (painel de "Suas integrações" → contas de teste), aprovar o pagamento simulado. Expected: em até ~4s (polling) a página recarrega sozinha e o painel aparece normalmente.

- [ ] **Step 6: Webhook com assinatura inválida é rejeitado**

Repetir o teste manual da Task 7 Step 3 — `curl` com `x-signature` forjada. Expected: `401`, e no Prisma Studio nenhuma `Cobranca`/`Assinatura` foi alterada.

- [ ] **Step 7: Webhook duplicado processa uma vez só**

Reenviar manualmente (via `curl`, reaproveitando `data.id` e headers de uma notificação real já processada no Step 5) a mesma notificação duas vezes. Expected: `Assinatura.periodoFimEm` não muda na segunda chamada (conferir timestamp antes/depois no Prisma Studio).

- [ ] **Step 8: Rota de API bloqueada mesmo manipulando a requisição direto**

Repetir o teste manual da Task 12 Step 20 com o usuário bloqueado do Step 3. Expected: `402`.

- [ ] **Step 9: Nenhuma regressão para quem já tem acesso ativo**

Com o usuário que pagou no Step 5 (agora com `periodoFimEm` no futuro), navegar por todas as páginas do painel de novo. Expected: comportamento idêntico ao anterior a esta feature — nenhuma mudança visual ou funcional fora da remoção da tela de bloqueio.

- [ ] **Step 10: `npx tsc --noEmit` limpo em todo o projeto**

Run: `npx tsc --noEmit`
Expected: sem erros.

Nenhum commit nesta task — é só verificação. Se qualquer step falhar, voltar à task correspondente, corrigir, e repetir o self-review dessa task antes de continuar.
