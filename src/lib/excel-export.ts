import * as XLSX from 'xlsx';
import type { NotaFiscal } from '@/types';
import { formatarData, formatarMoeda } from './validators';

export function exportarRelatorioExcel(
  notas: NotaFiscal[],
  periodo: { inicio: string; fim: string }
): Buffer {
  const wb = XLSX.utils.book_new();

  // Aba 1: Resumo
  const resumoData = [
    ['RELATÓRIO DE NOTAS FISCAIS'],
    [`Período: ${formatarData(periodo.inicio)} a ${formatarData(periodo.fim)}`],
    [`Total de notas: ${notas.length}`],
    [`Total Bruto: ${formatarMoeda(notas.reduce((s, n) => s + (n.valorBruto || 0), 0))}`],
    [`Total Líquido: ${formatarMoeda(notas.reduce((s, n) => s + (n.valorLiquido || 0), 0))}`],
    [`Total ISS: ${formatarMoeda(notas.reduce((s, n) => s + (n.valorIss || 0), 0))}`],
    [],
    ['STATUS', 'QUANTIDADE'],
    ...Object.entries(
      notas.reduce((acc: Record<string, number>, n) => {
        acc[n.status] = (acc[n.status] || 0) + 1;
        return acc;
      }, {})
    ).map(([k, v]) => [k, v]),
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
  wsResumo['!cols'] = [{ wch: 35 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

  // Aba 2: Notas detalhadas
  const headers = [
    'Nome Organizador',
    'Nº NF',
    'RPS',
    'Tipo',
    'Data Emissão',
    'Data Vencimento',
    'Data Recebimento',
    'Status',
    'Tomador',
    'CNPJ/CPF Tomador',
    'Prestador',
    'CNPJ/CPF Prestador',
    'OF',
    'Descrição',
    'Valor Bruto',
    'Valor Líquido',
    'Alíquota %',
    'Valor ISS',
    'Base Cálculo',
    'IR',
    'PIS/PASEP',
    'COFINS',
    'INSS',
    'CSLL',
    'Outras Retenções',
    'Val. Liq. Antecipação',
    'Município Emissor',
    'Natureza Operação',
    'Observações',
  ];

  const rows = notas.map((n) => [
    n.nomeOrganizador || '',
    n.numeroNf || '',
    n.numeroRps || '',
    n.tipo || '',
    formatarData(n.dataEmissao),
    formatarData(n.dataVencimento),
    formatarData(n.dataRecebimento),
    n.status,
    n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || '',
    n.tomador?.cpfCnpj || '',
    n.prestador?.nomeRazaoSocial || n.prestador?.nomeFantasia || '',
    n.prestador?.cpfCnpj || '',
    n.of || '',
    n.descricao?.slice(0, 100) || '',
    n.valorBruto ?? '',
    n.valorLiquido ?? '',
    n.aliquota ?? '',
    n.valorIss ?? '',
    n.baseCalculo ?? '',
    n.ir ?? '',
    n.pisPasep ?? '',
    n.cofins ?? '',
    n.inss ?? '',
    n.csll ?? '',
    n.outrasRetencoes ?? '',
    n.valorLiquidoAntecipacao ?? '',
    n.municipioEmissor || '',
    n.naturezaOperacao || '',
    n.observacoes || '',
  ]);

  const wsNotas = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsNotas['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));

  // Bold header row
  const range = XLSX.utils.decode_range(wsNotas['!ref'] || 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = wsNotas[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) {
      cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'DBEAFE' } } };
    }
  }

  XLSX.utils.book_append_sheet(wb, wsNotas, 'Notas Fiscais');

  // Aba 3: Dados Fiscais Detalhados
  const headersFiscal = [
    'Nº NF',
    'Código Verificação',
    'Município Emissor',
    'Natureza Operação',
    'Situação Tributária ISSQN',
    'Local Prestação',
    'Situação NFS-e',
    'Regime Tributário',
    'Indicação Retenção',
    'Observações Fiscais',
    'Prestador - Razão Social',
    'Prestador - CNPJ/CPF',
    'Prestador - Insc. Municipal',
    'Tomador - Razão Social',
    'Tomador - CNPJ/CPF',
    'Tomador - Insc. Municipal',
  ];

  const rowsFiscal = notas.map((n) => [
    n.numeroNf || '',
    n.codigoVerificacao || '',
    n.municipioEmissor || '',
    n.naturezaOperacao || '',
    n.situacaoTributariaIssqn || '',
    n.localPrestacao || '',
    n.situacaoNfse || '',
    n.regimeTributario || '',
    n.indicacaoRetencao || '',
    n.observacoesFiscais || '',
    n.prestador?.nomeRazaoSocial || '',
    n.prestador?.cpfCnpj || '',
    n.prestador?.inscricaoMunicipal || '',
    n.tomador?.nomeRazaoSocial || '',
    n.tomador?.cpfCnpj || '',
    n.tomador?.inscricaoMunicipal || '',
  ]);

  const wsFiscal = XLSX.utils.aoa_to_sheet([headersFiscal, ...rowsFiscal]);
  wsFiscal['!cols'] = headersFiscal.map(() => ({ wch: 25 }));
  XLSX.utils.book_append_sheet(wb, wsFiscal, 'Dados Fiscais');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
