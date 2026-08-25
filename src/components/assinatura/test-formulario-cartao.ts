// Execução: npx tsx src/components/assinatura/test-formulario-cartao.ts
//
// Guarda os DOIS defeitos que deixaram o formulário de cartão impossível de
// preencher em produção. Nenhuma das 8 suítes existentes os detectou: as duas
// falhas são de integração com o SDK no navegador, e o backend continuava
// perfeito. Este arquivo é uma checagem estática do componente — barata, sem
// dependência nova — que falha se qualquer um dos dois voltar.
//
// ponytail: estático de propósito. Provar de verdade exigiria headless browser
// + SDK do Mercado Pago; o custo não se paga para travar duas regressões
// pontuais. Se um dia entrar Playwright no projeto, migrar para um teste real.
import fs from 'node:fs';
import path from 'node:path';

const arquivo = path.join(__dirname, 'FormularioCartao.tsx');
const src = fs.readFileSync(arquivo, 'utf8');

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => {
  console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) falhas++;
};

// ── Defeito 1: campos do cartão renderizados como <div> ──────────────────
// Com <div> o cardForm chama onFormMounted SEM erro e mesmo assim não liga
// nada no elemento: três caixas vazias que não aceitam digitação. Verificado
// no navegador contra o SDK real.
/** Tag JSX que abre o elemento com este id — olha para trás até o `<` mais próximo. */
function tagDoCampo(campo: string): string | null {
  const pos = src.indexOf(`id={ID('${campo}')}`);
  if (pos === -1) return null;
  const abertura = src.lastIndexOf('<', pos);
  if (abertura === -1) return null;
  const m = src.slice(abertura + 1, pos).match(/^([A-Za-z][A-Za-z0-9]*)/);
  return m ? m[1] : null;
}

for (const campo of ['cardNumber', 'expirationDate', 'securityCode']) {
  const tag = tagDoCampo(campo);
  check(`${campo} é <input> (nunca <div>)`, tag === 'input',
    tag === 'div' ? 'voltou a ser <div> — o campo fica inerte' : `tag encontrada: <${tag}>`);
}

// ── Defeito 2: efeito de montagem dependendo de `estado` ──────────────────
// onFormMounted chama setEstado('pronto'); com `estado` nas dependências o
// React roda o cleanup — unmount() — no mesmo tick em que o form termina de
// montar, e a re-execução cai no early-return. Confirmado por stack trace.
const depsDoMount = src.match(/cardFormRef\.current\?\.unmount\(\)[\s\S]{0,120}?\}, \[([^\]]*)\]/);
check('efeito que monta o cardForm foi encontrado', depsDoMount !== null);
if (depsDoMount) {
  const deps = depsDoMount[1].split(',').map(d => d.trim()).filter(Boolean);
  check('efeito NÃO depende de `estado`', !deps.includes('estado'),
    `deps atuais: [${deps.join(', ')}]`);
  check('efeito NÃO depende de `submeter`', !deps.includes('submeter'),
    'o pai passa onAprovado inline — identidade nova a cada render remontaria o form');
}

// O callback do SDK precisa ler submeter por ref, senão a dependência volta.
check('onSubmit usa submeterRef.current', /submeterRef\.current\(/.test(src));

console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
