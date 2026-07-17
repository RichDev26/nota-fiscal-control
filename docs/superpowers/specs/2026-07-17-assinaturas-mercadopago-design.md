# Sistema de Assinaturas via Mercado Pago (PIX) — Design

Data: 2026-07-17
Projeto: NF Control / WorkPro Control (`nota-fiscal-control/`)

## Objetivo

Transformar o sistema em SaaS por assinatura: 7 dias de teste gratuito automático
para toda conta nova, bloqueio completo do painel após expirar (sem excluir
dados), e liberação de acesso apenas mediante pagamento PIX confirmado
oficialmente pelo Mercado Pago. Usuários que já usam o sistema há mais de 7
dias devem ser bloqueados imediatamente após o deploy desta feature.

Preço de referência (já publicado na landing page, `src/app/page.tsx`):
R$ 49,90/mês.

## Fora de escopo (decisões explícitas do usuário)

- Cartão de crédito e boleto — não nesta fase, mas a arquitetura não pode
  impedir adicionar depois (ver `Cobranca.metodo`).
- Isenção de bloqueio para a conta `ADMIN_EMAIL` — o admin segue as mesmas
  regras de qualquer usuário.
- Botão de "cancelar assinatura" — como o PIX é pagamento avulso (sem débito
  automático), não existe uma cobrança recorrente ativa para cancelar. Não
  renovar já produz o efeito de "cancelamento" quando o período acabar.
- Sincronização manual de sessão/claims — descartada porque o design usa
  checagem direta no banco a cada request (ver seção de Gating), então não há
  cache para invalidar.

## Modelo de dados (Prisma)

```prisma
model Assinatura {
  id              String     @id @default(cuid())
  usuarioId       String     @unique
  status          String     @default("TRIAL") // informativo — não é fonte da verdade
  trialFimEm      DateTime   // fixado na criação da conta, nunca muda
  periodoFimEm    DateTime?  // null até a 1ª confirmação de pagamento
  lembreteEnviadoEm DateTime? // evita reenvio duplicado do e-mail de vencimento
  usuario         Usuario    @relation(fields: [usuarioId], references: [id])
  cobrancas       Cobranca[]
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
}

model Cobranca {
  id              String     @id @default(cuid())
  assinaturaId    String
  metodo          String     @default("PIX")
  valor           Float      // reais (ex: 49.90) — mesma unidade usada em NotaFiscal.valorBruto, não centavos
  status          String     @default("PENDENTE") // 'PENDENTE' | 'APROVADA' | 'REJEITADA' | 'EXPIRADA'
  mpPaymentId     String?    @unique
  idempotencyKey  String     @unique
  qrCode          String?
  qrCodeBase64    String?
  expiraEm        DateTime?
  assinatura      Assinatura @relation(fields: [assinaturaId], references: [id])
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@index([status])
}
```

`Usuario` ganha a relação `assinatura Assinatura?`.

**Princípio de design:** o acesso nunca é decidido por um campo booleano
gravado antecipadamente. É sempre **calculado no momento da requisição** por
uma função pura `temAcessoAtivo(assinatura, agora)` que compara `trialFimEm` /
`periodoFimEm` com o relógio atual. Datas não ficam desatualizadas por um bug
que "esqueceu" de desativar um flag; esse é o motivo explícito pedido na
auditoria de segurança.

## Mecanismo de bloqueio de acesso (gating)

O `middleware.ts` roda em Edge Runtime; Prisma não funciona no Edge com este
setup. Por isso o gating acontece em dois pontos, ambos em Node.js runtime,
ambos consultando o banco a cada request (sem cache de claims em JWT):

1. **Páginas** — novo Server Component `AssinaturaGate`, inserido entre
   `RootLayout` e `AppShell`. O middleware ganha uma linha nova setando o
   header `x-pathname` (continua Edge-safe). `AssinaturaGate` lê esse header,
   ignora rotas públicas (`/`, `/auth`, `/landing`), e para o restante:
   sem sessão → passa adiante (middleware já teria redirecionado);
   com sessão → consulta `Assinatura`, chama `temAcessoAtivo()`; sem acesso
   → renderiza `TelaBloqueio` no lugar de `AppShell` (nav não é exposta).

2. **Rotas de API protegidas** — helper `verificarAcessoAssinatura(usuarioId)`
   em `src/lib/assinatura/acesso.ts`, chamado logo após `getSession()` nas
   rotas: `notas`, `gastos`, `impostos`, `servicos`, `colaboradores`,
   `relatorios`, `pdf-extract`, `upload`. Lança um erro tipado
   (`AssinaturaInativaError`) tratado como 402/403 pelo route handler.

   Fail-closed: se `usuarioId` não tiver nenhuma linha em `Assinatura` (ex.:
   corrida entre deploy e backfill), trata como **sem acesso** — nunca abre
   exceção liberando por ausência de registro.

   A tela de bloqueio é renderizada **no lugar** do conteúdo da página que o
   usuário tentou acessar — não há redirect para uma URL `/assinatura`
   separada; a URL na barra de endereço continua sendo a página protegida
   original.

   Exceções (não passam por essa checagem):
   - `/api/auth/*` — já público ou pré-sessão
   - `/api/fila/*` — ferramentas internas, autorização própria via
     `ADMIN_EMAIL`, não é billing de cliente
   - `/api/assinatura/*` — tem que funcionar para quem está bloqueado pagar
   - `/api/webhooks/mercadopago` — chamado pelo servidor do MP, sem sessão de
     usuário; protegido por validação de assinatura HMAC

3. **Sem endpoint de "sincronizar sessão"** — como não há cache, um
   `router.refresh()` no client após confirmação do pagamento já é suficiente
   para o `AssinaturaGate` reler o banco e liberar o acesso.

## Integração com Mercado Pago (PIX)

Implementação via `fetch` direto na REST API do Mercado Pago (sem adicionar o
pacote `mercadopago` como dependência) — controle explícito do payload e da
validação de assinatura do webhook, sem trazer um SDK genérico para uma
integração pontual.

Novo módulo `src/lib/payments/mercadopago.ts`:

- **`criarCobrancaPix({ usuarioId, valor, descricao })`** — gera
  `idempotencyKey` local (cuid), grava `Cobranca` como `PENDENTE` antes de
  chamar o MP, chama `POST /v1/payments` com `payment_method_id: 'pix'` e
  header `X-Idempotency-Key` igual à chave local (retries não duplicam
  cobrança no MP). Salva `mpPaymentId`, `qrCode`, `qrCodeBase64`, `expiraEm`.

- **`buscarPagamento(mpPaymentId)`** — `GET /v1/payments/:id`, busca o status
  real na fonte oficial. O corpo do webhook nunca é confiado diretamente;
  serve só de gatilho para buscar o pagamento de verdade.

- **`validarAssinaturaWebhook(headers, rawBody)`** — valida o header
  `x-signature` do MP via HMAC-SHA256 com `MP_WEBHOOK_SECRET`, comparação
  timing-safe (`crypto.timingSafeEqual`). O formato exato do manifest
  assinado (ordem de `id`/`request-id`/`ts`) será confirmado contra a
  documentação oficial do Mercado Pago no momento da implementação — código
  de segurança crítico, não escrito de memória.

**Rota `POST /api/webhooks/mercadopago`:**
1. Valida assinatura — 401 e encerra se inválida, sem processar nada
2. Extrai `payment_id`, chama `buscarPagamento()`
3. Transação Prisma: relê `Cobranca` pelo `mpPaymentId` — não existe nenhuma
   `Cobranca` com esse id (webhook de teste do MP ou de outra integração)?
   responde 200 e encerra sem ação, sem erro (evita retry infinito do MP para
   algo que nunca vai existir). Já `APROVADA`? encerra sem ação (idempotência;
   MP reenvia webhooks). `PENDENTE` + MP confirma `approved`? atualiza
   `Cobranca.status = 'APROVADA'` e estende `Assinatura.periodoFimEm` na
   mesma transação
4. Extensão: `novoFim = max(periodoFimEm atual se futuro, agora) + 30 dias`
   (renovar antes de vencer não perde dias)

**Proteções contra fraude/bypass:**
- Acesso só é liberado por `buscarPagamento()` oficial — nunca por o usuário
  dizer que pagou, abrir o QR, ou iniciar o pagamento
- `mpPaymentId` único no banco — mesma cobrança não processa 2x
- Transação com releitura do status antes de escrever — protege contra
  entregas simultâneas do webhook (race condition)
- `idempotencyKey` único — retry não duplica cobrança nova no MP
- Nenhum campo de status/período é gravável a partir do frontend — só o
  webhook grava esses campos, e só após validar a assinatura oficial

## Trial automático e backfill

- `POST /api/auth/register`: mesma transação que cria o `Usuario` cria a
  `Assinatura` com `trialFimEm = now + 7 dias`.
- Script único de backfill: para cada `Usuario` sem `Assinatura`, cria uma com
  `trialFimEm = usuario.criadoEm + 7 dias`. Contas com mais de 7 dias de
  existência ficam `temAcessoAtivo() === false` automaticamente — sem
  caminho de código separado para "conta antiga".

## Tela de bloqueio

`src/components/assinatura/TelaBloqueio.tsx`, reaproveitando a identidade
visual da landing (`Newsreader` serif, azul `#2563EB`, helper `s()` de estilo
inline). Dois textos conforme o motivo:
- Trial expirado → "Seu teste gratuito expirou" / "Assinar Agora"
- Assinatura vencida → "Renove seu plano para continuar utilizando" /
  "Renovar Plano"

Ambos os botões: `POST /api/assinatura/pix` → QR code + copia-e-cola →
polling em `GET /api/assinatura/status` a cada ~4s → confirmado →
`router.refresh()`.

## Lembrete por e-mail (3 dias antes do vencimento)

Reaproveita `src/lib/email/mailer.ts` e o padrão de templates existente.
Novo template `assinatura-vencendo.ts`. Sweep no mesmo padrão do
`colaboradores/sweep` (endpoint interno protegido por `SWEEP_SECRET`).
Busca `Assinatura` com `periodoFimEm` entre agora e +3 dias e
`lembreteEnviadoEm` nulo; envia e marca `lembreteEnviadoEm = now` para não
duplicar.

## Variáveis de ambiente novas

- `MP_ACCESS_TOKEN` — token de acesso da API do Mercado Pago
- `MP_WEBHOOK_SECRET` — segredo para validar `x-signature` do webhook

## Plano de testes

- Cadastro novo → trial de 7 dias criado automaticamente
- Acesso liberado durante trial, bloqueado exatamente após 7 dias
- Backfill: usuário com `criadoEm` de 10 dias atrás → bloqueado imediatamente
- Fluxo PIX completo em sandbox MP → QR → pagamento simulado → webhook →
  `Cobranca`/`Assinatura` atualizadas → acesso liberado
- Webhook com assinatura inválida → 401, nada processado
- Webhook duplicado (mesmo `mpPaymentId` 2x) → processado uma vez só, sem
  estender o período 2x
- Rota de API protegida sem assinatura ativa → bloqueada mesmo manipulando a
  requisição direto, sem passar pela tela
- Nenhuma regressão nas páginas/rotas existentes para usuário com assinatura
  ativa
