/**
 * Fase 13.1 — Self-check de FIELD OWNERSHIP (pipeline REAL via integrador).
 * Execução: npx tsx src/lib/extractors/test-ownership-repro.ts
 *
 * Modelo: o Prestador (JM Inox) tem e-mail; o Tomador (Seara) NÃO tem.
 * Verifica que nenhum campo exclusivo de uma entidade foi preenchido com o
 * valor da outra (sem vazamento).
 */
import fs from 'fs';
import path from 'path';
import { extractFromPdfBuffer } from './integrador';

const PDF = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads', 'MODELO NF.pdf');

let falhas = 0;
function check(nome: string, cond: boolean, detalhe = '') {
  console.log(`${cond ? '✅' : '❌'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!cond) falhas++;
}

(async () => {
  const r: any = await extractFromPdfBuffer(fs.readFileSync(PDF));
  const p = r.prestador ?? {};
  const t = r.tomador ?? {};

  const campos = ['email', 'telefone', 'celular', 'site', 'endereco', 'inscricaoMunicipal', 'inscricaoEstadual', 'cpfCnpj', 'nomeRazaoSocial'];
  console.log('CAMPO                | PRESTADOR                         | TOMADOR');
  for (const c of campos) {
    const pv = String(p[c] ?? 'NULL').slice(0, 33).padEnd(33);
    const tv = String(t[c] ?? 'NULL').slice(0, 33);
    const leak = p[c] && t[c] && String(p[c]).toLowerCase() === String(t[c]).toLowerCase();
    console.log(c.padEnd(20), '|', pv, '|', tv, leak ? '  ⚠️ VAZAMENTO' : '');
  }
  console.log('');

  // 1. Sem vazamento em NENHUM campo exclusivo (mesmo valor nas duas entidades).
  const exclusivos = ['email', 'telefone', 'celular', 'site', 'endereco', 'inscricaoMunicipal', 'inscricaoEstadual'];
  for (const c of exclusivos) {
    const vazou = p[c] && t[c] && String(p[c]).toLowerCase() === String(t[c]).toLowerCase();
    check(`${c}: sem vazamento prestador↔tomador`, !vazou,
      vazou ? `ambos = ${p[c]}` : '');
  }

  // 2. O e-mail real continua no PRESTADOR (não foi perdido) e o TOMADOR fica NULL.
  check('prestador.email preservado', p.email === 'jminoxmanutencaoindustrial@gmail.com', String(p.email));
  check('tomador.email = NULL (documento não possui)', !t.email, String(t.email ?? 'NULL'));

  // 3. Campos legitimamente distintos permanecem intactos (não houve over-null).
  check('prestador.telefone preservado', !!p.telefone, String(p.telefone));
  check('tomador.telefone preservado',  !!t.telefone, String(t.telefone));
  check('CNPJs distintos preservados', p.cpfCnpj !== t.cpfCnpj && !!p.cpfCnpj && !!t.cpfCnpj);

  console.log(`\n${falhas === 0 ? '🟢 TODOS OS CHECKS PASSARAM' : `🔴 ${falhas} CHECK(S) FALHARAM`}`);
  process.exit(falhas === 0 ? 0 : 1);
})();
