'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Edit3, Save, X, FileText, AlertCircle, CheckCircle,
  ExternalLink, Copy, Ban, Trash2, Zap, DollarSign, Building2,
  Briefcase, ClipboardList, ChevronDown,
} from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { NotaFiscal } from '@/types';

type FormData = Record<string, string | number | null>;
const STATUS_OPTIONS = ['rascunho', 'lancada', 'recebida', 'antecipada', 'incompleta', 'invalida', 'substitutiva', 'substituida', 'cancelada'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-gray-800 font-medium">{String(value)}</p>
    </div>
  );
}

function MoneyRow({ label, value, big, green }: { label: string; value?: number | null; big?: boolean; green?: boolean }) {
  if (value == null) return null;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className={`text-sm ${big ? 'font-bold text-gray-900' : 'text-gray-500'}`}>{label}</span>
      <span className={`font-bold tabular-nums ${big ? 'text-base' : 'text-sm'} ${green ? 'text-green-700' : 'text-gray-900'}`}>
        {formatarMoeda(value)}
      </span>
    </div>
  );
}

function SectionCard({ title, icon: Icon, iconColor, children }: { title: string; icon: React.ElementType; iconColor: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconColor}`}>
          <Icon size={15} />
        </div>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function FEdit({ label, fkey, type = 'text', source, setter }: { label: string; fkey: string; type?: string; source: FormData; setter: (k: string, v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type={type} step={type === 'number' ? '0.01' : undefined} className="input" value={String(source[fkey] ?? '')} onChange={e => setter(fkey, e.target.value)} />
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`toast-enter fixed bottom-24 md:bottom-6 right-4 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl text-sm font-semibold ${
      type === 'success' ? 'bg-white border border-green-100 text-green-800' : 'bg-white border border-red-100 text-red-700'
    }`}>
      {type === 'success' ? <CheckCircle size={18} className="text-green-500" /> : <AlertCircle size={18} className="text-red-500" />}
      {msg}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function NotaDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [nota, setNota]     = useState<NotaFiscal | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]  = useState(false);
  const [form, setForm]      = useState<FormData>({});
  const [prestador, setPrestador] = useState<FormData>({});
  const [tomador, setTomador]     = useState<FormData>({});
  const [error, setError]    = useState('');
  const [toast, setToast]    = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showFiscal, setShowFiscal] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type });

  useEffect(() => {
    fetch(`/api/notas/${params.id}`)
      .then(r => r.json())
      .then(d => { setNota(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params.id]);

  const startEdit = () => {
    if (!nota) return;
    const toStr = (v: unknown) => v == null ? '' : String(v);
    const dateStr = (v: unknown) => {
      if (!v) return '';
      const d = new Date(v as string);
      return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    };
    setForm({
      nomeOrganizador: toStr(nota.nomeOrganizador), tipo: toStr(nota.tipo),
      numeroNf: toStr(nota.numeroNf), numeroRps: toStr(nota.numeroRps),
      codigoVerificacao: toStr(nota.codigoVerificacao), of: toStr(nota.of),
      dataEmissao: dateStr(nota.dataEmissao), dataFatoGerador: dateStr(nota.dataFatoGerador),
      dataVencimento: dateStr(nota.dataVencimento), dataRecebimento: dateStr(nota.dataRecebimento),
      municipioEmissor: toStr(nota.municipioEmissor), status: toStr(nota.status),
      descricao: toStr(nota.descricao), codigoServico: toStr(nota.codigoServico),
      quantidade: nota.quantidade ?? '', valorUnitario: nota.valorUnitario ?? '',
      valorBruto: nota.valorBruto ?? '', valorLiquido: nota.valorLiquido ?? '',
      baseCalculo: nota.baseCalculo ?? '', aliquota: nota.aliquota ?? '',
      valorIss: nota.valorIss ?? '', valorLiquidoAntecipacao: nota.valorLiquidoAntecipacao ?? '',
      valorTotalTributosAntecipacao: nota.valorTotalTributosAntecipacao ?? '',
      ir: nota.ir ?? '', pisPasep: nota.pisPasep ?? '', cofins: nota.cofins ?? '',
      inss: nota.inss ?? '', csll: nota.csll ?? '', outrasRetencoes: nota.outrasRetencoes ?? '',
      valorAproximadoTributos: nota.valorAproximadoTributos ?? '',
      naturezaOperacao: toStr(nota.naturezaOperacao), situacaoTributariaIssqn: toStr(nota.situacaoTributariaIssqn),
      localPrestacao: toStr(nota.localPrestacao), situacaoNfse: toStr(nota.situacaoNfse),
      regimeTributario: toStr(nota.regimeTributario), indicacaoRetencao: toStr(nota.indicacaoRetencao),
      observacoesFiscais: toStr(nota.observacoesFiscais), observacoesAutenticidade: toStr(nota.observacoesAutenticidade),
      observacoes: toStr(nota.observacoes), tags: toStr(nota.tags),
    });
    const pf = (nota.prestador || {}) as import('@/types').PessoaFiscal;
    const tf = (nota.tomador || {}) as import('@/types').PessoaFiscal;
    setPrestador({ id: pf.id || '', nomeRazaoSocial: pf.nomeRazaoSocial || '', nomeFantasia: pf.nomeFantasia || '', cpfCnpj: pf.cpfCnpj || '', inscricaoMunicipal: pf.inscricaoMunicipal || '', inscricaoEstadual: pf.inscricaoEstadual || '', email: pf.email || '', telefone: pf.telefone || '', celular: pf.celular || '', endereco: pf.endereco || '', numero: pf.numero || '', complemento: pf.complemento || '', bairro: pf.bairro || '', cep: pf.cep || '', municipio: pf.municipio || '', uf: pf.uf || '', site: pf.site || '' });
    setTomador({ id: tf.id || '', nomeRazaoSocial: tf.nomeRazaoSocial || '', nomeFantasia: tf.nomeFantasia || '', cpfCnpj: tf.cpfCnpj || '', inscricaoMunicipal: tf.inscricaoMunicipal || '', inscricaoEstadual: tf.inscricaoEstadual || '', email: tf.email || '', telefone: tf.telefone || '', celular: tf.celular || '', endereco: tf.endereco || '', numero: tf.numero || '', complemento: tf.complemento || '', bairro: tf.bairro || '', cep: tf.cep || '', municipio: tf.municipio || '', uf: tf.uf || '', site: tf.site || '' });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/notas/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, prestador, tomador }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || data.error || 'Erro ao salvar.'); return; }
      setNota(data);
      setEditing(false);
      showToast('Nota salva com sucesso!');
    } catch { setError('Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  const handleQuickStatus = async (newStatus: string) => {
    if (!nota) return;
    const res = await fetch(`/api/notas/${params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (res.ok) { setNota(data); showToast(`Status: ${STATUS_LABELS[newStatus] || newStatus}`); }
  };

  const handleDelete = async () => {
    if (!nota) return;
    if (!confirm(`Excluir "${nota.nomeOrganizador || `NF ${nota.numeroNf}`}"? Esta ação não pode ser desfeita.`)) return;
    const res = await fetch(`/api/notas/${params.id}`, { method: 'DELETE' });
    if (res.ok) { showToast('Nota excluída!'); setTimeout(() => router.push('/notas'), 800); }
    else showToast('Erro ao excluir.', 'error');
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
    else showToast('Erro ao duplicar.', 'error');
  };

  const sf  = (k: string, v: string) => setForm(p => ({ ...p, [k]: v || null }));
  const sp2 = (k: string, v: string) => setPrestador(p => ({ ...p, [k]: v || null }));
  const st  = (k: string, v: string) => setTomador(p => ({ ...p, [k]: v || null }));

  if (loading) return <div className="flex items-center justify-center h-full pt-20"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>;
  if (!nota) return (
    <div className="p-6 max-w-lg mx-auto pt-10">
      <div className="card p-10 text-center">
        <AlertCircle size={36} className="mx-auto text-gray-300 mb-3" />
        <p className="font-semibold text-gray-500">Nota não encontrada</p>
        <Link href="/notas" className="btn-secondary mt-4 inline-flex"><ArrowLeft size={14} /> Voltar</Link>
      </div>
    </div>
  );

  const hasPdf = !!(nota.hasPdf || nota.arquivoPdfUrl);
  const pdfSrc = `/api/notas/${nota.id}/pdf`;

  // ── VIEW MODE ──────────────────────────────────────────────────────────────
  if (!editing) {
    const prestadorNome = nota.prestador?.nomeRazaoSocial || nota.prestador?.nomeFantasia || '—';
    const tomadorNome   = nota.tomador?.nomeRazaoSocial || nota.tomador?.nomeFantasia || '—';

    return (
      <div className="flex h-full">
        {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

        {/* ── Left column ─── */}
        <div className={`space-y-4 p-5 md:p-7 overflow-y-auto ${hasPdf ? 'w-full xl:w-[620px] xl:shrink-0' : 'flex-1'} max-w-2xl mx-auto xl:mx-0 xl:max-w-none`}>

          {/* Header */}
          <div className="pt-2">
            <Link href="/notas" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 font-semibold mb-4 transition-colors">
              <ArrowLeft size={14} /> Voltar
            </Link>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                  {nota.nomeOrganizador || `NF ${nota.numeroNf || 'S/N'}`}
                </h1>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {nota.numeroNf && <span className="text-xs text-gray-400 font-medium">NF {nota.numeroNf}</span>}
                  {nota.dataEmissao && <span className="text-xs text-gray-400">· {formatarData(nota.dataEmissao)}</span>}
                  <span className={`badge ${STATUS_COLORS[nota.status] || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABELS[nota.status] || nota.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={startEdit} className="btn-secondary btn-sm">
              <Edit3 size={13} /> Editar
            </button>
            <button onClick={handleDuplicate} className="btn-secondary btn-sm">
              <Copy size={13} /> Duplicar
            </button>
            {hasPdf && (
              <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                <FileText size={13} /> Ver PDF
              </a>
            )}
            <Link href={`/relatorios?nota=${nota.id}`} className="btn-secondary btn-sm">
              <ClipboardList size={13} /> Relatório
            </Link>
            {nota.status !== 'recebida' && (
              <button onClick={() => handleQuickStatus('recebida')} className="btn-secondary btn-sm text-green-700">
                <CheckCircle size={13} /> Recebida
              </button>
            )}
            {nota.status !== 'antecipada' && (nota.valorLiquido ?? 0) > 0 && (
              <button onClick={() => handleQuickStatus('antecipada')} className="btn-amber btn-sm">
                <Zap size={13} /> Antecipar
              </button>
            )}
            {nota.status !== 'cancelada' && (
              <button onClick={() => handleQuickStatus('cancelada')} className="btn-secondary btn-sm text-red-600">
                <Ban size={13} /> Cancelar
              </button>
            )}
            <button onClick={handleDelete} className="btn-ghost btn-sm text-red-400 hover:text-red-600 ml-auto">
              <Trash2 size={13} />
            </button>
          </div>

          {/* Mobile PDF link */}
          {hasPdf && (
            <div className="xl:hidden card p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 bg-red-50 rounded-xl flex items-center justify-center shrink-0">
                <FileText size={14} className="text-red-500" />
              </div>
              <span className="text-sm text-gray-600 flex-1 font-medium">PDF Original</span>
              <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                <ExternalLink size={12} /> Abrir
              </a>
            </div>
          )}

          {/* RESUMO */}
          <SectionCard title="RESUMO" icon={DollarSign} iconColor="bg-green-50 text-green-600">
            <div className="space-y-0">
              <MoneyRow label="Valor Bruto" value={nota.valorBruto} big />
              <MoneyRow label="Valor Líquido" value={nota.valorLiquido} big green />
              {nota.valorIss != null && <MoneyRow label="ISS" value={nota.valorIss} />}
              {nota.valorLiquidoAntecipacao != null && <MoneyRow label="Valor Líquido Antecipado" value={nota.valorLiquidoAntecipacao} green />}
              {nota.valorTotalTributosAntecipacao != null && <MoneyRow label="Encargos Antecipação" value={nota.valorTotalTributosAntecipacao} />}
              {nota.baseCalculo != null && <MoneyRow label="Base de Cálculo" value={nota.baseCalculo} />}
              {nota.aliquota != null && (
                <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                  <span className="text-sm text-gray-500">Alíquota ISS</span>
                  <span className="font-bold text-sm text-gray-900">{nota.aliquota}%</span>
                </div>
              )}
            </div>
            {/* Retenções federais */}
            {(nota.ir || nota.pisPasep || nota.cofins || nota.inss || nota.csll || nota.outrasRetencoes) && (
              <div className="mt-4 pt-4 border-t border-gray-50">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Retenções Federais</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {nota.ir         && <div className="flex justify-between text-xs"><span className="text-gray-400">IR</span><span className="font-semibold text-gray-700">{formatarMoeda(nota.ir)}</span></div>}
                  {nota.pisPasep   && <div className="flex justify-between text-xs"><span className="text-gray-400">PIS/PASEP</span><span className="font-semibold text-gray-700">{formatarMoeda(nota.pisPasep)}</span></div>}
                  {nota.cofins     && <div className="flex justify-between text-xs"><span className="text-gray-400">COFINS</span><span className="font-semibold text-gray-700">{formatarMoeda(nota.cofins)}</span></div>}
                  {nota.inss       && <div className="flex justify-between text-xs"><span className="text-gray-400">INSS</span><span className="font-semibold text-gray-700">{formatarMoeda(nota.inss)}</span></div>}
                  {nota.csll       && <div className="flex justify-between text-xs"><span className="text-gray-400">CSLL</span><span className="font-semibold text-gray-700">{formatarMoeda(nota.csll)}</span></div>}
                  {nota.outrasRetencoes && <div className="flex justify-between text-xs"><span className="text-gray-400">Outras</span><span className="font-semibold text-gray-700">{formatarMoeda(nota.outrasRetencoes)}</span></div>}
                </div>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-gray-50 grid grid-cols-2 gap-3">
              {nota.dataEmissao    && <InfoRow label="Emissão"     value={formatarData(nota.dataEmissao)} />}
              {nota.dataVencimento && <InfoRow label="Vencimento"  value={formatarData(nota.dataVencimento)} />}
              {nota.dataRecebimento && <InfoRow label="Recebimento" value={formatarData(nota.dataRecebimento)} />}
              {nota.municipioEmissor && <InfoRow label="Município"  value={nota.municipioEmissor} />}
              {nota.numeroRps       && <InfoRow label="RPS"         value={nota.numeroRps} />}
              {nota.tipo            && <InfoRow label="Tipo"        value={nota.tipo} />}
            </div>
          </SectionCard>

          {/* PRESTADOR */}
          {nota.prestador && (
            <SectionCard title="PRESTADOR" icon={Building2} iconColor="bg-blue-50 text-blue-600">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
                  <span className="text-blue-700 font-bold text-sm">
                    {prestadorNome.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">{prestadorNome}</p>
                  {nota.prestador.nomeFantasia && nota.prestador.nomeFantasia !== nota.prestador.nomeRazaoSocial &&
                    <p className="text-xs text-gray-400">{nota.prestador.nomeFantasia}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <InfoRow label="CNPJ/CPF"         value={nota.prestador.cpfCnpj} />
                <InfoRow label="Insc. Municipal"  value={nota.prestador.inscricaoMunicipal} />
                <InfoRow label="Insc. Estadual"   value={nota.prestador.inscricaoEstadual} />
                <InfoRow label="E-mail"            value={nota.prestador.email} />
                <InfoRow label="Telefone"          value={nota.prestador.telefone || nota.prestador.celular} />
                {(nota.prestador.endereco) && (
                  <div className="col-span-2">
                    <InfoRow label="Endereço" value={[nota.prestador.endereco, nota.prestador.numero, nota.prestador.complemento, nota.prestador.bairro, nota.prestador.municipio, nota.prestador.uf].filter(Boolean).join(', ')} />
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* TOMADOR */}
          {nota.tomador && (
            <SectionCard title="TOMADOR" icon={Briefcase} iconColor="bg-purple-50 text-purple-600">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-purple-50 rounded-2xl flex items-center justify-center shrink-0">
                  <span className="text-purple-700 font-bold text-sm">
                    {tomadorNome.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">{tomadorNome}</p>
                  {nota.tomador.nomeFantasia && nota.tomador.nomeFantasia !== nota.tomador.nomeRazaoSocial &&
                    <p className="text-xs text-gray-400">{nota.tomador.nomeFantasia}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <InfoRow label="CNPJ/CPF"         value={nota.tomador.cpfCnpj} />
                <InfoRow label="Insc. Municipal"  value={nota.tomador.inscricaoMunicipal} />
                <InfoRow label="Insc. Estadual"   value={nota.tomador.inscricaoEstadual} />
                <InfoRow label="E-mail"            value={nota.tomador.email} />
                <InfoRow label="Telefone"          value={nota.tomador.telefone || nota.tomador.celular} />
                {nota.tomador.endereco && (
                  <div className="col-span-2">
                    <InfoRow label="Endereço" value={[nota.tomador.endereco, nota.tomador.numero, nota.tomador.complemento, nota.tomador.bairro, nota.tomador.municipio, nota.tomador.uf].filter(Boolean).join(', ')} />
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* SERVIÇO */}
          {(nota.descricao || nota.of || nota.codigoServico) && (
            <SectionCard title="SERVIÇO" icon={ClipboardList} iconColor="bg-amber-50 text-amber-600">
              <div className="space-y-3">
                {nota.descricao && (
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Descrição</p>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{nota.descricao}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <InfoRow label="OF"              value={nota.of} />
                  <InfoRow label="Cód. Serviço"    value={nota.codigoServico} />
                  {nota.quantidade && <InfoRow label="Quantidade"  value={String(nota.quantidade)} />}
                  {nota.valorUnitario && <InfoRow label="Valor Unitário" value={formatarMoeda(nota.valorUnitario)} />}
                </div>
              </div>
            </SectionCard>
          )}

          {/* Situação Fiscal (expandível) */}
          {(nota.naturezaOperacao || nota.situacaoTributariaIssqn || nota.localPrestacao || nota.regimeTributario || nota.observacoesFiscais || nota.observacoes) && (
            <div className="card overflow-hidden">
              <button className="w-full flex items-center justify-between p-5 text-left" onClick={() => setShowFiscal(f => !f)}>
                <span className="font-bold text-gray-900 text-sm">Informações Adicionais</span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${showFiscal ? 'rotate-180' : ''}`} />
              </button>
              {showFiscal && (
                <div className="px-5 pb-5 border-t border-gray-50 pt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <InfoRow label="Natureza da Operação"      value={nota.naturezaOperacao} />
                    <InfoRow label="Situação Tributária ISSQN" value={nota.situacaoTributariaIssqn} />
                    <InfoRow label="Local de Prestação"        value={nota.localPrestacao} />
                    <InfoRow label="Regime Tributário"         value={nota.regimeTributario} />
                    <InfoRow label="Indicação de Retenção"     value={nota.indicacaoRetencao} />
                    <InfoRow label="Situação NFS-e"            value={nota.situacaoNfse} />
                    <InfoRow label="Cód. Verificação"          value={nota.codigoVerificacao} />
                    <InfoRow label="Tags"                      value={nota.tags} />
                  </div>
                  {nota.observacoesFiscais && <div><p className="label">Observações Fiscais</p><p className="text-sm text-gray-700 leading-relaxed">{nota.observacoesFiscais}</p></div>}
                  {nota.observacoes && <div><p className="label">Observações</p><p className="text-sm text-gray-700 leading-relaxed">{nota.observacoes}</p></div>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── PDF Panel (desktop only) ─── */}
        {hasPdf && (
          <div className="hidden xl:flex flex-col flex-1 min-w-0 sticky top-0 border-l border-gray-100" style={{ height: '100dvh' }}>
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-red-500" />
                <span className="text-sm font-semibold text-gray-700">PDF Original</span>
              </div>
              <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <ExternalLink size={11} /> Nova aba
              </a>
            </div>
            <iframe src={pdfSrc} className="w-full flex-1 border-0" title="PDF da nota fiscal" />
          </div>
        )}
      </div>
    );
  }

  // ── EDIT MODE ──────────────────────────────────────────────────────────────
  return (
    <div className="p-5 md:p-7 max-w-2xl mx-auto space-y-5">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between pt-2 gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setEditing(false)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Editar Nota</h1>
            <p className="text-xs text-gray-400 mt-0.5">{nota.nomeOrganizador || `NF ${nota.numeroNf}`}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="btn-secondary btn-sm"><X size={14} /> Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save size={14} />{saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm"><AlertCircle size={15} />{error}</div>}

      {/* Identificação */}
      <div className="card p-5 space-y-4">
        <p className="section-title">Identificação</p>
        <div className="grid grid-cols-2 gap-4">
          <FEdit label="Nome Organizador" fkey="nomeOrganizador" source={form} setter={sf} />
          <div>
            <label className="label">Status</label>
            <select className="input" value={String(form.status || '')} onChange={e => sf('status', e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
            </select>
          </div>
          <FEdit label="Número NF" fkey="numeroNf" source={form} setter={sf} />
          <FEdit label="Número RPS" fkey="numeroRps" source={form} setter={sf} />
          <FEdit label="OF" fkey="of" source={form} setter={sf} />
          <FEdit label="Tipo" fkey="tipo" source={form} setter={sf} />
          <FEdit label="Data Emissão" fkey="dataEmissao" type="date" source={form} setter={sf} />
          <FEdit label="Data Vencimento" fkey="dataVencimento" type="date" source={form} setter={sf} />
          <FEdit label="Data Recebimento" fkey="dataRecebimento" type="date" source={form} setter={sf} />
          <FEdit label="Município Emissor" fkey="municipioEmissor" source={form} setter={sf} />
          <FEdit label="Cód. Verificação" fkey="codigoVerificacao" source={form} setter={sf} />
          <FEdit label="Tags" fkey="tags" source={form} setter={sf} />
        </div>
      </div>

      {/* Serviço */}
      <div className="card p-5 space-y-4">
        <p className="section-title">Serviço</p>
        <div>
          <label className="label">Descrição do Serviço</label>
          <textarea className="input min-h-[80px]" value={String(form.descricao ?? '')} onChange={e => sf('descricao', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FEdit label="Cód. Serviço" fkey="codigoServico" source={form} setter={sf} />
          <FEdit label="Quantidade" fkey="quantidade" type="number" source={form} setter={sf} />
          <FEdit label="Valor Unitário" fkey="valorUnitario" type="number" source={form} setter={sf} />
        </div>
        <div>
          <label className="label">Observações Fiscais</label>
          <textarea className="input min-h-[60px]" value={String(form.observacoesFiscais ?? '')} onChange={e => sf('observacoesFiscais', e.target.value)} />
        </div>
        <div>
          <label className="label">Observações Gerais</label>
          <textarea className="input min-h-[60px]" value={String(form.observacoes ?? '')} onChange={e => sf('observacoes', e.target.value)} />
        </div>
      </div>

      {/* Valores */}
      <div className="card p-5 space-y-4">
        <p className="section-title">Valores Financeiros</p>
        <div className="grid grid-cols-2 gap-4">
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
          <FEdit label="Outras Retenções" fkey="outrasRetencoes" type="number" source={form} setter={sf} />
          <FEdit label="Val. Líq. Antecipação" fkey="valorLiquidoAntecipacao" type="number" source={form} setter={sf} />
          <FEdit label="Encargos Antecipação" fkey="valorTotalTributosAntecipacao" type="number" source={form} setter={sf} />
        </div>
      </div>

      {/* Prestador */}
      <div className="card p-5 space-y-4">
        <p className="section-title">Prestador de Serviços</p>
        <div className="grid grid-cols-2 gap-4">
          <FEdit label="Razão Social" fkey="nomeRazaoSocial" source={prestador} setter={sp2} />
          <FEdit label="Nome Fantasia" fkey="nomeFantasia" source={prestador} setter={sp2} />
          <FEdit label="CNPJ/CPF" fkey="cpfCnpj" source={prestador} setter={sp2} />
          <FEdit label="Insc. Municipal" fkey="inscricaoMunicipal" source={prestador} setter={sp2} />
          <FEdit label="Insc. Estadual" fkey="inscricaoEstadual" source={prestador} setter={sp2} />
          <FEdit label="E-mail" fkey="email" type="email" source={prestador} setter={sp2} />
          <FEdit label="Telefone" fkey="telefone" source={prestador} setter={sp2} />
          <FEdit label="Celular" fkey="celular" source={prestador} setter={sp2} />
          <FEdit label="Endereço" fkey="endereco" source={prestador} setter={sp2} />
          <FEdit label="Número" fkey="numero" source={prestador} setter={sp2} />
          <FEdit label="Complemento" fkey="complemento" source={prestador} setter={sp2} />
          <FEdit label="Bairro" fkey="bairro" source={prestador} setter={sp2} />
          <FEdit label="CEP" fkey="cep" source={prestador} setter={sp2} />
          <FEdit label="Município" fkey="municipio" source={prestador} setter={sp2} />
          <FEdit label="UF" fkey="uf" source={prestador} setter={sp2} />
        </div>
      </div>

      {/* Tomador */}
      <div className="card p-5 space-y-4">
        <p className="section-title">Tomador de Serviços</p>
        <div className="grid grid-cols-2 gap-4">
          <FEdit label="Razão Social" fkey="nomeRazaoSocial" source={tomador} setter={st} />
          <FEdit label="Nome Fantasia" fkey="nomeFantasia" source={tomador} setter={st} />
          <FEdit label="CNPJ/CPF" fkey="cpfCnpj" source={tomador} setter={st} />
          <FEdit label="Insc. Municipal" fkey="inscricaoMunicipal" source={tomador} setter={st} />
          <FEdit label="Insc. Estadual" fkey="inscricaoEstadual" source={tomador} setter={st} />
          <FEdit label="E-mail" fkey="email" type="email" source={tomador} setter={st} />
          <FEdit label="Telefone" fkey="telefone" source={tomador} setter={st} />
          <FEdit label="Celular" fkey="celular" source={tomador} setter={st} />
          <FEdit label="Endereço" fkey="endereco" source={tomador} setter={st} />
          <FEdit label="Número" fkey="numero" source={tomador} setter={st} />
          <FEdit label="Complemento" fkey="complemento" source={tomador} setter={st} />
          <FEdit label="Bairro" fkey="bairro" source={tomador} setter={st} />
          <FEdit label="CEP" fkey="cep" source={tomador} setter={st} />
          <FEdit label="Município" fkey="municipio" source={tomador} setter={st} />
          <FEdit label="UF" fkey="uf" source={tomador} setter={st} />
        </div>
      </div>

      {/* Situação Fiscal */}
      <div className="card p-5 space-y-4">
        <p className="section-title">Situação Fiscal</p>
        <div className="grid grid-cols-2 gap-4">
          <FEdit label="Natureza da Operação" fkey="naturezaOperacao" source={form} setter={sf} />
          <FEdit label="Sit. Tributária ISSQN" fkey="situacaoTributariaIssqn" source={form} setter={sf} />
          <FEdit label="Local de Prestação" fkey="localPrestacao" source={form} setter={sf} />
          <FEdit label="Regime Tributário" fkey="regimeTributario" source={form} setter={sf} />
          <FEdit label="Indicação de Retenção" fkey="indicacaoRetencao" source={form} setter={sf} />
          <FEdit label="Situação NFS-e" fkey="situacaoNfse" source={form} setter={sf} />
        </div>
      </div>

      {/* Save button bottom */}
      <div className="flex gap-3 pb-6">
        <button onClick={() => setEditing(false)} className="btn-secondary flex-1"><X size={14} /> Cancelar</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center">
          <Save size={14} />{saving ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
}
