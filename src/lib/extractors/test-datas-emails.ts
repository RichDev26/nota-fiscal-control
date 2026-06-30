/**
 * Fase 13 — Self-check determinístico de DATAS e E-MAILS.
 * Execução: npx tsx src/lib/extractors/test-datas-emails.ts
 *
 * Verifica, contra o PDF modelo e casos sintéticos:
 *   1. parseDateBR é determinístico (sem inversão DD/MM, sem perda, valida calendário).
 *   2. As datas extraídas SOBREVIVEM ao parse do save (antes viravam null).
 *   3. O e-mail é atribuído à zona correta (prestador), nunca cruza para o tomador.
 */
import fs   from 'fs';
import path from 'path';

import { parseDateBR }          from '@/lib/validators';
import { extractCriticalFields } from './critical-fields';
import { extractPrestador }      from './prestador';
import { extractTomador }        from './tomador';

const PDF_PATH = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  'Downloads', 'MODELO NF.pdf',
);

let falhas = 0;
function check(nome: string, cond: boolean, detalhe = '') {
  console.log(`${cond ? '✅' : '❌'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!cond) falhas++;
}

// ── 1. parseDateBR determinístico ──────────────────────────────────────────────
const inversao = parseDateBR('09/06/2025');                       // o caso clássico do prompt
check('09/06/2025 = 9 de JUNHO (não set/06)',
  !!inversao && inversao.getUTCMonth() === 5 && inversao.getUTCDate() === 9,
  inversao ? inversao.toISOString().slice(0, 10) : 'null');

const comHora = parseDateBR('19/05/2026 12:01:05');               // formato real da extração NFS-e
check('19/05/2026 12:01:05 = 19 de MAIO (não Invalid)',
  !!comHora && comHora.getUTCMonth() === 4 && comHora.getUTCDate() === 19,
  comHora ? comHora.toISOString().slice(0, 10) : 'null');

check('31/02/2025 rejeitada (calendário)', parseDateBR('31/02/2025') === null);
check('18/15/2025 rejeitada (mês inválido)', parseDateBR('18/15/2025') === null);
const iso = parseDateBR('2026-05-19');                            // input <input type="date">
check('ISO 2026-05-19 = 19 de MAIO',
  !!iso && iso.getUTCMonth() === 4 && iso.getUTCDate() === 19);
check('vazio → null', parseDateBR('') === null && parseDateBR(null) === null);

// ── PDF modelo ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(PDF_PATH)) {
  console.log(`\n⚠️  PDF modelo não encontrado em ${PDF_PATH} — pulando testes de extração.`);
  process.exit(falhas === 0 ? 0 : 1);
}

(async () => {
  const buf  = fs.readFileSync(PDF_PATH);
  const crit = await extractCriticalFields(buf);

  console.log('\n── DATAS EXTRAÍDAS ──');
  console.log('  dataEmissao    :', crit.dataEmissao.value, `(conf ${crit.dataEmissao.confidence})`);
  console.log('  dataFatoGerador:', crit.dataFatoGerador.value, `(conf ${crit.dataFatoGerador.confidence})`);

  // 2. As datas sobrevivem ao parse do SAVE (era o bug de perda de dado)
  const emissaoSalva = parseDateBR(crit.dataEmissao.value);
  check('dataEmissao SOBREVIVE ao save (não-null)', emissaoSalva !== null,
    emissaoSalva ? emissaoSalva.toISOString().slice(0, 10) : 'PERDIDA');
  check('dia/mês preservados no save',
    !!emissaoSalva && emissaoSalva.getUTCDate() === 19 && emissaoSalva.getUTCMonth() === 4);

  // 3. E-mail na zona correta. Modelo: jminox...@gmail.com pertence ao PRESTADOR (JM Inox).
  const pre = await extractPrestador(buf);
  const tom = await extractTomador(buf);

  console.log('\n── E-MAIL POR ZONA ──');
  console.log('  prestador.email:', pre.prestador.email.valor);
  console.log('  tomador.email  :', tom.tomador.email.valor);

  check('e-mail atribuído ao PRESTADOR (JM Inox)',
    pre.prestador.email.valor === 'jminoxmanutencaoindustrial@gmail.com');
  check('e-mail do prestador NÃO vazou para o tomador',
    tom.tomador.email.valor !== 'jminoxmanutencaoindustrial@gmail.com');

  console.log(`\n${falhas === 0 ? '🟢 TODOS OS CHECKS PASSARAM' : `🔴 ${falhas} CHECK(S) FALHARAM`}`);
  process.exit(falhas === 0 ? 0 : 1);
})();
