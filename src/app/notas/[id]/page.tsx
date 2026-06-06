'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Edit3, Save, X, FileText, History, AlertCircle,
  CheckCircle, ExternalLink, Loader2, ChevronDown, ChevronUp, Copy, Ban
} from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { NotaFiscal, HistoricoAlteracao } from '@/types';

type FormData = Record<string, string | number | null>;

const STATUS_OPTIONS = ['rascunho', 'lancada', 'recebida', 'antecipada', 'incompleta', 'invalida', 'substitutiva', 'substituida', 'cancelada'];

export default function NotaDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [nota, setNota] = useState<NotaFiscal | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormData>({});
  const [prestador, setPrestador] = useState<FormData>({});
  const [tomador, setTomador] = useState<FormData>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    fetch(`/api/notas/${params.id}`)
      .then(r => r.json())
      .then(d => { setNota(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params.id]);

  const startEdit = () => {
    if (!nota) return;
    const toStr = (v: unknown) => v == null ? '' : String(v);
    // Convert dates from ISO to date input format
    const dateStr = (v: unknown) => {
      if (!v) return '';
      const d = new Date(v as string);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().split('T')[0];
    };
    setForm({
      nomeOrganizador: toStr(nota.nomeOrganizador),
      tipo: toStr(nota.tipo),
      numeroNf: toStr(nota.numeroNf),
      numeroRps: toStr(nota.numeroRps),
      codigoVerificacao: toStr(nota.codigoVerificacao),
      of: toStr(nota.of),
      dataEmissao: dateStr(nota.dataEmissao),
      dataFatoGerador: dateStr(nota.dataFatoGerador),
      dataVencimento: dateStr(nota.dataVencimento),
      dataRecebimento: dateStr(nota.dataRecebimento),
      municipioEmissor: toStr(nota.municipioEmissor),
      status: toStr(nota.status),
      descricao: toStr(nota.descricao),
      codigoServico: toStr(nota.codigoServico),
      quantidade: nota.quantidade ?? '',
      valorUnitario: nota.valorUnitario ?? '',
      valorBruto: nota.valorBruto ?? '',
      valorLiquido: nota.valorLiquido ?? '',
      baseCalculo: nota.baseCalculo ?? '',
      aliquota: nota.aliquota ?? '',
      valorIss: nota.valorIss ?? '',
      valorLiquidoAntecipacao: nota.valorLiquidoAntecipacao ?? '',
      valorTotalTributosAntecipacao: nota.valorTotalTributosAntecipacao ?? '',
      ir: nota.ir ?? '',
      pisPasep: nota.pisPasep ?? '',
      cofins: nota.cofins ?? '',
      inss: nota.inss ?? '',
      csll: nota.csll ?? '',
      outrasRetencoes: nota.outrasRetencoes ?? '',
      valorAproximadoTributos: nota.valorAproximadoTributos ?? '',
      naturezaOperacao: toStr(nota.naturezaOperacao),
      situacaoTributariaIssqn: toStr(nota.situacaoTributariaIssqn),
      localPrestacao: toStr(nota.localPrestacao),
      situacaoNfse: toStr(nota.situacaoNfse),
      regimeTributario: toStr(nota.regimeTributario),
      indicacaoRetencao: toStr(nota.indicacaoRetencao),
      observacoesFiscais: toStr(nota.observacoesFiscais),
      observacoesAutenticidade: toStr(nota.observacoesAutenticidade),
      observacoes: toStr(nota.observacoes),
      tags: toStr(nota.tags),
    });
    const pf = (nota.prestador || {}) as import('@/types').PessoaFiscal;
    const tf = (nota.tomador || {}) as import('@/types').PessoaFiscal;
    setPrestador({ id: pf.id || '', nomeRazaoSocial: pf.nomeRazaoSocial || '', nomeFantasia: pf.nomeFantasia || '', cpfCnpj: pf.cpfCnpj || '', inscricaoMunicipal: pf.inscricaoMunicipal || '', inscricaoEstadual: pf.inscricaoEstadual || '', email: pf.email || '', telefone: pf.telefone || '', celular: pf.celular || '', endereco: pf.endereco || '', numero: pf.numero || '', complemento: pf.complemento || '', bairro: pf.bairro || '', cep: pf.cep || '', municipio: pf.municipio || '', uf: pf.uf || '', site: pf.site || '' });
    setTomador({ id: tf.id || '', nomeRazaoSocial: tf.nomeRazaoSocial || '', nomeFantasia: tf.nomeFantasia || '', cpfCnpj: tf.cpfCnpj || '', inscricaoMunicipal: tf.inscricaoMunicipal || '', inscricaoEstadual: tf.inscricaoEstadual || '', email: tf.email || '', telefone: tf.telefone || '', celular: tf.celular || '', endereco: tf.endereco || '', numero: tf.numero || '', complemento: tf.complemento || '', bairro: tf.bairro || '', cep: tf.cep || '', municipio: tf.municipio || '', uf: tf.uf || '', site: tf.site || '' });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`/api/notas/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, prestador, tomador }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao salvar.'); return; }
      setNota(data);
      setSuccess('Salvo com sucesso!');
      setEditing(false);
    } catch {
      setError('Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatus = async (newStatus: string) => {
    if (!nota) return;
    const res = await fetch(`/api/notas/${params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (res.ok) setNota(data);
  };

  const handleDuplicate = async () => {
    if (!nota) return;
    const { id: _id, createdAt: _c, updatedAt: _u, historico: _h, ...rest } = nota as unknown as Record<string, unknown>;
    const res = await fetch('/api/notas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rest, nomeOrganizador: `CÓPIA - ${nota.nomeOrganizador || nota.numeroNf}`, status: 'rascunho', numeroNf: '', prestador: nota.prestador, tomador: nota.tomador }),
    });
    const data = await res.json();
    if (res.ok) router.push(`/notas/${data.nota.id}`);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>;
  if (!nota) return <div className="p-6"><div className="card p-8 text-center text-gray-400"><AlertCircle size={40} className="mx-auto mb-2" /><p>Nota não encontrada</p><Link href="/notas" className="btn-secondary mt-4">Voltar</Link></div></div>;

  const F = ({ label, value }: { label: string; value?: string | number | null }) =>
    value ? <div><p className="label">{label}</p><p className="text-sm text-gray-800">{String(value)}</p></div> : null;

  const FEdit = ({ label, fkey, type = 'text', source, setter }: { label: string; fkey: string; type?: string; source: FormData; setter: (k: string, v: string) => void }) => (
    <div>
      <label className="label">{label}</label>
      <input type={type} step={type === 'number' ? '0.01' : undefined} className="input" value={String(source[fkey] ?? '')} onChange={e => setter(fkey, e.target.value)} />
    </div>
  );

  const sf = (k: string, v: string) => setForm(p => ({ ...p, [k]: v || null }));
  const sp2 = (k: string, v: string) => setPrestador(p => ({ ...p, [k]: v || null }));
  const st = (k: string, v: string) => setTomador(p => ({ ...p, [k]: v || null }));

  // Painel do PDF — fica sticky à direita quando há PDF salvo
  const hasPdf = !!(nota.hasPdf || nota.arquivoPdfUrl);
  const pdfSrc = `/api/notas/${nota.id}/pdf`;
  const PdfPanel = () => hasPdf ? (
    <div className="w-[460px] shrink-0 hidden xl:block">
      <div className="card overflow-hidden sticky top-4" style={{ height: 'calc(100vh - 88px)' }}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-red-500" />
            <span className="text-sm font-semibold text-gray-700">PDF Original</span>
          </div>
          <a href={pdfSrc} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <ExternalLink size={11} /> Nova aba
          </a>
        </div>
        <iframe
          src={pdfSrc}
          className="w-full h-full border-0"
          title="PDF da nota fiscal"
        />
      </div>
    </div>
  ) : null;

  return (
    <div className="p-6 flex gap-6 items-start max-w-[1400px]">
      {/* ── Coluna principal (esquerda) ─────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/notas" className="btn-ghost p-2"><ArrowLeft size={18} /></Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{nota.nomeOrganizador || `NF ${nota.numeroNf || 'S/N'}`}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {nota.numeroNf && <span className="text-xs text-gray-400">#{nota.numeroNf}</span>}
                <span className={`badge ${STATUS_COLORS[nota.status] || 'bg-gray-100'}`}>{STATUS_LABELS[nota.status] || nota.status}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!editing ? (
              <>
                <button onClick={startEdit} className="btn-secondary"><Edit3 size={14} /> Editar</button>
                <button onClick={handleDuplicate} className="btn-secondary"><Copy size={14} /> Duplicar</button>
                {nota.status !== 'recebida' && <button onClick={() => handleQuickStatus('recebida')} className="btn-secondary text-green-700"><CheckCircle size={14} /> Marcar Recebida</button>}
                {nota.status !== 'cancelada' && <button onClick={() => handleQuickStatus('cancelada')} className="btn-secondary text-red-600"><Ban size={14} /> Cancelar</button>}
              </>
            ) : (
              <>
                <button onClick={() => setEditing(false)} className="btn-secondary"><X size={14} /> Cancelar</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary"><Save size={14} />{saving ? 'Salvando...' : 'Salvar'}</button>
              </>
            )}
          </div>
        </div>

        {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm"><AlertCircle size={15} />{error}</div>}
        {success && <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm"><CheckCircle size={15} />{success}</div>}

        {/* PDF link mobile (só aparece em telas menores que xl onde o painel lateral não existe) */}
        {hasPdf && (
          <div className="xl:hidden card p-3 flex items-center gap-3">
            <FileText size={16} className="text-red-500 shrink-0" />
            <span className="text-sm text-gray-600 flex-1">PDF Original Anexado</span>
            <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
              <ExternalLink size={13} /> Abrir PDF
            </a>
          </div>
        )}

        {editing ? (
          // MODO EDIÇÃO
          <div className="space-y-5">
            <Section title="Identificação">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <FEdit label="Nome Organizador" fkey="nomeOrganizador" source={form} setter={sf} />
                <FEdit label="Tipo" fkey="tipo" source={form} setter={sf} />
                <FEdit label="Número NF" fkey="numeroNf" source={form} setter={sf} />
                <FEdit label="Número RPS" fkey="numeroRps" source={form} setter={sf} />
                <FEdit label="Código Verificação" fkey="codigoVerificacao" source={form} setter={sf} />
                <FEdit label="OF" fkey="of" source={form} setter={sf} />
                <FEdit label="Data Emissão" fkey="dataEmissao" type="date" source={form} setter={sf} />
                <FEdit label="Data Vencimento" fkey="dataVencimento" type="date" source={form} setter={sf} />
                <FEdit label="Data Recebimento" fkey="dataRecebimento" type="date" source={form} setter={sf} />
                <FEdit label="Município Emissor" fkey="municipioEmissor" source={form} setter={sf} />
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={String(form.status || '')} onChange={e => sf('status', e.target.value)}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                  </select>
                </div>
              </div>
            </Section>
            <Section title="Serviço e Valores">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="col-span-2 lg:col-span-3">
                  <label className="label">Descrição</label>
                  <textarea className="input min-h-[80px]" value={String(form.descricao ?? '')} onChange={e => sf('descricao', e.target.value)} />
                </div>
                <FEdit label="Valor Bruto" fkey="valorBruto" type="number" source={form} setter={sf} />
                <FEdit label="Valor Líquido" fkey="valorLiquido" type="number" source={form} setter={sf} />
                <FEdit label="Base de Cálculo" fkey="baseCalculo" type="number" source={form} setter={sf} />
                <FEdit label="Alíquota %" fkey="aliquota" type="number" source={form} setter={sf} />
                <FEdit label="Valor ISS" fkey="valorIss" type="number" source={form} setter={sf} />
                <FEdit label="IR" fkey="ir" type="number" source={form} setter={sf} />
                <FEdit label="PIS/PASEP" fkey="pisPasep" type="number" source={form} setter={sf} />
                <FEdit label="COFINS" fkey="cofins" type="number" source={form} setter={sf} />
                <FEdit label="INSS" fkey="inss" type="number" source={form} setter={sf} />
                <FEdit label="CSLL" fkey="csll" type="number" source={form} setter={sf} />
                <FEdit label="Observações" fkey="observacoes" source={form} setter={sf} />
              </div>
            </Section>
            <Section title="Prestador">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <FEdit label="Razão Social" fkey="nomeRazaoSocial" source={prestador} setter={sp2} />
                <FEdit label="CNPJ/CPF" fkey="cpfCnpj" source={prestador} setter={sp2} />
                <FEdit label="Insc. Municipal" fkey="inscricaoMunicipal" source={prestador} setter={sp2} />
                <FEdit label="E-mail" fkey="email" type="email" source={prestador} setter={sp2} />
                <FEdit label="Telefone" fkey="telefone" source={prestador} setter={sp2} />
              </div>
            </Section>
            <Section title="Tomador">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <FEdit label="Razão Social" fkey="nomeRazaoSocial" source={tomador} setter={st} />
                <FEdit label="CNPJ/CPF" fkey="cpfCnpj" source={tomador} setter={st} />
                <FEdit label="Insc. Municipal" fkey="inscricaoMunicipal" source={tomador} setter={st} />
                <FEdit label="E-mail" fkey="email" type="email" source={tomador} setter={st} />
                <FEdit label="Telefone" fkey="telefone" source={tomador} setter={st} />
              </div>
            </Section>
          </div>
        ) : (
          // MODO VISUALIZAÇÃO
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Identificação */}
            <div className="card p-5 space-y-4">
              <p className="section-title">Identificação</p>
              <div className="grid grid-cols-2 gap-3">
                <F label="Número NF" value={nota.numeroNf} />
                <F label="Número RPS" value={nota.numeroRps} />
                <F label="Tipo" value={nota.tipo} />
                <F label="OF" value={nota.of} />
                <F label="Data Emissão" value={formatarData(nota.dataEmissao)} />
                <F label="Data Vencimento" value={formatarData(nota.dataVencimento)} />
                <F label="Data Recebimento" value={formatarData(nota.dataRecebimento)} />
                <F label="Município Emissor" value={nota.municipioEmissor} />
                <F label="Cód. Verificação" value={nota.codigoVerificacao} />
                <F label="Tags" value={nota.tags} />
              </div>
              {nota.descricao && <div><p className="label">Descrição do Serviço</p><p className="text-sm text-gray-800 leading-relaxed">{nota.descricao}</p></div>}
              {nota.observacoes && <div><p className="label">Observações</p><p className="text-sm text-gray-800">{nota.observacoes}</p></div>}
            </div>

            {/* Valores */}
            <div className="card p-5">
              <p className="section-title">Valores Financeiros</p>
              <div className="grid grid-cols-2 gap-3">
                <ValueRow label="Valor Bruto" value={formatarMoeda(nota.valorBruto)} highlight />
                <ValueRow label="Valor Líquido" value={formatarMoeda(nota.valorLiquido)} highlight />
                <ValueRow label="Base de Cálculo" value={formatarMoeda(nota.baseCalculo)} />
                <ValueRow label="Alíquota ISS" value={nota.aliquota != null ? `${nota.aliquota}%` : '—'} />
                <ValueRow label="Valor ISS" value={formatarMoeda(nota.valorIss)} />
                <ValueRow label="Val. Líq. Antecipação" value={formatarMoeda(nota.valorLiquidoAntecipacao)} />
              </div>
              <p className="section-title mt-4">Retenções Federais</p>
              <div className="grid grid-cols-2 gap-3">
                <ValueRow label="IR" value={formatarMoeda(nota.ir)} />
                <ValueRow label="PIS/PASEP" value={formatarMoeda(nota.pisPasep)} />
                <ValueRow label="COFINS" value={formatarMoeda(nota.cofins)} />
                <ValueRow label="INSS" value={formatarMoeda(nota.inss)} />
                <ValueRow label="CSLL" value={formatarMoeda(nota.csll)} />
                <ValueRow label="Outras Retenções" value={formatarMoeda(nota.outrasRetencoes)} />
              </div>
            </div>

            {/* Prestador */}
            {nota.prestador && (
              <div className="card p-5">
                <p className="section-title">Prestador de Serviços</p>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Razão Social" value={nota.prestador.nomeRazaoSocial} />
                  <F label="Nome Fantasia" value={nota.prestador.nomeFantasia} />
                  <F label="CNPJ/CPF" value={nota.prestador.cpfCnpj} />
                  <F label="Insc. Municipal" value={nota.prestador.inscricaoMunicipal} />
                  <F label="Insc. Estadual" value={nota.prestador.inscricaoEstadual} />
                  <F label="E-mail" value={nota.prestador.email} />
                  <F label="Telefone" value={nota.prestador.telefone} />
                  <F label="Endereço" value={[nota.prestador.endereco, nota.prestador.numero, nota.prestador.bairro, nota.prestador.municipio, nota.prestador.uf].filter(Boolean).join(', ')} />
                </div>
              </div>
            )}

            {/* Tomador */}
            {nota.tomador && (
              <div className="card p-5">
                <p className="section-title">Tomador de Serviços</p>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Razão Social" value={nota.tomador.nomeRazaoSocial} />
                  <F label="Nome Fantasia" value={nota.tomador.nomeFantasia} />
                  <F label="CNPJ/CPF" value={nota.tomador.cpfCnpj} />
                  <F label="Insc. Municipal" value={nota.tomador.inscricaoMunicipal} />
                  <F label="Insc. Estadual" value={nota.tomador.inscricaoEstadual} />
                  <F label="E-mail" value={nota.tomador.email} />
                  <F label="Telefone" value={nota.tomador.telefone} />
                  <F label="Endereço" value={[nota.tomador.endereco, nota.tomador.numero, nota.tomador.bairro, nota.tomador.municipio, nota.tomador.uf].filter(Boolean).join(', ')} />
                </div>
              </div>
            )}

            {/* Fiscal */}
            {(nota.naturezaOperacao || nota.situacaoTributariaIssqn || nota.localPrestacao || nota.regimeTributario) && (
              <div className="card p-5 lg:col-span-2">
                <p className="section-title">Situação Fiscal</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <F label="Natureza da Operação" value={nota.naturezaOperacao} />
                  <F label="Situação Tributária ISSQN" value={nota.situacaoTributariaIssqn} />
                  <F label="Local de Prestação" value={nota.localPrestacao} />
                  <F label="Regime Tributário" value={nota.regimeTributario} />
                  <F label="Indicação de Retenção" value={nota.indicacaoRetencao} />
                  <F label="Situação NFS-e" value={nota.situacaoNfse} />
                </div>
                {nota.observacoesFiscais && <div className="mt-3"><p className="label">Observações Fiscais</p><p className="text-sm text-gray-700">{nota.observacoesFiscais}</p></div>}
              </div>
            )}
          </div>
        )}

        {/* Histórico */}
        {(nota.historico?.length ?? 0) > 0 && (
          <div className="card overflow-hidden">
            <button className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100" onClick={() => setShowHistory(h => !h)}>
              <div className="flex items-center gap-2">
                <History size={15} className="text-gray-500" />
                <h3 className="font-bold text-sm text-gray-700">Histórico de Alterações ({nota.historico?.length})</h3>
              </div>
              {showHistory ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {showHistory && (
              <div className="divide-y divide-gray-100">
                {nota.historico?.map((h: HistoricoAlteracao) => (
                  <div key={h.id} className="px-5 py-3 flex items-start gap-3 text-sm">
                    <History size={14} className="text-gray-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <span className="font-medium text-gray-700">{h.campoAlterado}</span>
                      <span className="text-gray-500"> de </span>
                      <span className="text-red-600 line-through">{h.valorAntigo || '(vazio)'}</span>
                      <span className="text-gray-500"> → </span>
                      <span className="text-green-600">{h.valorNovo || '(vazio)'}</span>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{formatarData(h.dataAcao)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Coluna PDF (direita, sticky, só em telas ≥ xl) ──────────────── */}
      <PdfPanel />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <h3 className="font-bold text-sm text-gray-700">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ValueRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className={`text-sm font-${highlight ? 'bold' : 'medium'} ${highlight ? 'text-gray-900' : 'text-gray-700'}`}>{value}</p>
    </div>
  );
}
