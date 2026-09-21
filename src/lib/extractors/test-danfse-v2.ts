// Execução: npx tsx src/lib/extractors/test-danfse-v2.ts
//
// Cobre o layout DANFSe v2.0 em três frentes:
//   1. o detector escolhe v2.0 sem roubar documentos dos outros layouts;
//   2. o parser lê cada campo pelo seu próprio rótulo;
//   3. os casos NEGATIVOS — campo "-" fica ausente e nada vaza entre as zonas
//      Prestador e Tomador. Essa terceira parte é a que realmente protege:
//      um parser que copia o e-mail do prestador para o tomador passaria em
//      qualquer teste que só verificasse campos preenchidos.
import { extrairDanfseV2 } from './extrator-danfse-v2';
import { detectarLayoutNfseDetalhado } from './detector-documento';
import { TEXTO_DANFSE_V2 } from './fixture-danfse-v2';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => {
  console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) falhas++;
};

// ── 1. Detector ───────────────────────────────────────────────────────────────
const det = detectarLayoutNfseDetalhado(TEXTO_DANFSE_V2);
check('detecta DANFSE_V2', det.layout === 'DANFSE_V2', `score v2=${det.scoreV2} v1=${det.scoreV1}`);
check('v2 vence o v1 com folga', det.scoreV2 > det.scoreV1, `${det.scoreV2} > ${det.scoreV1}`);
check('decisão apoiada em várias evidências', det.evidenciasV2.length >= 5,
  `${det.evidenciasV2.length} evidências`);

// Um texto que só diz "NFS-e" não pode acionar o parser v2.0.
const soNfse = detectarLayoutNfseDetalhado('NFS-e\nISSQN\nPrestador de Serviços\nnota fiscal de servico');
check('texto genérico de NFS-e NÃO vira v2.0', soNfse.layout !== 'DANFSE_V2', `virou ${soNfse.layout}`);

// Um DANFSe v1.0 sintético (rótulos do v1, sem IBS/CBS) continua indo pro v1.
const v1Sintetico = [
  'DANFSe v1.0', 'Documento Auxiliar da NFS-e', 'CHAVE DE ACESSO DA NFS-e',
  'COMPETÊNCIA DA NFS-e', 'NÚMERO DA DPS', 'SÉRIE DA DPS',
  'EMITENTE DA NFS-e', 'TOMADOR DO SERVIÇO', 'Código de Tributação Nacional',
].join('\n');
check('DANFSe v1.0 continua roteado para o v1', detectarLayoutNfseDetalhado(v1Sintetico).layout === 'DANFSE_NACIONAL');

// ── 2. Extração por rótulo ────────────────────────────────────────────────────
const r = extrairDanfseV2(TEXTO_DANFSE_V2);

const esperado: Array<[string, unknown]> = [
  ['layoutNfse',                'DANFSE_V2'],
  ['numeroNf',                  '6'],
  ['competenciaNfse',           '14/09/2026'],
  ['dataEmissao',               '14/09/2026 17:17:25'],
  ['dataEmissaoDps',            '14/09/2026 17:17:25'],
  ['numeroDps',                 '6'],
  ['serieDps',                  '70000'],
  ['situacaoNfse',              'NFS-e Gerada'],
  ['chaveAcessoNfse',           '50037022249521060000149000000000000626094970043610'],
  ['prestador.cpfCnpj',         '49.521.060/0001-49'],
  ['prestador.nomeRazaoSocial', 'JM INOX MANUTENCAO INDUSTRIAL LTDA'],
  ['prestador.email',           'JMINOXMANUTENCAOINDUSTRIAL@GMAIL.COM'],
  ['prestador.telefone',        '(67) 9237-6776'],
  ['prestador.cep',             '79841-090'],
  ['prestador.uf',              'MS'],
  ['tomador.cpfCnpj',           '02.914.460/0061-91'],
  ['tomador.nomeRazaoSocial',   'SEARA ALIMENTOS LTDA'],
  ['tomador.cep',               '79804-970'],
  ['codigoTributacaoNacional',  '14.01.01'],
  ['nbs',                       '1.2003.29.00'],
  ['baseCalculo',               55000],
  ['aliquota',                  5],
  ['valorIss',                  2750],
  ['valorBruto',                55000],
  ['valorLiquido',              52250],
  ['totalRetencoes',            2750],
  ['descricao',                 'serviços prestados referente a ampliação de processo do bacon OF:7264530'],
  ['simplesNacional',           true],
];

const get = (o: unknown, p: string) =>
  p.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o);

for (const [campo, esp] of esperado) {
  const got = get(r, campo);
  check(`${campo} = ${JSON.stringify(esp)}`, got === esp, got === esp ? '' : `obtido ${JSON.stringify(got)}`);
}

// ── 3. Casos negativos — o que NÃO pode acontecer ─────────────────────────────

// No PDF modelo o e-mail do tomador é "-". Precisa sumir, e jamais virar o do
// prestador: é exatamente o vazamento entre zonas que o parser tem de impedir.
check('tomador.email AUSENTE (não herdou o do prestador)',
  r.tomador?.email == null,
  `obtido ${JSON.stringify(r.tomador?.email)}`);
check('tomador.email ≠ prestador.email',
  r.tomador?.email !== r.prestador?.email || r.tomador?.email == null);

// Telefone e inscrição do tomador também são "-" no modelo.
check('tomador.telefone ausente',           r.tomador?.telefone == null);
check('tomador.inscricaoMunicipal ausente', r.tomador?.inscricaoMunicipal == null);
check('prestador.inscricaoMunicipal ausente (é "-" no documento)',
  r.prestador?.inscricaoMunicipal == null);

// Endereços são distintos — nenhum foi copiado do outro bloco.
check('endereços de prestador e tomador são distintos',
  r.prestador?.endereco !== r.tomador?.endereco &&
  r.prestador?.endereco != null && r.tomador?.endereco != null);

// "Código de Tributação Nacional/Municipal" = "14.01.01 / -": a parte municipal
// é ausente e não pode repetir a nacional.
check('codigoTributacaoMunicipal ausente (não copiou o nacional)',
  r.codigoTributacaoMunicipal == null,
  `obtido ${JSON.stringify(r.codigoTributacaoMunicipal)}`);

// País da prestação é "-" no modelo.
check('paisPrestacao ausente', r.paisPrestacao == null);

// Bloco federal inteiro é "-" — nenhum campo pode ter virado 0 ou herdado valor.
for (const campo of ['ir', 'inss', 'pisPasep', 'cofins'] as const) {
  check(`${campo} ausente (bloco federal todo "-")`, r[campo] == null, `obtido ${JSON.stringify(r[campo])}`);
}

// CSLL nunca é preenchida a partir de "Contribuições Sociais - Retidas", que é
// o agregado PIS/COFINS/CSLL e tem campo próprio.
check('csll não foi preenchida pelo agregado de contribuições', r.csll == null);

// IBS/CBS: no modelo só "Exclusões e Reduções" tem valor; o resto é "-".
check('ibsCbs.exclusoesReducoesBc = 2750', r.ibsCbs?.exclusoesReducoesBc === 2750);
check('ibsCbs.cst ausente',                r.ibsCbs?.cst == null);
check('ibsCbs.valorTotalApuradoIbs ausente', r.ibsCbs?.valorTotalApuradoIbs == null);

// Coerência aritmética do documento (bruto - retenções = líquido).
check('valorBruto - totalRetencoes = valorLiquido',
  Math.abs((r.valorBruto ?? 0) - (r.totalRetencoes ?? 0) - (r.valorLiquido ?? 0)) < 0.01);

// A data de emissão precisa ser a do rótulo próprio, no formato brasileiro —
// nunca "a primeira data encontrada" nem um Date.parse() americano.
check('dataEmissao mantém DD/MM/AAAA', /^\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}$/.test(r.dataEmissao ?? ''));
check('competência ≠ emissão (rótulos distintos)', r.competenciaNfse !== r.dataEmissao);

console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
