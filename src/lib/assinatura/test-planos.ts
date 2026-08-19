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
