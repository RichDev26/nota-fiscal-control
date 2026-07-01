/**
 * Suporte a DANFE — testa detecção, extração DANFE e REGRESSÃO da NFS-e.
 * Execução: npx tsx src/lib/extractors/test-danfe.ts
 */
import fs   from 'fs';
import path from 'path';
import { detectarTipoDocumento } from './detector-documento';
import { extractDocumentFromPdfBuffer } from './extrator-router';
import pdfParse from 'pdf-parse';

const DL   = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads');
const NFSE = path.join(DL, 'MODELO NF.pdf');       // NFS-e (regressão)
const DANFE = path.join(DL, 'MODELO GASTO.pdf');    // DANFE (novo)

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const aprox = (a: number, b: number, t = 0.02) => Math.abs(a - b) <= t;

(async () => {
  // ── 1. DETECTOR ────────────────────────────────────────────────────────────
  console.log('── DETECÇÃO ──');
  if (fs.existsSync(NFSE)) {
    const d = detectarTipoDocumento((await pdfParse(fs.readFileSync(NFSE))).text);
    check('NFS-e detectada e roteada p/ NFSE', d.rota === 'NFSE', `tipo=${d.tipo} danfe=${d.scoreDanfe} nfse=${d.scoreNfse}`);
  }
  const dDanfe = detectarTipoDocumento((await pdfParse(fs.readFileSync(DANFE))).text);
  check('DANFE detectada e roteada p/ DANFE', dDanfe.rota === 'DANFE', `tipo=${dDanfe.tipo} danfe=${dDanfe.scoreDanfe} nfse=${dDanfe.scoreNfse}`);
  console.log('   evidências DANFE:', dDanfe.evidencias.danfe.join(', '));

  // ── 2. REGRESSÃO NFS-e (via router — deve extrair como antes) ───────────────
  if (fs.existsSync(NFSE)) {
    console.log('\n── REGRESSÃO NFS-e (pelo router) ──');
    const r: any = await extractDocumentFromPdfBuffer(fs.readFileSync(NFSE));
    check('NFS-e: tipo NFS-e', r.tipo === 'NFS-e', String(r.tipo));
    check('NFS-e: prestador extraído', !!r.prestador?.nomeRazaoSocial, r.prestador?.nomeRazaoSocial);
    check('NFS-e: e-mail no prestador (ownership Fase 13.1)', r.prestador?.email === 'jminoxmanutencaoindustrial@gmail.com');
    check('NFS-e: e-mail NÃO vazou p/ tomador', r.tomador?.email !== 'jminoxmanutencaoindustrial@gmail.com');
    check('NFS-e: dataEmissao presente', !!r.dataEmissao, String(r.dataEmissao));
    check('NFS-e NÃO produz lista de produtos', !r.produtos || r.produtos.length === 0);
  }

  // ── 3. EXTRAÇÃO DANFE ───────────────────────────────────────────────────────
  console.log('\n── EXTRAÇÃO DANFE ──');
  const g: any = await extractDocumentFromPdfBuffer(fs.readFileSync(DANFE));
  console.log('   fornecedor    :', g.prestador?.nomeRazaoSocial);
  console.log('   cnpj          :', g.prestador?.cpfCnpj);
  console.log('   numeroNf      :', g.numeroNf, '| série:', g.serie);
  console.log('   dataEmissao   :', g.dataEmissao);
  console.log('   valorBruto    :', g.valorBruto);
  console.log('   produtos      :', g.produtos?.length);
  (g.produtos ?? []).forEach((p: any, i: number) =>
    console.log(`     [${i}] ${p.descricao} | ${p.quantidade} ${p.unidade} × ${p.valorUnitario} = ${p.valorTotal}`));
  console.log('   inconsistências:', g.inconsistencias ?? 'nenhuma');
  console.log('   confiança/campo:', JSON.stringify(g.camposConfianca));

  check('DANFE: tipo NF-e', g.tipo === 'NF-e');
  check('DANFE: fornecedor = DOURATUBOS', /DOURATUBOS/i.test(g.prestador?.nomeRazaoSocial ?? ''));
  check('DANFE: CNPJ fornecedor 00.419.103/0001-90', g.prestador?.cpfCnpj === '00.419.103/0001-90');
  check('DANFE: número 370825', g.numeroNf === '370825', String(g.numeroNf));
  check('DANFE: série 1', g.serie === '1', String(g.serie));
  check('DANFE: dataEmissao 19/05/2026', g.dataEmissao === '19/05/2026');
  check('DANFE: valor total 1092.34', aprox(g.valorBruto, 1092.34), String(g.valorBruto));
  check('DANFE: 3 produtos', g.produtos?.length === 3, String(g.produtos?.length));
  const p0 = g.produtos?.[0];
  check('DANFE: produto[0] descrição TUBO INOX', /TUBO INOX/i.test(p0?.descricao ?? ''), p0?.descricao);
  check('DANFE: produto[0] qtd 12', aprox(p0?.quantidade, 12), String(p0?.quantidade));
  check('DANFE: produto[0] unidade MT', p0?.unidade === 'MT');
  check('DANFE: produto[0] vtotal 980', aprox(p0?.valorTotal, 980), String(p0?.valorTotal));
  const soma = (g.produtos ?? []).reduce((s: number, p: any) => s + (p.valorTotal ?? 0), 0);
  check('DANFE: Σ produtos ≈ valor total (reconciliação)', aprox(soma, g.valorBruto, 0.05), `soma=${soma.toFixed(2)}`);

  console.log(`\n${falhas === 0 ? '🟢 TODOS OS CHECKS PASSARAM' : `🔴 ${falhas} CHECK(S) FALHARAM`}`);
  process.exit(falhas === 0 ? 0 : 1);
})();
