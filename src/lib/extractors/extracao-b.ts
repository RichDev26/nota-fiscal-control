/**
 * Fase 9 — Método B: Extração Semântica / Inteligente
 *
 * Estratégia completamente independente do Método A:
 *   - Lê o PDF inteiro como texto plano
 *   - Usa padrões de rótulo + valor (sem detecção de zonas)
 *   - Extrai por posição ordinal quando o campo aparece múltiplas vezes
 *   - Usa inferência controlada e derivação explícita como último recurso
 *
 * NÃO importa nada das fases 2-8. NÃO usa zone detection.
 */

import pdfParse from 'pdf-parse';
import type { NF9CampoResult, NF9Resultado } from './validacao-cruzada';

// ─── UTILITÁRIOS INTERNOS ─────────────────────────────────────────────────────

function campo(
  valor: string | null,
  confianca: number,
  metodo: string,
  origem: NF9CampoResult['origem'],
): NF9CampoResult {
  return { valor, confianca, metodo, origem };
}

function ausente(motivo: string): NF9CampoResult {
  return campo(null, 0, `ausente_b:${motivo}`, 'AUSENTE');
}

/**
 * Tenta múltiplos padrões regex em ordem, retorna o primeiro que encontra.
 * Retorna [valor_capturado, índice_do_padrão, confiança_base].
 */
function tryPatterns(
  text: string,
  patterns: { re: RegExp; conf: number; nome: string }[],
): { valor: string; conf: number; nome: string } | null {
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m?.[1]?.trim()) return { valor: m[1].trim(), conf: p.conf, nome: p.nome };
  }
  return null;
}

/** Extrai TODAS as ocorrências de um padrão no texto */
function allCaptures(text: string, re: RegExp): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = g.exec(text)) !== null) {
    if (m[1]?.trim()) results.push(m[1].trim());
  }
  return results;
}

// ─── PADRÕES GLOBAIS ──────────────────────────────────────────────────────────

const RE_CNPJ_FORMATTED  = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g;
const RE_DATE_BR         = /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/g;
const RE_DATE_BR_SHORT   = /(\d{2}\/\d{2}\/\d{4})/g;
const RE_MONEY_LABELED   = /R\$\s*([\d.]+,\d{2})/g;
const RE_MONEY_BARE      = /([\d]{1,3}(?:\.[\d]{3})*,\d{2})/g;

// ─── EXTRATORES DE CABEÇALHO ──────────────────────────────────────────────────

function extractNumeroNota(segs: string[], fullText: string): NF9CampoResult {
  // Estratégia B: número da nota é um segmento standalone (apenas dígitos, 1-8 chars)
  // antes da primeira ocorrência de "PRESTADOR"
  const prestIdx = segs.findIndex(s => /PRESTADOR\s+DE\s+SERVI[CÇ]OS/i.test(s));
  const headerSegs = segs.slice(0, prestIdx > 0 ? prestIdx : Math.min(40, segs.length));

  for (const seg of headerSegs) {
    if (/^\d{1,8}$/.test(seg.trim())) {
      return campo(seg.trim(), 88, 'standalone_number_header_b', 'EXPLICITO');
    }
  }

  // Fallback: regex após "NFS-e" ou "Número"
  const hit = tryPatterns(fullText, [
    { re: /n[uú]mero\s*(?:d[ae]\s*NFS-?e)?\s*:?\s*(\d{1,8})/i, conf: 75, nome: 'label_numero_b' },
    { re: /NFS-?e\s+n[°º]?\s*(\d{1,8})/i, conf: 72, nome: 'nfse_num_b' },
  ]);
  if (hit) return campo(hit.valor, hit.conf, hit.nome, 'EXPLICITO');

  return ausente('numero_nota');
}

function extractCodigoVerificacao(segs: string[], fullText: string): NF9CampoResult {
  // Código de verificação: segmento com apenas letras maiúsculas + dígitos, 6-15 chars
  // Exclui CNPJs, datas, e outros patterns conhecidos
  const prestIdx = segs.findIndex(s => /PRESTADOR\s+DE\s+SERVI[CÇ]OS/i.test(s));
  const headerSegs = segs.slice(0, prestIdx > 0 ? prestIdx : Math.min(40, segs.length));

  for (const seg of headerSegs) {
    const t = seg.trim();
    if (/^[A-Z0-9]{6,15}$/.test(t) && !/^\d+$/.test(t)) {
      return campo(t, 88, 'alnum_code_header_b', 'EXPLICITO');
    }
  }

  const hit = tryPatterns(fullText, [
    { re: /c[oó]digo\s*(?:de\s*)?verifica[çc][aã]o\s*:?\s*([A-Z0-9]{6,15})/i, conf: 82, nome: 'label_verificacao_b' },
    { re: /verifica[çc][aã]o\s*:?\s*([A-Z0-9]{6,15})/i, conf: 75, nome: 'verif_b' },
  ]);
  if (hit) return campo(hit.valor, hit.conf, hit.nome, 'EXPLICITO');

  return ausente('codigo_verificacao');
}

function extractDataEmissao(fullText: string): NF9CampoResult {
  const hit = tryPatterns(fullText, [
    { re: /data\s+de\s+emiss[aã]o\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i, conf: 92, nome: 'label_emissao_b' },
    { re: /emiss[aã]o\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i, conf: 85, nome: 'emissao_b' },
    { re: /emiss[aã]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i, conf: 78, nome: 'emissao_short_b' },
  ]);
  if (hit) return campo(hit.valor, hit.conf, hit.nome, 'EXPLICITO');

  // Ordinal: primeira data no documento
  const dates = allCaptures(fullText, RE_DATE_BR);
  if (dates[0]) return campo(dates[0], 72, 'first_date_b', 'EXPLICITO');

  return ausente('data_emissao');
}

function extractDataFatoGerador(fullText: string): NF9CampoResult {
  const hit = tryPatterns(fullText, [
    { re: /fato\s+gerador\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i, conf: 92, nome: 'label_fato_gerador_b' },
    { re: /fato\s+gerador\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i, conf: 85, nome: 'fato_short_b' },
  ]);
  if (hit) return campo(hit.valor, hit.conf, hit.nome, 'EXPLICITO');

  // Ordinal: segunda data no documento (emissão é a primeira)
  const dates = allCaptures(fullText, RE_DATE_BR);
  if (dates[1]) return campo(dates[1], 70, 'second_date_b', 'EXPLICITO');
  if (dates[0]) return campo(dates[0], 65, 'fallback_first_date_b', 'INFERIDO');

  return ausente('data_fato_gerador');
}

// ─── EXTRATORES DE ENTIDADE (Prestador / Tomador) ────────────────────────────

interface EntidadeB {
  razao_social:        NF9CampoResult;
  nome_fantasia:       NF9CampoResult;
  cpf_cnpj:            NF9CampoResult;
  inscricao_municipal: NF9CampoResult;
  municipio:           NF9CampoResult;
  uf:                  NF9CampoResult;
  email:               NF9CampoResult;
  telefone:            NF9CampoResult;
  endereco:            NF9CampoResult;
  cep:                 NF9CampoResult;
}

function extractEntidade(
  segs: string[],
  fullText: string,
  tipo: 'PRESTADOR' | 'TOMADOR',
  opts?: { excludeCnpj?: string | null; preferCnpj?: string | null },
): EntidadeB {
  // Limitar janela de busca entre os marcadores de bloco
  const startRe  = tipo === 'PRESTADOR'
    ? /PRESTADOR\s+DE\s+SERVI[CÇ]OS/i
    : /TOMADOR\s+DE\s+SERVI[CÇ]OS/i;
  const endRe    = tipo === 'PRESTADOR'
    ? /TOMADOR\s+DE\s+SERVI[CÇ]OS|DISCRIMINA[CÇ][AÃ]O/i
    : /DISCRIMINA[CÇ][AÃ]O\s+DOS\s+SERVI[CÇ]OS/i;

  const startIdx = segs.findIndex(s => startRe.test(s));
  let   endIdx   = segs.findIndex(s => endRe.test(s));
  if (endIdx <= startIdx) endIdx = segs.length;

  const zone     = startIdx >= 0 ? segs.slice(startIdx + 1, endIdx) : segs;
  const zoneText = zone.join('\n');

  // CNPJ: busca por padrão formatado dentro da janela
  const cnpjsInZone = allCaptures(zoneText, /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  // Se o 1º CNPJ da zona é o da outra entidade (detectado pelo caller), descartar e tentar o 2º
  let cnpj = cnpjsInZone[0] ?? null;
  if (cnpj && opts?.excludeCnpj && cnpj === opts.excludeCnpj) {
    cnpj = cnpjsInZone[1] ?? null;
  }

  // CNPJ global: todos os CNPJs distintos no documento
  const cnpjsGlobal = allCaptures(fullText, /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  const cnpjPrefer  = opts?.preferCnpj ?? null;
  const cnpjGlobal  = cnpjPrefer
    ?? (opts?.excludeCnpj
      ? (cnpjsGlobal.find(c => c !== opts.excludeCnpj) ?? null)
      : (tipo === 'PRESTADOR' ? (cnpjsGlobal[0] ?? null) : (cnpjsGlobal[1] ?? null)));

  const cpf_cnpj_val  = cnpj ?? cnpjGlobal;
  const cpf_cnpj_conf = cnpj ? 93 : cnpjGlobal ? 80 : 0;
  const cpf_cnpj_met  = cnpj ? 'cnpj_in_zone_b' : cnpjGlobal ? 'cnpj_disambig_b' : 'ausente';

  // Razão social: primeiro segmento longo com múltiplas palavras na zona
  let razao_social_val: string | null = null;
  let razao_social_conf = 0;
  for (const seg of zone) {
    const t = seg.trim();
    if (
      t.split(/\s+/).length >= 2 &&
      t.length >= 5 && t.length <= 120 &&
      !/^\d+$/.test(t) &&
      !/^[\d.,\/R$\-%()\s]+$/.test(t) &&
      !/(CNPJ|CPF|CEP|RG|IE|IM)\s*:/i.test(t) &&
      !/^\d{2}\.\d{3}\.\d{3}\//.test(t) &&
      !/^\d{2}\/\d{2}\/\d{4}/.test(t) &&
      !/^(PRESTADOR|TOMADOR|SERVI[CÇ]|DISCRIMINA)/i.test(t)
    ) {
      razao_social_val  = t;
      razao_social_conf = 85;
      break;
    }
  }

  // Nome fantasia: busca explícita por label, senão tenta segmento em MAIÚSCULAS
  let nome_fantasia_val: string | null = null;
  let nome_fantasia_met = 'ausente_b';
  const nfHit = tryPatterns(zoneText, [
    { re: /nome\s+fantasia\s*:?\s*([^\n]+)/i, conf: 88, nome: 'label_nome_fantasia_b' },
  ]);
  if (nfHit) {
    nome_fantasia_val = nfHit.valor;
    nome_fantasia_met = nfHit.nome;
  } else {
    // Busca por segmento todo em maiúsculas que parece razão social abreviada
    for (const seg of zone) {
      const t = seg.trim();
      if (
        t === t.toUpperCase() && t.split(/\s+/).length >= 2 &&
        t.length >= 5 && t.length <= 80 &&
        !/^\d/.test(t) &&
        !/^(PRESTADOR|TOMADOR|CNPJ|CEP|UF)/i.test(t) &&
        t !== razao_social_val?.toUpperCase()
      ) {
        nome_fantasia_val = t;
        nome_fantasia_met = 'uppercase_segment_b';
        break;
      }
    }
  }

  // Inscrição municipal
  const imHit = tryPatterns(zoneText, [
    { re: /inscri[çc][aã]o\s+municipal\s*:?\s*([\d.\-]+)/i, conf: 88, nome: 'label_im_b' },
    { re: /I\.?M\.?\s*:?\s*([\d.\-]+)/i, conf: 78, nome: 'im_abbr_b' },
    { re: /\bIM\s*:?\s*(\d{5,12})\b/i, conf: 72, nome: 'im_short_b' },
  ]);
  // Also try to find a standalone number that looks like IM (8-12 digits)
  let im_val  = imHit?.valor ?? null;
  let im_conf = imHit?.conf ?? 0;
  let im_met  = imHit?.nome ?? 'ausente_b';
  if (!im_val) {
    for (const seg of zone) {
      if (/^\d{6,12}$/.test(seg.trim()) && seg.trim() !== cpf_cnpj_val?.replace(/[^\d]/g, '')) {
        im_val  = seg.trim();
        im_conf = 68;
        im_met  = 'standalone_im_b';
        break;
      }
    }
  }

  // Município
  const munHit = tryPatterns(zoneText, [
    { re: /munic[íi]pio\s*:?\s*([A-Za-záàãéêíóôõúçÁÀÃÉÊÍÓÔÕÚÇ][^\n\d]+)/i, conf: 88, nome: 'label_municipio_b' },
  ]);
  let mun_val = munHit?.valor?.trim() ?? null;
  // Fallback: "Dourados" appears near the address
  if (!mun_val) {
    const cityHit = zoneText.match(/\b(Dourados|Campo Grande|São Paulo|Cuiabá)\b/i);
    if (cityHit) { mun_val = cityHit[1]; }
  }

  // UF
  const ufHit = tryPatterns(zoneText, [
    { re: /\bUF\s*:?\s*([A-Z]{2})\b/i, conf: 88, nome: 'label_uf_b' },
    { re: /\b([A-Z]{2})\s*$|,\s*([A-Z]{2})\b/, conf: 72, nome: 'uf_trailing_b' },
  ]);
  let uf_val = ufHit?.valor?.trim().toUpperCase() ?? null;
  if (!uf_val) {
    const ufMatch = zoneText.match(/\b(MS|SP|RJ|MG|GO|BA|PR|SC|RS)\b/);
    if (ufMatch) uf_val = ufMatch[1];
  }

  // CEP
  const cepHit = tryPatterns(zoneText, [
    { re: /CEP\s*:?\s*(\d{5}-?\d{3})/i, conf: 88, nome: 'label_cep_b' },
    { re: /\b(\d{5}-\d{3})\b/, conf: 80, nome: 'cep_format_b' },
  ]);

  // Endereço: segmento com número ou padrão de rua
  let end_val: string | null = null;
  const endHit = tryPatterns(zoneText, [
    { re: /(?:rua|r\.|av(?:enida)?|rod(?:ovia)?|al(?:ameda)?)\s+([^\n]{5,60})/i, conf: 82, nome: 'label_end_b' },
    { re: /endere[çc]o\s*:?\s*([^\n]{5,60})/i, conf: 85, nome: 'end_label_b' },
  ]);
  end_val = endHit?.valor ?? null;
  if (!end_val) {
    for (const seg of zone) {
      if (/(?:rua|r\.|av\.|avenida|rod\.|alameda)\s+/i.test(seg)) {
        end_val = seg.trim();
        break;
      }
    }
  }

  // Email
  const emailHit = tryPatterns(zoneText, [
    { re: /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i, conf: 92, nome: 'email_pattern_b' },
  ]);

  // Telefone
  const foneHit = tryPatterns(zoneText, [
    { re: /(?:tel(?:efone)?|fone)\s*:?\s*(\(?\d{2}\)?\s*\d[\d\s\-]{7,12})/i, conf: 85, nome: 'label_fone_b' },
    { re: /\((\d{2})\)\s*(\d{4,5}[-\s]\d{4})/i, conf: 80, nome: 'fone_format_b' },
  ]);
  const fone_val = foneHit
    ? (foneHit.nome === 'fone_format_b'
      ? fullText.match(/\((\d{2})\)\s*(\d{4,5}[-\s]\d{4})/)?.slice(0)?.join('') ?? null
      : foneHit.valor)
    : null;

  // Para telefone, reconstruir o match completo
  let telefone_val: string | null = null;
  const foneMatch = zoneText.match(/(\(\d{2}\)\s*\d{4,5}[-\s]?\d{4})/);
  if (foneMatch) telefone_val = foneMatch[1].trim();

  return {
    razao_social:        campo(razao_social_val, razao_social_conf, 'text_segment_zone_b', razao_social_val ? 'EXPLICITO' : 'AUSENTE'),
    nome_fantasia:       campo(nome_fantasia_val, nome_fantasia_val ? 72 : 0, nome_fantasia_met, nome_fantasia_val ? 'EXPLICITO' : 'AUSENTE'),
    cpf_cnpj:            campo(cpf_cnpj_val, cpf_cnpj_conf, cpf_cnpj_met, cpf_cnpj_val ? 'EXPLICITO' : 'AUSENTE'),
    inscricao_municipal: campo(im_val, im_conf, im_met, im_val ? 'EXPLICITO' : 'AUSENTE'),
    municipio:           campo(mun_val, mun_val ? 82 : 0, munHit?.nome ?? 'city_heuristic_b', mun_val ? 'EXPLICITO' : 'AUSENTE'),
    uf:                  campo(uf_val, uf_val ? 85 : 0, ufHit?.nome ?? 'uf_heuristic_b', uf_val ? 'EXPLICITO' : 'AUSENTE'),
    cep:                 campo(cepHit?.valor ?? null, cepHit ? 88 : 0, cepHit?.nome ?? 'ausente_b', cepHit ? 'EXPLICITO' : 'AUSENTE'),
    endereco:            campo(end_val, end_val ? 78 : 0, endHit?.nome ?? 'ausente_b', end_val ? 'EXPLICITO' : 'AUSENTE'),
    email:               campo(emailHit?.valor ?? null, emailHit ? 90 : 0, emailHit?.nome ?? 'ausente_b', emailHit ? 'EXPLICITO' : 'AUSENTE'),
    telefone:            campo(telefone_val, telefone_val ? 82 : 0, 'fone_format_b', telefone_val ? 'EXPLICITO' : 'AUSENTE'),
  };
}

// ─── EXTRATORES DE SERVIÇO ────────────────────────────────────────────────────

interface ServicoB {
  descricao:      NF9CampoResult;
  of:             NF9CampoResult;
  quantidade:     NF9CampoResult;
  valor_unitario: NF9CampoResult;
  valor_servico:  NF9CampoResult;
  codigo_servico: NF9CampoResult;
}

function extractServico(segs: string[], fullText: string): ServicoB {
  const startIdx = segs.findIndex(s => /DISCRIMINA[CÇ][AÃ]O\s+DOS\s+SERVI[CÇ]OS/i.test(s));
  const endIdx   = segs.findIndex(s => /RETEN[CÇ][OÕ]ES\s+FEDERAIS|VALOR\s+ISS/i.test(s));
  const zone     = startIdx >= 0 ? segs.slice(startIdx + 1, endIdx > startIdx ? endIdx : startIdx + 30) : segs;
  const zoneText = zone.join('\n');

  // Descrição: primeiro texto longo da zona (não numérico)
  let desc_val: string | null = null;
  for (const seg of zone) {
    const t = seg.trim();
    if (t.length > 15 && !/^\d/.test(t) && /[a-záàãéê]/i.test(t)) {
      desc_val = t;
      break;
    }
  }

  // OF (Ordem de Fornecimento): número longo standalone
  const ofHit = tryPatterns(zoneText + '\n' + fullText, [
    { re: /\bO\.?F\.?\s*:?\s*(\d{5,10})/i, conf: 88, nome: 'label_of_b' },
    { re: /ordem\s*(?:de\s*)?fornecimento\s*:?\s*(\d+)/i, conf: 85, nome: 'of_label_b' },
  ]);
  // Fallback: primeiro número longo (6-10 dígitos) na zona
  let of_val = ofHit?.valor ?? null;
  let of_conf = ofHit?.conf ?? 0;
  if (!of_val) {
    for (const seg of zone) {
      if (/^\d{6,10}$/.test(seg.trim())) {
        of_val  = seg.trim();
        of_conf = 72;
        break;
      }
    }
  }

  // Código de serviço: padrão NN.NN (LC 116/2003)
  const codHit = tryPatterns(zoneText + '\n' + fullText, [
    { re: /c[oó]digo\s*(?:do\s*)?servi[çc]o\s*:?\s*(\d{2}\.\d{2})/i, conf: 88, nome: 'label_cod_b' },
    { re: /\b(\d{2}\.\d{2})\b/, conf: 82, nome: 'cod_format_b' },
  ]);

  // Quantidade
  const qtdHit = tryPatterns(zoneText, [
    { re: /quantidade\s*:?\s*(\d+(?:[.,]\d+)?)/i, conf: 85, nome: 'label_qtd_b' },
    { re: /^(\d+[.,]\d{4})$/m, conf: 72, nome: 'qtd_format_b' },
  ]);

  // Valores monetários na zona
  const moneys = allCaptures(zoneText, /(\d{1,3}(?:\.\d{3})*,\d{2,4})/);

  // Valor unitário e valor serviço: buscar por label ou maiores valores na zona
  const valUnitHit = tryPatterns(zoneText, [
    { re: /valor\s*unit[aá]rio\s*:?\s*R?\$?\s*([\d.]+,\d{2,4})/i, conf: 85, nome: 'label_vunit_b' },
  ]);
  const valServHit = tryPatterns(zoneText + '\n' + fullText, [
    { re: /valor\s*(?:do\s*)?servi[çc]o\s*:?\s*R?\$?\s*([\d.]+,\d{2,4})/i, conf: 88, nome: 'label_vserv_b' },
    { re: /valor\s*bruto\s*[=:]\s*R\$\s*([\d.]+,\d{2})/i, conf: 75, nome: 'bruto_as_servico_b' },
  ]);

  // Se não encontrado pelo label, usar maior valor na zona de serviços
  let val_unit = valUnitHit?.valor ?? null;
  let val_serv = valServHit?.valor ?? null;
  if (!val_unit && !val_serv && moneys.length > 0) {
    // Ordenar por valor monetário
    const sorted = moneys
      .map(m => ({ raw: m, num: parseFloat(m.replace(/\./g, '').replace(',', '.')) }))
      .sort((a, b) => b.num - a.num);
    val_unit = sorted[0]?.raw ?? null;
    val_serv = sorted[0]?.raw ?? null;
  }

  return {
    descricao:      campo(desc_val, desc_val ? 82 : 0, 'first_text_zone_b', desc_val ? 'EXPLICITO' : 'AUSENTE'),
    of:             campo(of_val, of_conf, ofHit?.nome ?? 'long_number_b', of_val ? 'EXPLICITO' : 'AUSENTE'),
    quantidade:     campo(qtdHit?.valor ?? null, qtdHit ? 82 : 0, qtdHit?.nome ?? 'ausente_b', qtdHit ? 'EXPLICITO' : 'AUSENTE'),
    valor_unitario: campo(val_unit, val_unit ? 75 : 0, valUnitHit?.nome ?? 'heuristic_b', val_unit ? 'EXPLICITO' : 'INFERIDO'),
    valor_servico:  campo(val_serv, val_serv ? (valServHit?.conf ?? 70) : 0, valServHit?.nome ?? 'heuristic_b', val_serv ? 'EXPLICITO' : 'INFERIDO'),
    codigo_servico: campo(codHit?.valor ?? null, codHit ? 88 : 0, codHit?.nome ?? 'ausente_b', codHit ? 'EXPLICITO' : 'AUSENTE'),
  };
}

// ─── EXTRATORES FINANCEIROS ───────────────────────────────────────────────────

interface FinanceiroB {
  valor_bruto:               NF9CampoResult;
  valor_liquido:             NF9CampoResult;
  base_calculo:              NF9CampoResult;
  aliquota_iss:              NF9CampoResult;
  valor_iss:                 NF9CampoResult;
  ir:                        NF9CampoResult;
  pis_pasep:                 NF9CampoResult;
  cofins:                    NF9CampoResult;
  inss:                      NF9CampoResult;
  csll:                      NF9CampoResult;
  outras_retencoes:          NF9CampoResult;
  valor_aproximado_tributos: NF9CampoResult;
  valor_servico_fin:         NF9CampoResult;
}

function extractFinanceiro(fullText: string, segs: string[]): FinanceiroB {
  // Valor bruto e líquido: aparecem como labels explícitos em RETENÇÕES FEDERAIS
  const bruHit = tryPatterns(fullText, [
    { re: /valor\s*bruto\s*[=:]\s*R\$\s*([\d.]+,\d{2})/i, conf: 95, nome: 'label_bruto_b' },
    { re: /bruto\s*:?\s*R\$\s*([\d.]+,\d{2})/i, conf: 88, nome: 'bruto_b' },
  ]);

  const liqHit = tryPatterns(fullText, [
    { re: /valor\s*l[íi]quido\s*[=:]\s*R\$\s*([\d.]+,\d{2})/i, conf: 95, nome: 'label_liquido_b' },
    { re: /l[íi]quido\s*:?\s*R\$\s*([\d.]+,\d{2})/i, conf: 88, nome: 'liquido_b' },
  ]);

  // Isolar zona da tabela ISSQN para evitar confusão com tributos aproximados
  const issZoneStart = Math.max(
    fullText.search(/DADOS\s+DO\s+ISS|tabela\s+ISS|ISSQN\b/i),
    fullText.search(/base\s+de\s+c[aá]lculo[\s\S]{0,200}?al[íi]quota/i),
  );
  const issZone = issZoneStart > 0
    ? fullText.slice(issZoneStart, issZoneStart + 600)
    : fullText;

  // Base de cálculo: label dentro da zona ISS (mais preciso)
  const baseHit = tryPatterns(issZone + '\n' + fullText, [
    { re: /base\s*de\s*c[aá]lculo\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i, conf: 88, nome: 'label_base_b' },
    { re: /base\s+c[aá]lculo\s*:?\s*([\d.]+,\d{2})/i, conf: 82, nome: 'base_b' },
  ]);

  // Alíquota ISS: buscar APENAS na zona ISSQN para não pegar tributos aproximados (ex: 13,45%)
  const aliqHit = tryPatterns(issZone, [
    { re: /al[íi]quota\s*(?:ISS|ISSQN)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/i, conf: 88, nome: 'label_aliq_pct_b' },
    { re: /ISS\s*\((\d+(?:[.,]\d+)?)\s*%\)/i,                            conf: 85, nome: 'iss_pct_b'         },
  ]);
  // Fallback alíquota: percentual ISS típico (2-10%) no documento — exclui tributos aproximados
  let aliq_val  = aliqHit?.valor ?? null;
  let aliq_conf = aliqHit?.conf ?? 0;
  if (!aliq_val) {
    const aliqFb = fullText.match(/\b([2-9](?:[,.]0{1,2})?)\s*%/);
    if (aliqFb) { aliq_val = aliqFb[1]; aliq_conf = 62; }
  }

  // Valor ISS: buscar na zona ISSQN com label explícito
  const issHit = tryPatterns(issZone, [
    { re: /valor\s*(?:do\s*)?ISS(?:QN)?\s*[=:\s(R$]*([\d.]+,\d{2})/i, conf: 88, nome: 'label_iss_b'  },
    { re: /ISS\s*calculado\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,             conf: 85, nome: 'iss_calc_b'   },
  ]);
  let iss_val  = issHit?.valor ?? null;
  let iss_conf = issHit?.conf ?? 0;
  let iss_orig: NF9CampoResult['origem'] = issHit ? 'EXPLICITO' : 'AUSENTE';

  // Fallback ISS: derivar matematicamente de base × alíquota (mais confiável que busca heurística)
  if (!iss_val && baseHit?.valor && aliq_val) {
    const base = parseFloat(baseHit.valor.replace(/\./g, '').replace(',', '.'));
    const aliq = parseFloat(aliq_val.replace(',', '.'));
    if (!isNaN(base) && !isNaN(aliq)) {
      const issCalc  = base * aliq / 100;
      const [int, dec] = issCalc.toFixed(2).split('.');
      iss_val  = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
      iss_conf = 78;
      iss_orig = 'DERIVADO';
    }
  }

  // Base de cálculo fallback: se valor_bruto foi achado, usar como base
  let base_val  = baseHit?.valor ?? null;
  let base_conf = baseHit?.conf ?? 0;
  let base_orig: NF9CampoResult['origem'] = 'EXPLICITO';
  if (!base_val && bruHit?.valor) {
    base_val  = bruHit.valor;
    base_conf = 72;
    base_orig = 'DERIVADO';
  }

  // Retenções: buscar por labels
  const irHit     = tryPatterns(fullText, [{ re: /imposto\s+de\s+renda|IR\s*[\n:]\s*R?\$?\s*([\d.,]+)/i, conf: 78, nome: 'ir_b' },
                                             { re: /\bIR\b.*?R\$\s*([\d.,]+)/i, conf: 72, nome: 'ir_near_b' }]);
  const pisHit    = tryPatterns(fullText, [{ re: /PIS\/PASEP\s*:?\s*R?\$?\s*([\d.,]+)/i, conf: 78, nome: 'pis_b' }]);
  const cofinsHit = tryPatterns(fullText, [{ re: /COFINS\s*:?\s*R?\$?\s*([\d.,]+)/i, conf: 78, nome: 'cofins_b' }]);
  const inssHit   = tryPatterns(fullText, [{ re: /INSS\s*:?\s*R?\$?\s*([\d.,]+)/i, conf: 78, nome: 'inss_b' }]);
  const csllHit   = tryPatterns(fullText, [{ re: /CSLL\s*:?\s*R?\$?\s*([\d.,]+)/i, conf: 78, nome: 'csll_b' }]);

  // Para retenções com zero, buscar padrão "R$ 0,00" na zona de retenções
  const retZoneIdx = fullText.indexOf('RETENÇÕES FEDERAIS');
  const retZone    = retZoneIdx >= 0 ? fullText.slice(retZoneIdx, retZoneIdx + 600) : '';
  const r0 = retZone.match(/R\$\s*(0,00)/);
  const retencaoZero = r0 ? r0[1] : null;

  // Tributos aproximados
  const tribHit = tryPatterns(fullText, [
    { re: /tributo\s+federal\s*-\s*R\$\s*([\d.]+,\d{2})/i, conf: 82, nome: 'trib_fed_b' },
    { re: /valor\s+aproximado\s+do\s+tributo[\s\S]{0,300}?R\$\s*([\d.]+,\d{2})/i, conf: 85, nome: 'label_trib_b' },
  ]);

  // Calcular total tributos se necessário
  let trib_val = tribHit?.valor ?? null;
  if (!trib_val) {
    const fedMatch  = fullText.match(/federal\s*-\s*R\$\s*([\d.]+,\d{2})/i);
    const munMatch  = fullText.match(/municipal\s*-\s*R\$\s*([\d.]+,\d{2})/i);
    const estMatch  = fullText.match(/estadual\s*-\s*R\$\s*([\d.]+,\d{2})/i);
    if (fedMatch && munMatch && estMatch) {
      const toNum = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
      const total  = toNum(fedMatch[1]) + toNum(munMatch[1]) + toNum(estMatch[1]);
      const [int, dec] = total.toFixed(2).split('.');
      trib_val = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
    }
  }

  // valor_servico_fin: derivado de valor_bruto (não há label próprio no bloco financeiro)
  const vServFin = bruHit?.valor ?? null;

  return {
    valor_bruto:       campo(bruHit?.valor ?? null, bruHit?.conf ?? 0, bruHit?.nome ?? 'ausente_b', bruHit ? 'EXPLICITO' : 'AUSENTE'),
    valor_liquido:     campo(liqHit?.valor ?? null, liqHit?.conf ?? 0, liqHit?.nome ?? 'ausente_b', liqHit ? 'EXPLICITO' : 'AUSENTE'),
    base_calculo:      campo(base_val, base_conf, baseHit?.nome ?? 'derivado_de_bruto_b', base_orig),
    aliquota_iss:      campo(aliq_val, aliq_conf, aliqHit?.nome ?? 'heuristic_aliq_b', aliq_val ? 'EXPLICITO' : 'AUSENTE'),
    valor_iss:         campo(iss_val, iss_conf, issHit?.nome ?? 'heuristic_iss_b', iss_orig),
    ir:                campo(irHit?.valor ?? retencaoZero, irHit ? irHit.conf : 65, irHit?.nome ?? 'retencao_zero_b', 'EXPLICITO'),
    pis_pasep:         campo(pisHit?.valor ?? retencaoZero, pisHit ? pisHit.conf : 65, pisHit?.nome ?? 'retencao_zero_b', 'EXPLICITO'),
    cofins:            campo(cofinsHit?.valor ?? retencaoZero, cofinsHit ? cofinsHit.conf : 65, cofinsHit?.nome ?? 'retencao_zero_b', 'EXPLICITO'),
    inss:              campo(inssHit?.valor ?? retencaoZero, inssHit ? inssHit.conf : 65, inssHit?.nome ?? 'retencao_zero_b', 'EXPLICITO'),
    csll:              campo(csllHit?.valor ?? retencaoZero, csllHit ? csllHit.conf : 65, csllHit?.nome ?? 'retencao_zero_b', 'EXPLICITO'),
    outras_retencoes:  campo(retencaoZero, retencaoZero ? 60 : 0, 'ret_zero_b', retencaoZero ? 'EXPLICITO' : 'AUSENTE'),
    valor_aproximado_tributos: campo(trib_val, trib_val ? 82 : 0, tribHit?.nome ?? 'calculated_trib_b', trib_val ? (tribHit ? 'EXPLICITO' : 'DERIVADO') : 'AUSENTE'),
    valor_servico_fin: campo(vServFin, vServFin ? 70 : 0, 'derivado_valor_bruto_b', vServFin ? 'DERIVADO' : 'AUSENTE'),
  };
}

// ─── EXTRATORES FISCAIS ───────────────────────────────────────────────────────

interface FiscalB {
  natureza_operacao: NF9CampoResult;
  situacao_issqn:    NF9CampoResult;
  local_prestacao:   NF9CampoResult;
  situacao_nfse:     NF9CampoResult;
  iss_retido:        NF9CampoResult;
  regime_tributario: NF9CampoResult;
}

function extractFiscal(fullText: string): FiscalB {
  const nat = tryPatterns(fullText, [
    { re: /natureza\s+da\s+opera[çc][aã]o\s*:?\s*([^\n]{3,60})/i, conf: 90, nome: 'label_natureza_b' },
  ]);
  const sit = tryPatterns(fullText, [
    { re: /situa[çc][aã]o\s+tribut[aá]ria\s+do\s+ISSQN\s*:?\s*([^\n]{3,40})/i, conf: 90, nome: 'label_sit_issqn_b' },
    { re: /ISSQN\s*:?\s*([^\n]{3,40})/i, conf: 78, nome: 'issqn_b' },
  ]);
  const loc = tryPatterns(fullText, [
    { re: /local\s+da\s+presta[çc][aã]o\s+do\s+servi[çc]o\s*:?\s*([^\n]{2,40})/i, conf: 90, nome: 'label_local_b' },
    { re: /local\s+presta[çc][aã]o\s*:?\s*([^\n]{2,40})/i, conf: 82, nome: 'local_b' },
  ]);
  const sitNfse = tryPatterns(fullText, [
    { re: /situa[çc][aã]o\s+desta\s+NFS-?e\s*:?\s*([^\n]{3,40})/i, conf: 90, nome: 'label_sit_nfse_b' },
    { re: /situa[çc][aã]o\s+NFS-?e\s*:?\s*([^\n]{3,40})/i, conf: 82, nome: 'sit_nfse_b' },
  ]);

  // ISS retido: derivado da situação ISSQN
  const sitVal   = sit?.valor ?? '';
  const issRetido = /reten[çc][aã]o|retido|retida/i.test(sitVal + (sitNfse?.valor ?? ''));

  // Regime tributário: buscar indicador Simples Nacional
  const isSimples = /simples\s+nacional|optante\s+pelo\s+simples/i.test(fullText);
  const regHit    = tryPatterns(fullText, [
    { re: /simples\s+nacional/i, conf: 88, nome: 'simples_nacional_b' },
    { re: /lucro\s+(?:presumido|real)/i, conf: 85, nome: 'lucro_b' },
    { re: /MEI\b/i, conf: 85, nome: 'mei_b' },
  ]);

  let regime_val: string | null = null;
  if (isSimples) regime_val = 'SIMPLES_NACIONAL';
  else {
    const lm = fullText.match(/lucro\s+(presumido|real)/i);
    if (lm) regime_val = `LUCRO_${lm[1].toUpperCase()}`;
    else if (/\bMEI\b/i.test(fullText)) regime_val = 'MEI';
  }

  return {
    natureza_operacao: campo(nat?.valor?.trim() ?? null, nat?.conf ?? 0, nat?.nome ?? 'ausente_b', nat ? 'EXPLICITO' : 'AUSENTE'),
    situacao_issqn:    campo(sit?.valor?.trim() ?? null, sit?.conf ?? 0, sit?.nome ?? 'ausente_b', sit ? 'EXPLICITO' : 'AUSENTE'),
    local_prestacao:   campo(loc?.valor?.trim() ?? null, loc?.conf ?? 0, loc?.nome ?? 'ausente_b', loc ? 'EXPLICITO' : 'AUSENTE'),
    situacao_nfse:     campo(sitNfse?.valor?.trim() ?? null, sitNfse?.conf ?? 0, sitNfse?.nome ?? 'ausente_b', sitNfse ? 'EXPLICITO' : 'AUSENTE'),
    iss_retido:        campo(String(issRetido), issRetido ? 88 : 50, 'derivado_sit_issqn_b', 'DERIVADO'),
    regime_tributario: campo(regime_val, regime_val ? 85 : 0, regHit?.nome ?? 'ausente_b', regime_val ? 'EXPLICITO' : 'AUSENTE'),
  };
}

// ─── PONTO DE ENTRADA ─────────────────────────────────────────────────────────

/**
 * Extrai todos os campos da NFS-e usando MÉTODO B (semântico / pattern-based).
 * Independente do Método A: não usa zonas, não usa fases 2-8.
 */
export async function extractMetodoB(pdfBuffer: Buffer): Promise<NF9Resultado> {
  const t0   = Date.now();
  const data = await pdfParse(pdfBuffer);
  const segs = data.text.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  const full = segs.join('\n');

  // Pré-detect CNPJs globais para desambiguação entre prestador e tomador.
  // O JasperReports pode inverter a ordem das colunas no fluxo de texto, colocando
  // o CNPJ do tomador na zona do prestador. Identificamos o CNPJ do tomador
  // pela zona TOMADOR e usamos como hint de exclusão na zona PRESTADOR.
  const _allCnpjs = allCaptures(full, /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  const _tomStartIdx = segs.findIndex(s => /TOMADOR\s+DE\s+SERVI[CÇ]OS/i.test(s));
  const _tomEndIdx   = segs.findIndex((s, i) => i > _tomStartIdx && /DISCRIMINA[CÇ][AÃ]O/i.test(s));
  const _tomZoneText = _tomStartIdx >= 0
    ? segs.slice(_tomStartIdx + 1, _tomEndIdx > _tomStartIdx ? _tomEndIdx : segs.length).join('\n')
    : '';
  const _cnpjsInTomZone = allCaptures(_tomZoneText, /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  // CNPJ do tomador: primeiro da zona do tomador, senão segundo do documento
  const _tomCnpj    = _cnpjsInTomZone[0] ?? _allCnpjs[1] ?? null;
  // CNPJ do prestador: o que NÃO é o do tomador
  const _prestCnpj  = _allCnpjs.find(c => c !== _tomCnpj) ?? _allCnpjs[0] ?? null;

  const prest = extractEntidade(segs, full, 'PRESTADOR', { excludeCnpj: _tomCnpj,   preferCnpj: _prestCnpj });
  const tom   = extractEntidade(segs, full, 'TOMADOR',   { excludeCnpj: _prestCnpj, preferCnpj: _tomCnpj  });
  const serv  = extractServico(segs, full);
  const fin   = extractFinanceiro(full, segs);
  const fisc  = extractFiscal(full);

  return {
    cabecalho: {
      numero_nota:        extractNumeroNota(segs, full),
      codigo_verificacao: extractCodigoVerificacao(segs, full),
      data_emissao:       extractDataEmissao(full),
      data_fato_gerador:  extractDataFatoGerador(full),
    },
    prestador: prest,
    tomador:   tom,
    servico:   serv,
    financeiro: fin,
    fiscal:     fisc,
    extractionMs: Date.now() - t0,
  };
}
