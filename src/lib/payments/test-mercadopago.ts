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
