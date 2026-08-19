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
