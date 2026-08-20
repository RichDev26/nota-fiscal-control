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
