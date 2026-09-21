/**
 * Harness de regressão do Leitor Universal de Documentos.
 *
 *   npx tsx scripts/regressao-extrator.ts <pasta-com-pdfs> <arquivo-saida.json>
 *   npx tsx scripts/regressao-extrator.ts --diff antes.json depois.json
 *
 * Roda o roteador real (extractDocumentFromPdfBuffer) sobre um corpus de PDFs e
 * grava o resultado normalizado. Existe para provar que adicionar um layout novo
 * não altera nenhum documento que já era suportado: gera-se o baseline ANTES da
 * mudança, repete-se DEPOIS e comparam-se os dois campo a campo.
 *
 * Só compara o que o extrator produz — nada de rede, banco ou sessão.
 */
import fs from 'node:fs';
import path from 'node:path';

interface Registro {
  arquivo: string;
  erro?: string;
  roteamento?: unknown;
  resultado?: Record<string, unknown>;
}

/** Ordena chaves recursivamente para o JSON ser comparável linha a linha. */
function estabilizar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estabilizar);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, estabilizar(o[k])]));
  }
  return v;
}

async function gerar(pasta: string, saida: string) {
  const { extractDocumentFromPdfBuffer } = await import('../src/lib/extractors/extrator-router');

  const pdfs = fs.readdirSync(pasta).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  if (!pdfs.length) { console.error(`Nenhum PDF em ${pasta}`); process.exit(2); }

  const registros: Registro[] = [];
  for (const nome of pdfs) {
    process.stdout.write(`  ${nome.padEnd(50)} `);
    try {
      const buf = fs.readFileSync(path.join(pasta, nome));
      const r = await extractDocumentFromPdfBuffer(buf) as Record<string, unknown>;
      const { _roteamento, ...resto } = r;
      registros.push({
        arquivo: nome,
        roteamento: estabilizar(_roteamento),
        resultado: estabilizar(resto) as Record<string, unknown>,
      });
      const rot = _roteamento as { tipo?: string } | undefined;
      console.log(`ok  [${rot?.tipo ?? '?'}]`);
    } catch (err) {
      registros.push({ arquivo: nome, erro: (err as Error).message });
      console.log(`ERRO: ${(err as Error).message.slice(0, 60)}`);
    }
  }

  fs.writeFileSync(saida, JSON.stringify(registros, null, 2), 'utf8');
  console.log(`\n${registros.length} documento(s) -> ${saida}`);
}

/** Achata um objeto em pares "caminho = valor" para diff legível. */
function achatar(v: unknown, prefixo = '', destino: Record<string, string> = {}) {
  if (v === null || v === undefined) { destino[prefixo] = String(v); return destino; }
  if (typeof v !== 'object') { destino[prefixo] = String(v); return destino; }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    achatar(val, prefixo ? `${prefixo}.${k}` : k, destino);
  }
  return destino;
}

/**
 * Campos que mudam a cada execução sem o resultado mudar (tempo de parse,
 * carimbos de data). Compará-los daria falso positivo de regressão em toda
 * rodada e esconderia as diferenças que importam.
 */
const VOLATEIS = /(^|\.)(_meta\.extractionMs|extractionMs|timestamp|gerado_em|processado_em|duracaoMs)$/;

function diff(antesPath: string, depoisPath: string, esperados: string[] = []) {
  const antes: Registro[]  = JSON.parse(fs.readFileSync(antesPath, 'utf8'));
  const depois: Registro[] = JSON.parse(fs.readFileSync(depoisPath, 'utf8'));

  const porArquivo = (rs: Registro[]) => new Map(rs.map(r => [r.arquivo, r]));
  const a = porArquivo(antes), d = porArquivo(depois);
  const todos = Array.from(new Set(Array.from(a.keys()).concat(Array.from(d.keys())))).sort();

  let comMudanca = 0, novos = 0, esperadas = 0;
  for (const arq of todos) {
    const ra = a.get(arq), rd = d.get(arq);
    if (!ra) { console.log(`\n🆕 ${arq} — documento novo no corpus (não havia baseline)`); novos++; continue; }
    if (!rd) { console.log(`\n❌ ${arq} — SUMIU do corpus depois`); comMudanca++; continue; }

    const fa = achatar({ roteamento: ra.roteamento, resultado: ra.resultado, erro: ra.erro });
    const fd = achatar({ roteamento: rd.roteamento, resultado: rd.resultado, erro: rd.erro });
    const chaves = Array.from(new Set(Object.keys(fa).concat(Object.keys(fd)))).sort();
    const mudancas = chaves.filter(k => !VOLATEIS.test(k) && fa[k] !== fd[k]);

    if (!mudancas.length) { console.log(`✅ ${arq} — idêntico`); continue; }

    // Documento cujo suporte É o objetivo da mudança: aqui mudar é o resultado
    // desejado, não regressão. Segue listado para o diff continuar auditável.
    if (esperados.includes(arq)) {
      esperadas++;
      console.log(`\n🎯 ${arq} — ${mudancas.length} campo(s) mudaram (ESPERADO: layout recém-suportado)`);
      continue;
    }

    comMudanca++;
    console.log(`\n⚠️  ${arq} — ${mudancas.length} campo(s) mudaram:`);
    for (const k of mudancas.slice(0, 25)) {
      console.log(`    ${k}`);
      console.log(`      antes : ${(fa[k] ?? '(ausente)').slice(0, 90)}`);
      console.log(`      depois: ${(fd[k] ?? '(ausente)').slice(0, 90)}`);
    }
    if (mudancas.length > 25) console.log(`    ... e mais ${mudancas.length - 25}`);
  }

  console.log('\n── RESUMO ──');
  console.log(`  documentos comparados   : ${todos.length - novos}`);
  console.log(`  mudança esperada (novo) : ${esperadas}`);
  console.log(`  alteração NÃO esperada  : ${comMudanca}`);
  console.log(`  novos no corpus         : ${novos}`);
  if (comMudanca > 0) {
    console.log('\n❌ REGRESSÃO: documento já suportado mudou de resultado.');
    process.exit(1);
  }
  console.log('\n✅ Sem regressão: todo documento já suportado produziu resultado idêntico.');
}

const [arg1, arg2, arg3] = process.argv.slice(2);
if (arg1 === '--diff') {
  if (!arg2 || !arg3) { console.error('Uso: --diff antes.json depois.json [--esperado "arq.pdf" ...]'); process.exit(2); }
  const esperados = process.argv.slice(5).filter(a => a !== '--esperado');
  diff(arg2, arg3, esperados);
} else {
  if (!arg1 || !arg2) { console.error('Uso: <pasta-com-pdfs> <saida.json>  |  --diff antes.json depois.json'); process.exit(2); }
  gerar(arg1, arg2);
}
