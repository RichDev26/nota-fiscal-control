'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, FileText, Pencil, ChevronRight, CheckCircle,
  Loader2, AlertCircle, Sparkles, ArrowLeft, X,
} from 'lucide-react';
import { formatarMoeda } from '@/lib/validators';
import type { PdfExtractResult } from '@/types';

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Mode = null | 'pdf' | 'manual';
type PdfStep = 'upload' | 'extracting' | 'nome' | 'sucesso';
type ManualStep = 'dados' | 'nome' | 'sucesso';

const fmt = (v: unknown) => (v != null ? String(v) : '');
const brl = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (isNaN(n)) return '';
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
};

// ─── Animated check item ──────────────────────────────────────────────────────
function CheckItem({ label, delay }: { label: string; delay: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div className={`flex items-center gap-3 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors duration-300 ${visible ? 'bg-green-100' : 'bg-gray-100'}`}>
        {visible
          ? <CheckCircle size={14} className="text-green-600" />
          : <div className="w-3 h-3 rounded-full bg-gray-200" />}
      </div>
      <span className={`text-sm font-medium transition-colors duration-300 ${visible ? 'text-gray-800' : 'text-gray-300'}`}>{label}</span>
    </div>
  );
}

// ─── Wrapper centrado ─────────────────────────────────────────────────────────
function Shell({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-5 py-10">
      {onBack && (
        <div className="w-full max-w-sm mb-4">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 font-semibold transition-colors">
            <ArrowLeft size={14} /> Voltar
          </button>
        </div>
      )}
      <div className="w-full max-w-sm animate-enter">{children}</div>
    </div>
  );
}

// ─── Botão grande ─────────────────────────────────────────────────────────────
function BigBtn({ onClick, disabled, loading, variant = 'primary', children }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  variant?: 'primary' | 'secondary'; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-base font-bold transition-all active:scale-[0.98] ${
        variant === 'primary'
          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 disabled:shadow-none'
          : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function NovaNotaPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode]       = useState<Mode>(null);
  const [pdfStep, setPdfStep] = useState<PdfStep>('upload');
  const [manualStep, setManualStep] = useState<ManualStep>('dados');

  const [pdfFile, setPdfFile]   = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extracted, setExtracted] = useState<PdfExtractResult | null>(null);
  const [pdfTempId, setPdfTempId] = useState('');
  const [savedId, setSavedId]   = useState('');

  const [form, setForm] = useState<Record<string, string>>({ status: 'lancada', tipo: 'NFS-e' });
  const [prestador, setPrestador] = useState<Record<string, string>>({});
  const [tomador, setTomador]     = useState<Record<string, string>>({});
  const [nome, setNome]           = useState('');

  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');

  const sf = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // auto-gera nome sugerido
  const nomeSugerido = (() => {
    const nf = form.numeroNf || '';
    const tNome = (tomador.nomeRazaoSocial || tomador.nomeFantasia || '')
      .replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI)\.?$/i, '').trim().slice(0, 30);
    if (nf && tNome) return `NF ${nf} – ${tNome}`;
    if (nf) return `NF ${nf}`;
    if (tNome) return tNome;
    return '';
  })();

  const handleFileSelect = (f: File | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf') { setExtractError('Selecione um arquivo PDF.'); return; }
    setPdfFile(f);
    setExtractError('');
  };

  // ── Extração PDF ────────────────────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!pdfFile) return;
    setPdfStep('extracting');
    setExtractError('');
    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      const res  = await fetch('/api/pdf-extract', { method: 'POST', body: fd });
      const data: PdfExtractResult & { pdfTempId?: string; error?: string; bloqueado?: boolean } = await res.json();

      if (data.error) { setExtractError(data.error); setPdfStep('upload'); return; }

      setPdfTempId(data.pdfTempId || '');
      setExtracted(data);
      setForm({
        status: 'lancada', tipo: data.tipo || 'NFS-e',
        numeroNf: fmt(data.numeroNf), numeroRps: fmt(data.numeroRps),
        codigoVerificacao: fmt(data.codigoVerificacao), of: fmt(data.of),
        dataEmissao: fmt(data.dataEmissao), dataFatoGerador: fmt(data.dataFatoGerador),
        municipioEmissor: fmt(data.municipioEmissor), codigoServico: fmt(data.codigoServico),
        descricao: fmt(data.descricao), quantidade: fmt(data.quantidade),
        valorUnitario: fmt(data.valorUnitario), valorBruto: fmt(data.valorBruto),
        valorLiquido: fmt(data.valorLiquido), baseCalculo: fmt(data.baseCalculo),
        aliquota: fmt(data.aliquota), valorIss: fmt(data.valorIss),
        ir: fmt(data.ir), pisPasep: fmt(data.pisPasep), cofins: fmt(data.cofins),
        inss: fmt(data.inss), csll: fmt(data.csll), outrasRetencoes: fmt(data.outrasRetencoes),
        valorAproximadoTributos: fmt(data.valorAproximadoTributos),
        naturezaOperacao: fmt(data.naturezaOperacao), situacaoTributariaIssqn: fmt(data.situacaoTributariaIssqn),
        localPrestacao: fmt(data.localPrestacao), situacaoNfse: fmt(data.situacaoNfse),
        regimeTributario: fmt(data.regimeTributario), indicacaoRetencao: fmt(data.indicacaoRetencao),
        observacoesFiscais: fmt(data.observacoesFiscais), observacoesAutenticidade: fmt(data.observacoesAutenticidade),
        observacoes: '', tags: '', dataVencimento: '', dataRecebimento: '',
        nomeOrganizador: '',
      });
      if (data.prestador) setPrestador(Object.fromEntries(Object.entries(data.prestador).map(([k, v]) => [k, fmt(v)])));
      if (data.tomador)   setTomador(Object.fromEntries(Object.entries(data.tomador).map(([k, v]) => [k, fmt(v)])));

      // aguarda animação dos checks (2.5s) e avança
      setTimeout(() => setPdfStep('nome'), 2800);
    } catch {
      setExtractError('Erro ao processar o PDF. Tente novamente.');
      setPdfStep('upload');
    }
  }, [pdfFile]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true); setSaveError('');
    const nomeOrganizador = (nome.trim() || nomeSugerido || 'Nota sem nome');
    try {
      const payload = {
        ...form,
        nomeOrganizador,
        pdfTempId: pdfTempId || undefined,
        prestador: Object.values(prestador).some(Boolean) ? prestador : undefined,
        tomador:   Object.values(tomador).some(Boolean)   ? tomador   : undefined,
      };
      const res  = await fetch('/api/notas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.detail || data.error || 'Erro ao salvar.'); return; }
      setSavedId(data.nota.id);
      if (mode === 'pdf') setPdfStep('sucesso');
      else setManualStep('sucesso');
    } catch {
      setSaveError('Erro ao salvar nota.');
    } finally {
      setSaving(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TELA INICIAL — escolha do modo
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === null) {
    return (
      <Shell>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Nova Nota Fiscal</h1>
          <p className="text-gray-400 mt-2">Como deseja lançar sua nota?</p>
        </div>

        <div className="space-y-3">
          {/* PDF */}
          <button
            onClick={() => setMode('pdf')}
            className="w-full text-left p-6 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/30 transition-all group shadow-sm active:scale-[0.98]"
          >
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-red-50 group-hover:bg-red-100 rounded-2xl flex items-center justify-center transition-colors shrink-0">
                <Upload size={24} className="text-red-500" />
              </div>
              <div className="pt-1">
                <p className="font-bold text-gray-900 text-base">Carregar PDF</p>
                <p className="text-sm text-gray-400 mt-0.5 leading-snug">
                  Envie a nota fiscal e o sistema<br />preenche tudo automaticamente
                </p>
              </div>
              <ChevronRight size={18} className="text-gray-300 ml-auto shrink-0 mt-3 group-hover:text-blue-400 transition-colors" />
            </div>
          </button>

          {/* Manual */}
          <button
            onClick={() => setMode('manual')}
            className="w-full text-left p-6 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/30 transition-all group shadow-sm active:scale-[0.98]"
          >
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-blue-50 group-hover:bg-blue-100 rounded-2xl flex items-center justify-center transition-colors shrink-0">
                <Pencil size={22} className="text-blue-500" />
              </div>
              <div className="pt-1">
                <p className="font-bold text-gray-900 text-base">Preencher Manualmente</p>
                <p className="text-sm text-gray-400 mt-0.5 leading-snug">
                  Cadastrar os dados da nota<br />digitando manualmente
                </p>
              </div>
              <ChevronRight size={18} className="text-gray-300 ml-auto shrink-0 mt-3 group-hover:text-blue-400 transition-colors" />
            </div>
          </button>
        </div>

        <div className="text-center mt-6">
          <button onClick={() => router.push('/notas')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            ← Voltar para as notas
          </button>
        </div>
      </Shell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUXO PDF — Etapa 1: Upload
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'pdf' && pdfStep === 'upload') {
    return (
      <Shell onBack={() => { setMode(null); setPdfFile(null); setExtractError(''); }}>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Envie sua nota fiscal</h1>
          <p className="text-gray-400 mt-1 text-sm">Arraste o PDF ou clique para selecionar</p>
        </div>

        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={e => handleFileSelect(e.target.files?.[0] ?? null)} />

        <div
          className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer mb-5 ${
            isDragging  ? 'border-blue-500 bg-blue-50 scale-[1.01]' :
            pdfFile     ? 'border-green-400 bg-green-50' :
            'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault(); setIsDragging(false);
            handleFileSelect(e.dataTransfer.files[0] ?? null);
          }}
        >
          {pdfFile ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center">
                <FileText size={26} className="text-green-600" />
              </div>
              <p className="font-bold text-green-800 text-sm mt-1 max-w-[200px] truncate">{pdfFile.name}</p>
              <p className="text-xs text-green-600">{(pdfFile.size / 1024).toFixed(0)} KB · Pronto</p>
              <button
                className="text-xs text-gray-400 hover:text-red-500 mt-1 flex items-center gap-1"
                onClick={e => { e.stopPropagation(); setPdfFile(null); }}
              >
                <X size={12} /> Remover
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
                <Upload size={24} className="text-gray-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-600">Arraste o PDF aqui</p>
                <p className="text-sm text-gray-400 mt-0.5">ou clique para selecionar</p>
              </div>
            </div>
          )}
        </div>

        {extractError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm mb-4">
            <AlertCircle size={15} className="shrink-0" /> {extractError}
          </div>
        )}

        <BigBtn onClick={handleExtract} disabled={!pdfFile}>
          Continuar →
        </BigBtn>
      </Shell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUXO PDF — Etapa 2: Analisando
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'pdf' && pdfStep === 'extracting') {
    const checks = [
      { label: 'Número da nota encontrado',  delay: 400  },
      { label: 'Prestador encontrado',        delay: 900  },
      { label: 'Tomador encontrado',          delay: 1400 },
      { label: 'Valores encontrados',         delay: 1900 },
      { label: 'Dados validados',             delay: 2400 },
    ];
    return (
      <Shell>
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Sparkles size={28} className="text-blue-600 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Analisando sua nota...</h1>
          <p className="text-gray-400 mt-1 text-sm">Aguarde enquanto extraímos os dados</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          {checks.map(c => <CheckItem key={c.label} label={c.label} delay={c.delay} />)}
        </div>
      </Shell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUXO PDF — Etapa 3: Nome
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'pdf' && pdfStep === 'nome') {
    const tomadorNome = tomador.nomeRazaoSocial || tomador.nomeFantasia || '';

    return (
      <Shell onBack={() => setPdfStep('upload')}>
        {/* Resumo extraído */}
        {extracted && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-6 space-y-2.5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={15} className="text-green-500" />
              <span className="text-sm font-bold text-green-700">Nota analisada com sucesso</span>
            </div>
            {form.numeroNf && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Número NF</span>
                <span className="font-semibold text-gray-800">{form.numeroNf}</span>
              </div>
            )}
            {form.valorBruto && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Valor Bruto</span>
                <span className="font-bold text-gray-900">{brl(form.valorBruto)}</span>
              </div>
            )}
            {tomadorNome && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Tomador</span>
                <span className="font-semibold text-gray-800 text-right max-w-[170px] truncate">{tomadorNome}</span>
              </div>
            )}
          </div>
        )}

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Como identificar esta nota?</h1>
          <p className="text-gray-400 text-sm">Dê um nome fácil de reconhecer</p>
        </div>

        <div className="mb-6">
          <input
            type="text"
            className="input text-base py-3.5 text-center rounded-2xl"
            placeholder={nomeSugerido || 'Ex: Instalação Tanques Seara'}
            value={nome}
            onChange={e => setNome(e.target.value)}
            autoFocus
          />
          {nomeSugerido && !nome && (
            <button
              className="mt-2 text-xs text-blue-600 hover:underline w-full text-center"
              onClick={() => setNome(nomeSugerido)}
            >
              Usar sugestão: &quot;{nomeSugerido}&quot;
            </button>
          )}
        </div>

        {saveError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm mb-4">
            <AlertCircle size={15} className="shrink-0" /> {saveError}
          </div>
        )}

        <BigBtn onClick={handleSave} loading={saving}>
          {saving ? 'Salvando...' : 'Salvar Nota →'}
        </BigBtn>
      </Shell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUXO PDF — Etapa 4: Sucesso
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'pdf' && pdfStep === 'sucesso') {
    const tomadorNome = tomador.nomeRazaoSocial || tomador.nomeFantasia || '';
    return (
      <Shell>
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Nota salva!</h1>
          <p className="text-gray-400 mt-1 text-sm">Tudo pronto, sem complicação</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 space-y-3">
          {form.numeroNf && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Número</p>
              <p className="font-bold text-gray-900 text-lg">NF {form.numeroNf}</p>
            </div>
          )}
          {form.valorBruto && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Valor</p>
              <p className="font-bold text-gray-900 text-xl text-green-700">{brl(form.valorBruto)}</p>
            </div>
          )}
          {tomadorNome && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Cliente</p>
              <p className="font-semibold text-gray-800">{tomadorNome}</p>
            </div>
          )}
          {(nome || nomeSugerido) && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Nome da nota</p>
              <p className="font-semibold text-gray-800">{nome || nomeSugerido}</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <BigBtn onClick={() => router.push(`/notas/${savedId}`)}>
            Ver Nota →
          </BigBtn>
          <BigBtn variant="secondary" onClick={() => {
            setMode(null); setPdfStep('upload'); setPdfFile(null);
            setExtracted(null); setNome(''); setPdfTempId('');
            setForm({ status: 'lancada', tipo: 'NFS-e' });
            setPrestador({}); setTomador({});
          }}>
            + Nova Nota
          </BigBtn>
        </div>
      </Shell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUXO MANUAL — Etapa 1: Dados básicos
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'manual' && manualStep === 'dados') {
    return (
      <Shell onBack={() => setMode(null)}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dados da Nota</h1>
          <p className="text-gray-400 mt-1 text-sm">Preencha as informações principais</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 mb-5">
          <div>
            <label className="label">Número NF</label>
            <input className="input" placeholder="187" value={form.numeroNf || ''} onChange={e => sf('numeroNf', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Data Emissão</label>
              <input type="date" className="input" value={form.dataEmissao || ''} onChange={e => sf('dataEmissao', e.target.value)} />
            </div>
            <div>
              <label className="label">Vencimento</label>
              <input type="date" className="input" value={form.dataVencimento || ''} onChange={e => sf('dataVencimento', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Valor Bruto</label>
              <input type="number" step="0.01" className="input" placeholder="50000.00" value={form.valorBruto || ''} onChange={e => sf('valorBruto', e.target.value)} />
            </div>
            <div>
              <label className="label">Valor Líquido</label>
              <input type="number" step="0.01" className="input" placeholder="47500.00" value={form.valorLiquido || ''} onChange={e => sf('valorLiquido', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 mb-5">
          <p className="font-bold text-gray-700 text-sm">Prestador</p>
          <div>
            <label className="label">Razão Social</label>
            <input className="input" placeholder="JM Inox Manutenção Industrial" value={prestador.nomeRazaoSocial || ''} onChange={e => setPrestador(p => ({ ...p, nomeRazaoSocial: e.target.value }))} />
          </div>
          <div>
            <label className="label">CNPJ/CPF</label>
            <input className="input" placeholder="49.521.060/0001-49" value={prestador.cpfCnpj || ''} onChange={e => setPrestador(p => ({ ...p, cpfCnpj: e.target.value }))} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 mb-6">
          <p className="font-bold text-gray-700 text-sm">Tomador</p>
          <div>
            <label className="label">Razão Social</label>
            <input className="input" placeholder="Seara Alimentos Ltda" value={tomador.nomeRazaoSocial || ''} onChange={e => setTomador(p => ({ ...p, nomeRazaoSocial: e.target.value }))} />
          </div>
          <div>
            <label className="label">CNPJ/CPF</label>
            <input className="input" placeholder="02.914.460/0061-91" value={tomador.cpfCnpj || ''} onChange={e => setTomador(p => ({ ...p, cpfCnpj: e.target.value }))} />
          </div>
          <div>
            <label className="label">Descrição do Serviço</label>
            <textarea className="input min-h-[70px]" placeholder="Instalação dos tanques de salmoura" value={form.descricao || ''} onChange={e => sf('descricao', e.target.value)} />
          </div>
          <div>
            <label className="label">OF (opcional)</label>
            <input className="input" placeholder="6866682" value={form.of || ''} onChange={e => sf('of', e.target.value)} />
          </div>
        </div>

        <BigBtn onClick={() => setManualStep('nome')}>
          Continuar →
        </BigBtn>
      </Shell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUXO MANUAL — Etapa 2: Nome
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'manual' && manualStep === 'nome') {
    return (
      <Shell onBack={() => setManualStep('dados')}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Como identificar esta nota?</h1>
          <p className="text-gray-400 mt-1 text-sm">Dê um nome fácil de reconhecer</p>
        </div>

        <div className="mb-6">
          <input
            type="text"
            className="input text-base py-3.5 text-center rounded-2xl"
            placeholder={nomeSugerido || 'Ex: Instalação Tanques Seara'}
            value={nome}
            onChange={e => setNome(e.target.value)}
            autoFocus
          />
          {nomeSugerido && !nome && (
            <button
              className="mt-2 text-xs text-blue-600 hover:underline w-full text-center"
              onClick={() => setNome(nomeSugerido)}
            >
              Usar sugestão: &quot;{nomeSugerido}&quot;
            </button>
          )}
        </div>

        {saveError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm mb-4">
            <AlertCircle size={15} className="shrink-0" /> {saveError}
          </div>
        )}

        <BigBtn onClick={handleSave} loading={saving}>
          {saving ? 'Salvando...' : 'Salvar Nota →'}
        </BigBtn>
      </Shell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUXO MANUAL — Sucesso
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'manual' && manualStep === 'sucesso') {
    const tomadorNome = tomador.nomeRazaoSocial || tomador.nomeFantasia || '';
    return (
      <Shell>
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Nota salva!</h1>
          <p className="text-gray-400 mt-1 text-sm">Tudo pronto, sem complicação</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 space-y-3">
          {form.numeroNf && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Número</p>
              <p className="font-bold text-gray-900 text-lg">NF {form.numeroNf}</p>
            </div>
          )}
          {form.valorBruto && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Valor</p>
              <p className="font-bold text-xl text-green-700">{brl(form.valorBruto)}</p>
            </div>
          )}
          {tomadorNome && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Cliente</p>
              <p className="font-semibold text-gray-800">{tomadorNome}</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <BigBtn onClick={() => router.push(`/notas/${savedId}`)}>
            Ver Nota →
          </BigBtn>
          <BigBtn variant="secondary" onClick={() => {
            setMode(null); setManualStep('dados'); setNome('');
            setForm({ status: 'lancada', tipo: 'NFS-e' }); setPrestador({}); setTomador({});
          }}>
            + Nova Nota
          </BigBtn>
        </div>
      </Shell>
    );
  }

  return null;
}
