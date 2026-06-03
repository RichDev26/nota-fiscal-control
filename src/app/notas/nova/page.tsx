'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, Save, AlertCircle, CheckCircle, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { PdfExtractResult } from '@/types';

type FormData = Record<string, string | number | null>;

const SECTION_FIELDS = {
  'Identificação da Nota': [
    { key: 'nomeOrganizador', label: 'Nome Organizador *', type: 'text', help: 'Nome interno para identificar esta nota' },
    { key: 'tipo', label: 'Tipo', type: 'text', placeholder: 'NFS-e, NF-e...' },
    { key: 'numeroNf', label: 'Número da NF', type: 'text' },
    { key: 'numeroRps', label: 'Número RPS', type: 'text' },
    { key: 'codigoVerificacao', label: 'Código de Verificação', type: 'text' },
    { key: 'of', label: 'OF (Ordem de Fornecimento)', type: 'text' },
    { key: 'dataEmissao', label: 'Data de Emissão', type: 'date' },
    { key: 'dataFatoGerador', label: 'Data do Fato Gerador', type: 'date' },
    { key: 'dataVencimento', label: 'Data de Vencimento', type: 'date' },
    { key: 'dataRecebimento', label: 'Data de Recebimento', type: 'date' },
    { key: 'municipioEmissor', label: 'Município Emissor', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: ['rascunho', 'lancada', 'recebida', 'antecipada', 'incompleta', 'invalida', 'substitutiva', 'substituida', 'cancelada'] },
  ],
  'Descrição do Serviço': [
    { key: 'descricao', label: 'Descrição do Serviço', type: 'textarea' },
    { key: 'codigoServico', label: 'Código do Serviço', type: 'text' },
    { key: 'quantidade', label: 'Quantidade', type: 'number' },
    { key: 'valorUnitario', label: 'Valor Unitário', type: 'number' },
  ],
  'Valores Financeiros': [
    { key: 'valorBruto', label: 'Valor Bruto (R$)', type: 'number' },
    { key: 'valorLiquido', label: 'Valor Líquido (R$)', type: 'number' },
    { key: 'baseCalculo', label: 'Base de Cálculo (R$)', type: 'number' },
    { key: 'aliquota', label: 'Alíquota ISS (%)', type: 'number' },
    { key: 'valorIss', label: 'Valor ISS (R$)', type: 'number' },
    { key: 'valorLiquidoAntecipacao', label: 'Valor Líq. Antecipação (R$)', type: 'number' },
    { key: 'valorTotalTributosAntecipacao', label: 'Total Tributos Antecipação (R$)', type: 'number' },
  ],
  'Retenções Federais': [
    { key: 'ir', label: 'IR (R$)', type: 'number' },
    { key: 'pisPasep', label: 'PIS/PASEP (R$)', type: 'number' },
    { key: 'cofins', label: 'COFINS (R$)', type: 'number' },
    { key: 'inss', label: 'INSS (R$)', type: 'number' },
    { key: 'csll', label: 'CSLL (R$)', type: 'number' },
    { key: 'outrasRetencoes', label: 'Outras Retenções (R$)', type: 'number' },
    { key: 'valorAproximadoTributos', label: 'Valor Aprox. Tributos (R$)', type: 'number' },
  ],
  'Situação Fiscal': [
    { key: 'naturezaOperacao', label: 'Natureza da Operação', type: 'text' },
    { key: 'situacaoTributariaIssqn', label: 'Situação Tributária ISSQN', type: 'text' },
    { key: 'localPrestacao', label: 'Local de Prestação', type: 'text' },
    { key: 'situacaoNfse', label: 'Situação da NFS-e', type: 'text' },
    { key: 'regimeTributario', label: 'Regime Tributário', type: 'text' },
    { key: 'indicacaoRetencao', label: 'Indicação de Retenção', type: 'text' },
    { key: 'observacoesFiscais', label: 'Observações Fiscais', type: 'textarea' },
    { key: 'observacoesAutenticidade', label: 'Obs. de Autenticidade', type: 'textarea' },
    { key: 'observacoes', label: 'Observações Gerais', type: 'textarea' },
    { key: 'tags', label: 'Tags', type: 'text', placeholder: 'tag1, tag2...' },
  ],
};

const PESSOA_FIELDS = [
  { key: 'nomeRazaoSocial', label: 'Nome / Razão Social', type: 'text' },
  { key: 'nomeFantasia', label: 'Nome Fantasia', type: 'text' },
  { key: 'cpfCnpj', label: 'CPF / CNPJ', type: 'text' },
  { key: 'inscricaoMunicipal', label: 'Insc. Municipal', type: 'text' },
  { key: 'inscricaoEstadual', label: 'Insc. Estadual', type: 'text' },
  { key: 'email', label: 'E-mail', type: 'email' },
  { key: 'telefone', label: 'Telefone', type: 'text' },
  { key: 'celular', label: 'Celular', type: 'text' },
  { key: 'endereco', label: 'Endereço', type: 'text' },
  { key: 'numero', label: 'Número', type: 'text' },
  { key: 'complemento', label: 'Complemento', type: 'text' },
  { key: 'bairro', label: 'Bairro', type: 'text' },
  { key: 'cep', label: 'CEP', type: 'text' },
  { key: 'municipio', label: 'Município', type: 'text' },
  { key: 'uf', label: 'UF', type: 'text' },
  { key: 'site', label: 'Site', type: 'text' },
];

export default function NovaNotaPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormData>({ status: 'rascunho' });
  const [prestador, setPrestador] = useState<FormData>({});
  const [tomador, setTomador] = useState<FormData>({});
  const [arquivoPdfUrl, setArquivoPdfUrl] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [aviso, setAviso] = useState('');
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'Identificação da Nota': true,
    'Prestador de Serviços': true,
    'Tomador de Serviços': true,
    'Descrição do Serviço': true,
    'Valores Financeiros': true,
    'Retenções Federais': false,
    'Situação Fiscal': false,
  });

  const toggle = (s: string) => setOpenSections(prev => ({ ...prev, [s]: !prev[s] }));

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.pdf')) { setError('Apenas PDFs são aceitos.'); return; }
    setExtracting(true); setError(''); setMissingFields([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/pdf-extract', { method: 'POST', body: fd });
      const data: PdfExtractResult & { arquivoPdfUrl?: string; error?: string } = await res.json();
      if (data.error) { setError(data.error); return; }

      setArquivoPdfUrl(data.arquivoPdfUrl || null);
      setMissingFields(data.camposNaoEncontrados || []);

      setForm(prev => ({
        ...prev,
        nomeOrganizador: data.nomeOrganizador || prev.nomeOrganizador || '',
        tipo: data.tipo || prev.tipo || '',
        numeroNf: data.numeroNf || prev.numeroNf || '',
        numeroRps: data.numeroRps || prev.numeroRps || '',
        codigoVerificacao: data.codigoVerificacao || prev.codigoVerificacao || '',
        of: data.of || prev.of || '',
        dataEmissao: data.dataEmissao || prev.dataEmissao || '',
        dataFatoGerador: data.dataFatoGerador || prev.dataFatoGerador || '',
        municipioEmissor: data.municipioEmissor || prev.municipioEmissor || '',
        codigoServico: data.codigoServico || prev.codigoServico || '',
        descricao: data.descricao || prev.descricao || '',
        quantidade: data.quantidade ?? prev.quantidade ?? null,
        valorUnitario: data.valorUnitario ?? prev.valorUnitario ?? null,
        valorBruto: data.valorBruto ?? prev.valorBruto ?? null,
        valorLiquido: data.valorLiquido ?? prev.valorLiquido ?? null,
        baseCalculo: data.baseCalculo ?? prev.baseCalculo ?? null,
        aliquota: data.aliquota ?? prev.aliquota ?? null,
        valorIss: data.valorIss ?? prev.valorIss ?? null,
        ir: data.ir ?? prev.ir ?? null,
        pisPasep: data.pisPasep ?? prev.pisPasep ?? null,
        cofins: data.cofins ?? prev.cofins ?? null,
        inss: data.inss ?? prev.inss ?? null,
        csll: data.csll ?? prev.csll ?? null,
        outrasRetencoes: data.outrasRetencoes ?? prev.outrasRetencoes ?? null,
        valorAproximadoTributos: data.valorAproximadoTributos ?? prev.valorAproximadoTributos ?? null,
        naturezaOperacao: data.naturezaOperacao || prev.naturezaOperacao || '',
        situacaoTributariaIssqn: data.situacaoTributariaIssqn || prev.situacaoTributariaIssqn || '',
        localPrestacao: data.localPrestacao || prev.localPrestacao || '',
        situacaoNfse: data.situacaoNfse || prev.situacaoNfse || '',
        regimeTributario: data.regimeTributario || prev.regimeTributario || '',
        indicacaoRetencao: data.indicacaoRetencao || prev.indicacaoRetencao || '',
        observacoesFiscais: data.observacoesFiscais || prev.observacoesFiscais || '',
        observacoesAutenticidade: data.observacoesAutenticidade || prev.observacoesAutenticidade || '',
        status: 'incompleta',
      }));

      if (data.prestador) setPrestador(data.prestador as FormData);
      if (data.tomador) setTomador(data.tomador as FormData);
      setOpenSections(prev => ({ ...prev, 'Identificação da Nota': true, 'Prestador de Serviços': true, 'Tomador de Serviços': true, 'Valores Financeiros': true }));
    } catch {
      setError('Erro ao processar PDF.');
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async (draft = false) => {
    if (!form.nomeOrganizador) { setError('O nome organizador é obrigatório.'); return; }
    setSaving(true); setError(''); setSuccess(''); setAviso('');
    try {
      const payload = {
        ...form,
        status: draft ? 'rascunho' : (form.status || 'lancada'),
        arquivoPdfUrl,
        prestador: Object.values(prestador).some(Boolean) ? prestador : undefined,
        tomador: Object.values(tomador).some(Boolean) ? tomador : undefined,
      };
      const res = await fetch('/api/notas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao salvar.'); return; }
      if (data.aviso) setAviso(data.aviso);
      setSuccess('Nota salva com sucesso!');
      setTimeout(() => router.push(`/notas/${data.nota.id}`), 1200);
    } catch {
      setError('Erro ao salvar nota.');
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val || null }));
  const setPField = (key: string, val: string) => setPrestador(prev => ({ ...prev, [key]: val || null }));
  const setTField = (key: string, val: string) => setTomador(prev => ({ ...prev, [key]: val || null }));

  const renderField = (f: { key: string; label: string; type: string; options?: string[]; placeholder?: string; help?: string }, val: string, setter: (k: string, v: string) => void) => (
    <div key={f.key}>
      <label className="label">{f.label}</label>
      {f.help && <p className="text-xs text-gray-400 mb-1">{f.help}</p>}
      {f.type === 'textarea' ? (
        <textarea className="input min-h-[80px] resize-y" value={val} onChange={e => setter(f.key, e.target.value)} placeholder={f.placeholder} />
      ) : f.type === 'select' ? (
        <select className="input" value={val} onChange={e => setter(f.key, e.target.value)}>
          {(f.options || []).map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
      ) : (
        <input type={f.type} className="input" value={val} onChange={e => setter(f.key, e.target.value)} placeholder={f.placeholder} step={f.type === 'number' ? '0.01' : undefined} />
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nova Nota Fiscal</h1>
          <p className="text-sm text-gray-500 mt-0.5">Preencha manualmente ou importe um PDF</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => handleSubmit(true)} disabled={saving}>
            <Save size={15} /> Salvar Rascunho
          </button>
          <button className="btn-primary" onClick={() => handleSubmit(false)} disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
            Salvar Nota
          </button>
        </div>
      </div>

      {/* Alertas */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
          <button className="ml-auto" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}
      {aviso && (
        <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3 text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{aviso}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">
          <CheckCircle size={16} /> <span>{success}</span>
        </div>
      )}

      {/* Upload PDF */}
      <div
        className={`card p-6 border-2 border-dashed transition-colors cursor-pointer ${extracting ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/40'}`}
        onClick={() => !extracting && fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        <div className="flex flex-col items-center gap-2 text-center">
          {extracting ? (
            <>
              <Loader2 size={32} className="text-blue-500 animate-spin" />
              <p className="font-semibold text-blue-700">Extraindo dados do PDF...</p>
              <p className="text-sm text-gray-500">Aguarde, estamos lendo os campos da nota</p>
            </>
          ) : arquivoPdfUrl ? (
            <>
              <FileText size={32} className="text-green-500" />
              <p className="font-semibold text-green-700">PDF carregado e dados extraídos</p>
              <p className="text-sm text-gray-500">Clique para trocar o arquivo</p>
            </>
          ) : (
            <>
              <Upload size={32} className="text-gray-400" />
              <p className="font-semibold text-gray-700">Arraste o PDF da nota ou clique para selecionar</p>
              <p className="text-sm text-gray-400">Os campos serão preenchidos automaticamente para revisão</p>
            </>
          )}
        </div>
      </div>

      {missingFields.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
          <p className="font-semibold text-yellow-800 mb-1">Campos não encontrados no PDF — preencha manualmente:</p>
          <div className="flex flex-wrap gap-1">
            {missingFields.map(f => (
              <span key={f} className="bg-yellow-200 text-yellow-900 px-2 py-0.5 rounded text-xs">{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* Formulário */}
      {Object.entries(SECTION_FIELDS).map(([section, fields]) => (
        <div key={section} className="card overflow-hidden">
          <button className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors" onClick={() => toggle(section)}>
            <h3 className="font-bold text-sm text-gray-700">{section}</h3>
            {openSections[section] ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </button>
          {openSections[section] && (
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {fields.map(f => renderField(f, String(form[f.key] ?? ''), setField))}
            </div>
          )}
        </div>
      ))}

      {/* Prestador */}
      <div className="card overflow-hidden">
        <button className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors" onClick={() => toggle('Prestador de Serviços')}>
          <h3 className="font-bold text-sm text-gray-700">Prestador de Serviços</h3>
          {openSections['Prestador de Serviços'] ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>
        {openSections['Prestador de Serviços'] && (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PESSOA_FIELDS.map(f => renderField(f, String(prestador[f.key] ?? ''), setPField))}
          </div>
        )}
      </div>

      {/* Tomador */}
      <div className="card overflow-hidden">
        <button className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors" onClick={() => toggle('Tomador de Serviços')}>
          <h3 className="font-bold text-sm text-gray-700">Tomador de Serviços</h3>
          {openSections['Tomador de Serviços'] ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>
        {openSections['Tomador de Serviços'] && (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PESSOA_FIELDS.map(f => renderField(f, String(tomador[f.key] ?? ''), setTField))}
          </div>
        )}
      </div>

      {/* Botões finais */}
      <div className="flex justify-end gap-3 pb-6">
        <button className="btn-secondary" onClick={() => router.push('/notas')}>Cancelar</button>
        <button className="btn-secondary" onClick={() => handleSubmit(true)} disabled={saving}>
          <Save size={15} /> Salvar Rascunho
        </button>
        <button className="btn-primary" onClick={() => handleSubmit(false)} disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
          Salvar Nota Fiscal
        </button>
      </div>
    </div>
  );
}
