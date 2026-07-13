export type StatusNota =
  | 'rascunho'
  | 'lancada'
  | 'recebida'
  | 'antecipada'
  | 'incompleta'
  | 'invalida'
  | 'substitutiva'
  | 'substituida'
  | 'cancelada';

export type StatusImposto = 'pendente' | 'pago' | 'vencido' | 'cancelado';

export interface PessoaFiscal {
  id: string;
  nomeRazaoSocial?: string | null;
  nomeFantasia?: string | null;
  cpfCnpj?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cep?: string | null;
  municipio?: string | null;
  uf?: string | null;
  email?: string | null;
  telefone?: string | null;
  celular?: string | null;
  inscricaoMunicipal?: string | null;
  inscricaoEstadual?: string | null;
  site?: string | null;
}

export interface NotaFiscal {
  id: string;
  nomeOrganizador?: string | null;
  tipo?: string | null;
  numeroNf?: string | null;
  numeroRps?: string | null;
  codigoVerificacao?: string | null;
  of?: string | null;
  descricao?: string | null;
  dataEmissao?: string | null;
  dataFatoGerador?: string | null;
  dataVencimento?: string | null;
  dataRecebimento?: string | null;
  status: StatusNota;
  valorBruto?: number | null;
  valorLiquido?: number | null;
  aliquota?: number | null;
  valorIss?: number | null;
  baseCalculo?: number | null;
  valorLiquidoAntecipacao?: number | null;
  valorTotalTributosAntecipacao?: number | null;
  metodoAntecipacao?: 'DIRECT_FEE' | 'RATE_AND_DAYS' | null;
  taxaAntecipacao?: number | null;
  diasAntecipacao?: number | null;
  ir?: number | null;
  pisPasep?: number | null;
  cofins?: number | null;
  inss?: number | null;
  csll?: number | null;
  outrasRetencoes?: number | null;
  valorAproximadoTributos?: number | null;
  naturezaOperacao?: string | null;
  situacaoTributariaIssqn?: string | null;
  localPrestacao?: string | null;
  situacaoNfse?: string | null;
  observacoesFiscais?: string | null;
  regimeTributario?: string | null;
  indicacaoRetencao?: string | null;
  observacoesAutenticidade?: string | null;
  municipioEmissor?: string | null;
  codigoServico?: string | null;
  quantidade?: number | null;
  valorUnitario?: number | null;
  observacoes?: string | null;
  arquivoPdfUrl?: string | null;
  pdfData?: string | null;
  hasPdf?: boolean;
  tags?: string | null;
  prestadorId?: string | null;
  tomadorId?: string | null;
  notaSubstitutivaId?: string | null;
  prestador?: PessoaFiscal | null;
  tomador?: PessoaFiscal | null;
  historico?: HistoricoAlteracao[];
  createdAt: string;
  updatedAt: string;
}

export interface Imposto {
  id: string;
  mesReferencia?: string | null;
  dataVencimento?: string | null;
  dataPagamento?: string | null;
  imposto?: string | null;
  valor?: number | null;
  status: StatusImposto;
  observacao?: string | null;
  notaFiscalId?: string | null;
  notaFiscal?: { numeroNf?: string | null; nomeOrganizador?: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface HistoricoAlteracao {
  id: string;
  notaFiscalId: string;
  campoAlterado?: string | null;
  valorAntigo?: string | null;
  valorNovo?: string | null;
  usuario?: string | null;
  dataAcao: string;
}

// ─── Gastos ─────────────────────────────────────────────────────────────────────
export interface AnexoGasto {
  url: string;
  filename: string;
  nome: string;
  tipo?: string;
}

// Item de produto/serviço extraído do documento (mesmo pipeline das Notas).
export interface ProdutoGasto {
  descricao?: string | null;
  quantidade?: number | null;
  unidade?: string | null;
  valorUnitario?: number | null;
  valorTotal?: number | null;
}

export interface Gasto {
  id: string;
  descricao: string;
  valor: number;
  data: string;
  categoria?: string | null;
  fornecedor?: string | null;
  formaPagamento?: string | null;
  observacoes?: string | null;
  anexos?: AnexoGasto[] | null;
  // Dados extraídos do documento
  fornecedorCnpj?: string | null;
  numeroDocumento?: string | null;
  serieDocumento?: string | null;
  produtos?: ProdutoGasto[] | null;
  servicoId?: string | null;
  servico?: { id: string; nome: string; status: StatusServico } | null;
  createdAt: string;
  updatedAt: string;
}

export const CATEGORIAS_GASTO = [
  'Alimentação', 'Transporte', 'Material', 'Serviços',
  'Equipamentos', 'Combustível', 'Impostos e Taxas', 'Outros',
];

export const FORMAS_PAGAMENTO = [
  'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro', 'Boleto', 'Transferência', 'Outros',
];

// ─── Serviços ───────────────────────────────────────────────────────────────────
export type StatusServico = 'em_andamento' | 'concluido';

export interface Servico {
  id: string;
  nome: string;
  valorContratado: number;
  status: StatusServico;
  gestor?: string | null;
  comprador?: string | null;
  numeroOF?: string | null;
  numeroOrcamento?: string | null;
  // Calculados a partir dos gastos vinculados — nunca armazenados (ver calcularServico).
  totalGastos: number;
  quantidadeGastos: number;
  lucro: number;
  gastos?: Gasto[];
  createdAt: string;
  updatedAt: string;
}

export const STATUS_SERVICO_LABELS: Record<string, string> = {
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
};

export const STATUS_SERVICO_COLORS: Record<string, string> = {
  em_andamento: 'bg-blue-100 text-blue-700',
  concluido: 'bg-green-100 text-green-700',
};

// ─── Controle de Integração ─────────────────────────────────────────────────────
export type TipoDocumentoColaborador = 'INTEGRACAO' | 'ASO';

export interface DocumentoColaborador {
  id: string;
  tipo: TipoDocumentoColaborador;
  dataInicio: string;
  dataFim: string;
  // Calculados a partir da data — nunca armazenados (mesmo padrão de calcularServico).
  status: 'em_dia' | 'proximo_vencimento' | 'vencido';
  diasRestantes: number;
}

export interface Colaborador {
  id: string;
  nome: string;
  documentos: DocumentoColaborador[];
  statusGeral: 'em_dia' | 'proximo_vencimento' | 'vencido';
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_DOCUMENTO_LABELS: Record<string, string> = {
  em_dia: 'Em dia',
  proximo_vencimento: 'Próximo do vencimento',
  vencido: 'Vencido',
};

export const STATUS_DOCUMENTO_COLORS: Record<string, string> = {
  em_dia: 'bg-green-100 text-green-700',
  proximo_vencimento: 'bg-amber-100 text-amber-700',
  vencido: 'bg-red-100 text-red-700',
};

export interface PdfExtractResult {
  nomeOrganizador?: string;
  tipo?: string;
  numeroNf?: string;
  numeroRps?: string;
  codigoVerificacao?: string;
  of?: string;
  descricao?: string;
  dataEmissao?: string;
  dataFatoGerador?: string;
  dataVencimento?: string;
  dataRecebimento?: string;
  municipioEmissor?: string;
  codigoServico?: string;
  quantidade?: number;
  valorUnitario?: number;
  valorBruto?: number;
  valorLiquido?: number;
  aliquota?: number;
  valorIss?: number;
  baseCalculo?: number;
  ir?: number;
  pisPasep?: number;
  cofins?: number;
  inss?: number;
  csll?: number;
  outrasRetencoes?: number;
  valorAproximadoTributos?: number;
  naturezaOperacao?: string;
  situacaoTributariaIssqn?: string;
  localPrestacao?: string;
  situacaoNfse?: string;
  observacoesFiscais?: string;
  regimeTributario?: string;
  indicacaoRetencao?: string;
  observacoesAutenticidade?: string;
  prestador?: Partial<PessoaFiscal>;
  tomador?: Partial<PessoaFiscal>;
  // Campos de extração avançada (somente exibição — não salvos no banco)
  desconto?: number;
  descontoIncondicionado?: number;
  deducoes?: number;
  valorAproximadoTributosFederal?: number;
  valorAproximadoTributosEstadual?: number;
  valorAproximadoTributosMunicipal?: number;
  simplesNacional?: boolean;
  // ── DANFE / documentos com tabela de produtos (aditivo — NFS-e não preenche) ──
  serie?: string;
  produtos?: ProdutoGasto[];
  camposConfianca?: Record<string, number>;  // score por campo (0–100)
  // Qualidade e validação
  camposNaoEncontrados?: string[];
  camposBaixaConfianca?: string[];
  inconsistencias?: string[];
  fontesExtracao?: string[];
  resumo?: string;
  // ── DANFSe Nacional — campos extras (display-only; não salvos no banco) ──────
  layoutNfse?: 'MUNICIPAL' | 'DANFSE_NACIONAL';
  chaveAcessoNfse?: string;
  competenciaNfse?: string;
  numeroDps?: string;
  serieDps?: string;
  dataEmissaoDps?: string;
  nbs?: string;
  codigoTributacaoNacional?: string;
  codigoTributacaoMunicipal?: string;
  paisPrestacao?: string;
  resultadoPrestacao?: string;
  beneficioMunicipal?: string;
  tipoImunidade?: string;
  suspensaoExigibilidadeIssqn?: string;
  numeroProcessoSuspensao?: string;
  regimeEspecialTributacao?: string;
  regimeApuracao?: string;
  tributacaoIssqn?: string;
  municipioIncidenciaIssqn?: string;
}

export interface FiltrosNota {
  busca?: string;
  status?: string;
  dataInicio?: string;
  dataFim?: string;
  tomador?: string;
  prestador?: string;
  ordenarPor?: string;
  ordem?: 'asc' | 'desc';
  pagina?: number;
  itensPorPagina?: number;
}

export interface ResumoRelatorio {
  periodo: { inicio: string; fim: string };
  totalNotas: number;
  totalBruto: number;
  totalLiquido: number;
  totalIss: number;
  totalTributos: number;
  totalAntecipado: number;
  porStatus: Record<string, number>;
  porTomador: Array<{ nome: string; total: number; quantidade: number }>;
  porMes: Array<{ mes: string; total: number; quantidade: number }>;
}

export const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  lancada: 'Lançada',
  recebida: 'Recebida',
  antecipada: 'Antecipada',
  incompleta: 'Incompleta',
  invalida: 'Inválida',
  substitutiva: 'Substitutiva',
  substituida: 'Substituída',
  cancelada: 'Cancelada',
};

export const STATUS_COLORS: Record<string, string> = {
  rascunho: 'bg-gray-100 text-gray-700',
  lancada: 'bg-blue-100 text-blue-700',
  recebida: 'bg-green-100 text-green-700',
  antecipada: 'bg-purple-100 text-purple-700',
  incompleta: 'bg-yellow-100 text-yellow-700',
  invalida: 'bg-red-100 text-red-700',
  substitutiva: 'bg-cyan-100 text-cyan-700',
  substituida: 'bg-orange-100 text-orange-700',
  cancelada: 'bg-red-200 text-red-800',
};

export const STATUS_IMPOSTO_LABELS: Record<string, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  vencido: 'Vencido',
  cancelado: 'Cancelado',
};

export const STATUS_IMPOSTO_COLORS: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-700',
  pago: 'bg-green-100 text-green-700',
  vencido: 'bg-red-100 text-red-700',
  cancelado: 'bg-gray-100 text-gray-700',
};
