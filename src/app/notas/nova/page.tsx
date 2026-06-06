'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, FileText, Pencil, ChevronRight, ChevronLeft,
  Loader2, CheckCircle, Save, Sparkles, AlertCircle,
  Building2, DollarSign, Tag, ClipboardCheck,
} from 'lucide-react';
import type { PdfExtractResult } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = null | 'pdf' | 'manual';
type PdfStep   = 'upload' | 'extracting' | 'check' | 'nome' | 'confirmar';
type ManualStep = 'basicos' | 'partes' | 'valores' | 'nome' | 'confirmar';

const STATUS_OPTS = [
  { v: 'lancada',   l: 'Lançada' },
  { v: 'recebida',  l: 'Recebida' },
  { v: 'rascunho',  l: 'Rascunho' },
  { v: 'incompleta',l: 'Incompleta' },
  { v: 'antecipada',l: 'Antecipada' },
];

const fmt = (v: unknown) => (v != null && v !== undefined ? String(v) : '');
const brl = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (isNaN(n)) return '';
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
};
const dataBR = (v: string) => {
  if (!v) return '';
  try { return new Date(v + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return v; }
};

// PDF step → número visual
const PDF_STEP_NUM: Record<PdfStep, number> = {
  upload: 1, extracting: 2, check: 3, nome: 4, confirmar: 5,
};
// Manual step → número visual
const MANUAL_STEP_NUM: Record<ManualStep, number> = {
  basicos: 1, partes: 2, valores: 3, nome: 4, confirmar: 5,
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function NovaNotaPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode]           = useState<Mode>(null);
  const [pdfStep, setPdfStep]     = useState<PdfStep>('upload');
  const [manualStep, setManualStep] = useState<ManualStep>('basicos');

  const [pdfFile, setPdfFile]     = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extracted, setExtracted] = useState<PdfExtractResult | null>(null);
  const [pdfData, setPdfData]     = useState('');

  const [form, setForm]           = useState<Record<string, string>>({ status: 'lancada', tipo: 'NFS-e' });
  const [prestador, setPrestador] = useState<Record<string, string>>({});
  const [tomador, setTomador]     = useState<Record<string, string>>({});

  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');

  const sf  = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const sp  = (k: string, v: string) => setPrestador(p => ({ ...p, [k]: v }));
  const st  = (k: string, v: string) => setTomador(p => ({ ...p, [k]: v }));

  // ── Auto-gera nome sugerido ─────────────────────────────────────────────────
  const nomeSugerido = (() => {
    const nf = form.numeroNf || '';
    const tNome = (tomador.nomeRazaoSocial || tomador.nomeFantasia || '').replace(/\s+(Ltda\.?|S\.A\.?|ME\.?)$/i, '').trim().slice(0, 30);
    if (nf && tNome) return `NF ${nf} – ${tNome}`;
    if (nf) return `NF ${nf}`;
    if (tNome) return tNome;
    return '';
  })();

  // ── PDF extraction ──────────────────────────────────────────────────────────
  const handleExtract = async () => {
    if (!pdfFile) return;
    setPdfStep('extracting');
    setExtractError('');
    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      const res = await fetch('/api/pdf-extract', { method: 'POST', body: fd });
      const data: PdfExtractResult & { pdfData?: string; error?: string } = await res.json();

      if (data.error) { setExtractError(data.error); setPdfStep('upload'); return; }

      setPdfData(data.pdfData || '');
      setExtracted(data);

      setForm({
        status:               'lancada',
        tipo:                 data.tipo || 'NFS-e',
        nomeOrganizador:      fmt(data.nomeOrganizador),
        numeroNf:             fmt(data.numeroNf),
        numeroRps:            fmt(data.numeroRps),
        codigoVerificacao:    fmt(data.codigoVerificacao),
        of:                   fmt(data.of),
        dataEmissao:          fmt(data.dataEmissao),
        dataFatoGerador:      fmt(data.dataFatoGerador),
        municipioEmissor:     fmt(data.municipioEmissor),
        codigoServico:        fmt(data.codigoServico),
        descricao:            fmt(data.descricao),
        quantidade:           fmt(data.quantidade),
        valorUnitario:        fmt(data.valorUnitario),
        valorBruto:           fmt(data.valorBruto),
        valorLiquido:         fmt(data.valorLiquido),
        baseCalculo:          fmt(data.baseCalculo),
        aliquota:             fmt(data.aliquota),
        valorIss:             fmt(data.valorIss),
        ir:                   fmt(data.ir),
        pisPasep:             fmt(data.pisPasep),
        cofins:               fmt(data.cofins),
        inss:                 fmt(data.inss),
        csll:                 fmt(data.csll),
        outrasRetencoes:      fmt(data.outrasRetencoes),
        valorAproximadoTributos: fmt(data.valorAproximadoTributos),
        naturezaOperacao:     fmt(data.naturezaOperacao),
        situacaoTributariaIssqn: fmt(data.situacaoTributariaIssqn),
        localPrestacao:       fmt(data.localPrestacao),
        situacaoNfse:         fmt(data.situacaoNfse),
        regimeTributario:     fmt(data.regimeTributario),
        indicacaoRetencao:    fmt(data.indicacaoRetencao),
        observacoesFiscais:   fmt(data.observacoesFiscais),
        observacoesAutenticidade: fmt(data.observacoesAutenticidade),
        observacoes: '',
        tags: '',
        dataVencimento: '',
        dataRecebimento: '',
      });

      if (data.prestador) {
        setPrestador(Object.fromEntries(Object.entries(data.prestador).map(([k, v]) => [k, fmt(v)])));
      }
      if (data.tomador) {
        setTomador(Object.fromEntries(Object.entries(data.tomador).map(([k, v]) => [k, fmt(v)])));
      }

      setPdfStep('check');
    } catch {
      setExtractError('Erro ao processar o PDF. Tente novamente.');
      setPdfStep('upload');
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true); setSaveError('');
    const nome = form.nomeOrganizador?.trim() || nomeSugerido || 'Nota sem nome';
    try {
      const payload = {
        ...form,
        nomeOrganizador: nome,
        pdfData: pdfData || undefined,
        prestador: Object.values(prestador).some(Boolean) ? prestador : undefined,
        tomador:   Object.values(tomador).some(Boolean)   ? tomador   : undefined,
      };
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.detail || data.error || 'Erro ao salvar.'); return; }
      router.push(`/notas/${data.nota.id}`);
    } catch {
      setSaveError('Erro ao salvar nota.');
    } finally {
      setSaving(false);
    }
  };

  // ── Tela inicial — escolha do modo ─────────────────────────────────────────
  if (mode === null) {
    return (
      <Centered>
        <div className="animate-enter w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
              <FileText size={26} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Nova Nota Fiscal</h1>
            <p className="text-gray-400 mt-1 text-sm">Como deseja lançar esta nota?</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setMode('pdf')}
              className="w-full flex items-center gap-4 p-5 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/40 transition-all group shadow-sm text-left"
            >
              <div className="w-12 h-12 bg-red-50 group-hover:bg-red-100 rounded-xl flex items-center justify-center transition-colors shrink-0">
                <Upload size={22} className="text-red-500" />
              </div>
              <div>
                <p className="font-bold text-gray-800">Carregar PDF</p>
                <p className="text-sm text-gray-400 mt-0.5">Sistema preenche os dados automaticamente</p>
              </div>
              <ChevronRight size={18} className="text-gray-300 ml-auto shrink-0" />
            </button>

            <button
              onClick={() => setMode('manual')}
              className="w-full flex items-center gap-4 p-5 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/40 transition-all group shadow-sm text-left"
            >
              <div className="w-12 h-12 bg-blue-50 group-hover:bg-blue-100 rounded-xl flex items-center justify-center transition-colors shrink-0">
                <Pencil size={22} className="text-blue-500" />
              </div>
              <div>
                <p className="font-bold text-gray-800">Preencher Manualmente</p>
                <p className="text-sm text-gray-400 mt-0.5">Digitar os dados da nota</p>
              </div>
              <ChevronRight size={18} className="text-gray-300 ml-auto shrink-0" />
            </button>
          </div>

          <div className="text-center mt-7">
            <button onClick={() => router.push('/notas')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← Voltar para a lista
            </button>
          </div>
        </div>
      </Centered>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // FLUXO PDF
  // ══════════════════════════════════════════════════════════════════════════════

  // PDF — Etapa 1: Upload
  if (mode === 'pdf' && pdfStep === 'upload') {
    return (
      <Wizard title="Carregar PDF da nota" icon={<Upload size={18} className="text-red-500" />}
        step={1} total={5}
        onBack={() => { setMode(null); setPdfFile(null); setExtractError(''); }}
        onNext={pdfFile ? handleExtract : undefined}
        nextLabel="Continuar"
        nextDisabled={!pdfFile}
      >
        {extractError && <Alert type="error" message={extractError} className="mb-4" />}

        <div
          className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer select-none ${
            isDragging ? 'border-blue-500 bg-blue-50'
            : pdfFile  ? 'border-green-400 bg-green-50'
            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault(); setIsDragging(false);
            const f = e.dataTransfer.files[0];
            if (f?.name.toLowerCase().endsWith('.pdf')) setPdfFile(f);
          }}
        >
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }} />

          {pdfFile ? (
            <>
              <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <CheckCircle size={28} className="text-green-600" />
              </div>
              <p className="font-semibold text-green-800">{pdfFile.name}</p>
              <p className="text-sm text-green-600 mt-1">{(pdfFile.size / 1024).toFixed(0)} KB • Pronto para enviar</p>
              <button className="text-xs text-gray-400 hover:text-gray-600 mt-3 underline" onClick={e => { e.stopPropagation(); setPdfFile(null); }}>
                Trocar arquivo
              </button>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Upload size={26} className="text-red-400" />
              </div>
              <p className="font-semibold text-gray-700">Clique ou arraste o PDF aqui</p>
              <p className="text-sm text-gray-400 mt-1">Arquivos .pdf até 10 MB</p>
            </>
          )}
        </div>
      </Wizard>
    );
  }

  // PDF — Etapa 2: Extraindo
  if (mode === 'pdf' && pdfStep === 'extracting') {
    return (
      <Centered>
        <div className="animate-enter flex flex-col items-center gap-6 max-w-sm text-center">
          <div className="relative w-20 h-20">
            <div className="w-20 h-20 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles size={22} className="text-blue-600" />
            </div>
          </div>
          <div>
            <p className="text-xl font-bold text-gray-900">Lendo o PDF…</p>
            <p className="text-sm text-gray-400 mt-1.5">Identificando campos automaticamente.<br />Isso leva apenas alguns segundos.</p>
          </div>
          <div className="flex gap-1 mt-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </Centered>
    );
  }

  // PDF — Etapa 3: Conferir dados que precisam de atenção
  if (mode === 'pdf' && pdfStep === 'check') {
    const missing = extracted?.camposNaoEncontrados || [];
    const issues  = extracted?.inconsistencias || [];

    // Campos preenchidos automaticamente para mostrar no resumo
    const autoFilled = [
      form.numeroNf         && { label: 'Número NF',          value: form.numeroNf },
      form.dataEmissao      && { label: 'Data de Emissão',     value: dataBR(form.dataEmissao) },
      form.valorBruto       && { label: 'Valor Bruto',         value: brl(form.valorBruto) },
      form.valorLiquido     && { label: 'Valor Líquido',       value: brl(form.valorLiquido) },
      form.codigoVerificacao && { label: 'Cód. Verificação',   value: form.codigoVerificacao },
      form.municipioEmissor && { label: 'Município',           value: form.municipioEmissor },
      tomador.nomeRazaoSocial && { label: 'Tomador',           value: tomador.nomeRazaoSocial },
      prestador.nomeRazaoSocial && { label: 'Prestador',       value: prestador.nomeRazaoSocial },
    ].filter(Boolean) as { label: string; value: string }[];

    return (
      <Wizard title="Confirme os dados" icon={<ClipboardCheck size={18} className="text-blue-500" />}
        step={3} total={5}
        onBack={() => setPdfStep('upload')}
        onNext={() => { if (!form.nomeOrganizador) sf('nomeOrganizador', nomeSugerido); setPdfStep('nome'); }}
        nextLabel="Continuar"
      >
        {/* Preenchido automaticamente */}
        {autoFilled.length > 0 && (
          <div className="bg-green-50 rounded-xl p-4 mb-5">
            <div className="flex items-center gap-1.5 mb-3">
              <Sparkles size={13} className="text-green-600" />
              <p className="text-xs font-bold text-green-700 uppercase tracking-wide">Preenchido automaticamente</p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {autoFilled.map(f => (
                <div key={f.label} className="flex items-center gap-1.5 min-w-0">
                  <CheckCircle size={11} className="text-green-500 shrink-0" />
                  <span className="text-xs text-gray-600 truncate"><span className="text-gray-400">{f.label}:</span> <span className="font-semibold">{f.value}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Campos que precisam de atenção */}
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Precisa da sua atenção</p>

            <Field label="Data de Vencimento">
              <input type="date" className="input" value={form.dataVencimento || ''}
                onChange={e => sf('dataVencimento', e.target.value)} />
            </Field>
          </div>

          <Field label="Status da Nota">
            <select className="input" value={form.status || 'lancada'} onChange={e => sf('status', e.target.value)}>
              {STATUS_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>

          {/* Avisos de campos não encontrados */}
          {missing.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-700">Não encontrado no PDF</p>
                <p className="text-xs text-amber-600 mt-0.5">{missing.join(', ')} — você pode preencher depois de salvar.</p>
              </div>
            </div>
          )}

          {issues.length > 0 && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-600">{issues[0]}</p>
            </div>
          )}
        </div>
      </Wizard>
    );
  }

  // PDF — Etapa 4: Nome da nota
  if (mode === 'pdf' && pdfStep === 'nome') {
    const sugestao = nomeSugerido;
    return (
      <Wizard title="Nome da nota" icon={<Tag size={18} className="text-purple-500" />}
        step={4} total={5}
        onBack={() => setPdfStep('check')}
        onNext={() => setPdfStep('confirmar')}
        nextLabel="Continuar"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Como quer chamar esta nota?
            </label>
            <input
              type="text"
              className="input text-base py-3 font-medium"
              placeholder={sugestao || 'Ex: NF 187 – Instalação de tanques'}
              value={form.nomeOrganizador || ''}
              onChange={e => sf('nomeOrganizador', e.target.value)}
              autoFocus
            />
            {sugestao && !form.nomeOrganizador && (
              <button
                className="mt-2 text-xs text-blue-600 hover:underline"
                onClick={() => sf('nomeOrganizador', sugestao)}
              >
                Usar sugestão: &quot;{sugestao}&quot;
              </button>
            )}
            <p className="text-xs text-gray-400 mt-2">Este nome aparece na lista de notas para facilitar a busca.</p>
          </div>
        </div>
      </Wizard>
    );
  }

  // PDF — Etapa 5: Confirmar e salvar
  if (mode === 'pdf' && pdfStep === 'confirmar') {
    const nome = form.nomeOrganizador?.trim() || nomeSugerido || 'Nota sem nome';
    const ret = [
      { label: 'PIS/PASEP', value: form.pisPasep },
      { label: 'COFINS',    value: form.cofins },
      { label: 'INSS',      value: form.inss },
      { label: 'IR',        value: form.ir },
      { label: 'CSLL',      value: form.csll },
    ].filter(r => r.value && parseFloat(r.value) > 0);

    return (
      <Wizard title="Tudo pronto!" icon={<CheckCircle size={18} className="text-green-500" />}
        step={5} total={5}
        onBack={() => setPdfStep('nome')}
        onNext={handleSave}
        nextLabel={saving ? 'Salvando...' : 'Salvar Nota'}
        nextDisabled={saving}
        isSave
        saveError={saveError}
      >
        <div className="space-y-3">
          {/* Nome */}
          <div className="bg-blue-50 rounded-xl px-4 py-3 flex items-center gap-3">
            <Tag size={16} className="text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-blue-400 font-medium">Nome da nota</p>
              <p className="font-bold text-blue-900 text-sm">{nome}</p>
            </div>
          </div>

          {/* Resumo rápido */}
          <SummaryBlock title="Identificação">
            {form.numeroNf      && <SRow label="NF Nº"       value={form.numeroNf} />}
            {form.tipo          && <SRow label="Tipo"        value={form.tipo} />}
            {form.dataEmissao   && <SRow label="Emissão"     value={dataBR(form.dataEmissao)} />}
            {form.dataVencimento && <SRow label="Vencimento" value={dataBR(form.dataVencimento)} />}
            {form.municipioEmissor && <SRow label="Município" value={form.municipioEmissor} />}
          </SummaryBlock>

          <SummaryBlock title="Valores">
            {form.valorBruto   && <SRow label="Bruto"        value={brl(form.valorBruto)} />}
            {form.valorLiquido && <SRow label="Líquido"      value={brl(form.valorLiquido)} />}
            {form.aliquota     && <SRow label="Alíquota ISS" value={`${form.aliquota}%`} />}
          </SummaryBlock>

          {(tomador.nomeRazaoSocial || prestador.nomeRazaoSocial) && (
            <SummaryBlock title="Partes">
              {prestador.nomeRazaoSocial && <SRow label="Prestador" value={prestador.nomeRazaoSocial} />}
              {tomador.nomeRazaoSocial   && <SRow label="Tomador"   value={tomador.nomeRazaoSocial} />}
            </SummaryBlock>
          )}

          {ret.length > 0 && (
            <SummaryBlock title="Retenções">
              {ret.map(r => <SRow key={r.label} label={r.label} value={brl(r.value)} />)}
            </SummaryBlock>
          )}
        </div>
      </Wizard>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // FLUXO MANUAL
  // ══════════════════════════════════════════════════════════════════════════════

  // Manual — Etapa 1: Dados básicos
  if (mode === 'manual' && manualStep === 'basicos') {
    return (
      <Wizard title="Dados da nota" icon={<FileText size={18} className="text-gray-500" />}
        step={1} total={5}
        onBack={() => setMode(null)}
        onNext={() => setManualStep('partes')}
        nextLabel="Próximo"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <select className="input" value={form.tipo || 'NFS-e'} onChange={e => sf('tipo', e.target.value)}>
                <option>NFS-e</option><option>NF-e</option><option>NF</option><option>Outro</option>
              </select>
            </Field>
            <Field label="Número da NF">
              <input type="text" className="input" placeholder="187" value={form.numeroNf || ''} onChange={e => sf('numeroNf', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data de Emissão">
              <input type="date" className="input" value={form.dataEmissao || ''} onChange={e => sf('dataEmissao', e.target.value)} />
            </Field>
            <Field label="Data de Vencimento">
              <input type="date" className="input" value={form.dataVencimento || ''} onChange={e => sf('dataVencimento', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Município Emissor">
              <input type="text" className="input" placeholder="Dourados" value={form.municipioEmissor || ''} onChange={e => sf('municipioEmissor', e.target.value)} />
            </Field>
            <Field label="OF / OS">
              <input type="text" className="input" placeholder="6866682" value={form.of || ''} onChange={e => sf('of', e.target.value)} />
            </Field>
          </div>
          <Field label="Status">
            <select className="input" value={form.status || 'lancada'} onChange={e => sf('status', e.target.value)}>
              {STATUS_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>
        </div>
      </Wizard>
    );
  }

  // Manual — Etapa 2: Prestador + Tomador
  if (mode === 'manual' && manualStep === 'partes') {
    return (
      <Wizard title="Empresas" icon={<Building2 size={18} className="text-indigo-500" />}
        step={2} total={5}
        onBack={() => setManualStep('basicos')}
        onNext={() => setManualStep('valores')}
        nextLabel="Próximo"
      >
        <div className="space-y-5">
          {/* Prestador */}
          <div>
            <SectionLabel icon={<Building2 size={12} />}>Prestador de Serviços</SectionLabel>
            <div className="space-y-3">
              <Field label="Nome / Razão Social">
                <input type="text" className="input" placeholder="JM Inox Manutenção Industrial Ltda" value={prestador.nomeRazaoSocial || ''} onChange={e => sp('nomeRazaoSocial', e.target.value)} />
              </Field>
              <Field label="CNPJ / CPF">
                <input type="text" className="input" placeholder="49.521.060/0001-49" value={prestador.cpfCnpj || ''} onChange={e => sp('cpfCnpj', e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Tomador */}
          <div>
            <SectionLabel icon={<Building2 size={12} />}>Tomador de Serviços</SectionLabel>
            <div className="space-y-3">
              <Field label="Nome / Razão Social">
                <input type="text" className="input" placeholder="Seara Alimentos Ltda" value={tomador.nomeRazaoSocial || ''} onChange={e => st('nomeRazaoSocial', e.target.value)} />
              </Field>
              <Field label="CNPJ / CPF">
                <input type="text" className="input" placeholder="02.914.460/0061-91" value={tomador.cpfCnpj || ''} onChange={e => st('cpfCnpj', e.target.value)} />
              </Field>
            </div>
          </div>
        </div>
      </Wizard>
    );
  }

  // Manual — Etapa 3: Valores e impostos
  if (mode === 'manual' && manualStep === 'valores') {
    return (
      <Wizard title="Valores" icon={<DollarSign size={18} className="text-green-500" />}
        step={3} total={5}
        onBack={() => setManualStep('partes')}
        onNext={() => { if (!form.nomeOrganizador) sf('nomeOrganizador', nomeSugerido); setManualStep('nome'); }}
        nextLabel="Próximo"
      >
        <div className="space-y-4">
          <Field label="Descrição do Serviço">
            <textarea className="input min-h-[70px] resize-none" placeholder="Referente a instalação dos tanques de salmoura" value={form.descricao || ''} onChange={e => sf('descricao', e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor Bruto (R$)">
              <input type="number" step="0.01" className="input" placeholder="50000.00" value={form.valorBruto || ''} onChange={e => sf('valorBruto', e.target.value)} />
            </Field>
            <Field label="Valor Líquido (R$)">
              <input type="number" step="0.01" className="input" placeholder="47500.00" value={form.valorLiquido || ''} onChange={e => sf('valorLiquido', e.target.value)} />
            </Field>
            <Field label="Alíquota ISS (%)">
              <input type="number" step="0.01" className="input" placeholder="5" value={form.aliquota || ''} onChange={e => sf('aliquota', e.target.value)} />
            </Field>
            <Field label="Valor ISS (R$)">
              <input type="number" step="0.01" className="input" placeholder="2500.00" value={form.valorIss || ''} onChange={e => sf('valorIss', e.target.value)} />
            </Field>
          </div>

          <details className="group">
            <summary className="text-xs font-semibold text-gray-400 cursor-pointer hover:text-gray-600 select-none">
              + Retenções federais (opcional)
            </summary>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {['IR', 'PIS/PASEP', 'COFINS', 'INSS', 'CSLL'].map((label, i) => {
                const keys = ['ir', 'pisPasep', 'cofins', 'inss', 'csll'];
                return (
                  <Field key={label} label={label}>
                    <input type="number" step="0.01" className="input" placeholder="0.00" value={form[keys[i]] || ''} onChange={e => sf(keys[i], e.target.value)} />
                  </Field>
                );
              })}
            </div>
          </details>
        </div>
      </Wizard>
    );
  }

  // Manual — Etapa 4: Nome
  if (mode === 'manual' && manualStep === 'nome') {
    const sugestao = nomeSugerido;
    return (
      <Wizard title="Nome da nota" icon={<Tag size={18} className="text-purple-500" />}
        step={4} total={5}
        onBack={() => setManualStep('valores')}
        onNext={() => setManualStep('confirmar')}
        nextLabel="Continuar"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Como quer chamar esta nota?
            </label>
            <input
              type="text"
              className="input text-base py-3 font-medium"
              placeholder={sugestao || 'Ex: NF 187 – Cliente XYZ'}
              value={form.nomeOrganizador || ''}
              onChange={e => sf('nomeOrganizador', e.target.value)}
              autoFocus
            />
            {sugestao && !form.nomeOrganizador && (
              <button
                className="mt-2 text-xs text-blue-600 hover:underline"
                onClick={() => sf('nomeOrganizador', sugestao)}
              >
                Usar sugestão: &quot;{sugestao}&quot;
              </button>
            )}
            <p className="text-xs text-gray-400 mt-2">Aparece na lista de notas para facilitar a busca.</p>
          </div>

          <Field label="Observações (opcional)">
            <textarea className="input min-h-[60px] resize-none" placeholder="Anotações internas..." value={form.observacoes || ''} onChange={e => sf('observacoes', e.target.value)} />
          </Field>
        </div>
      </Wizard>
    );
  }

  // Manual — Etapa 5: Confirmar e salvar
  if (mode === 'manual' && manualStep === 'confirmar') {
    const nome = form.nomeOrganizador?.trim() || nomeSugerido || 'Nota sem nome';
    return (
      <Wizard title="Tudo pronto!" icon={<CheckCircle size={18} className="text-green-500" />}
        step={5} total={5}
        onBack={() => setManualStep('nome')}
        onNext={handleSave}
        nextLabel={saving ? 'Salvando...' : 'Salvar Nota'}
        nextDisabled={saving}
        isSave
        saveError={saveError}
      >
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl px-4 py-3 flex items-center gap-3">
            <Tag size={16} className="text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-blue-400 font-medium">Nome da nota</p>
              <p className="font-bold text-blue-900 text-sm">{nome}</p>
            </div>
          </div>

          <SummaryBlock title="Identificação">
            {form.numeroNf       && <SRow label="NF Nº"      value={form.numeroNf} />}
            {form.dataEmissao    && <SRow label="Emissão"    value={dataBR(form.dataEmissao)} />}
            {form.dataVencimento && <SRow label="Vencimento" value={dataBR(form.dataVencimento)} />}
            {form.municipioEmissor && <SRow label="Município" value={form.municipioEmissor} />}
          </SummaryBlock>

          {(prestador.nomeRazaoSocial || tomador.nomeRazaoSocial) && (
            <SummaryBlock title="Partes">
              {prestador.nomeRazaoSocial && <SRow label="Prestador" value={prestador.nomeRazaoSocial} />}
              {tomador.nomeRazaoSocial   && <SRow label="Tomador"   value={tomador.nomeRazaoSocial} />}
            </SummaryBlock>
          )}

          {(form.valorBruto || form.valorLiquido) && (
            <SummaryBlock title="Valores">
              {form.valorBruto   && <SRow label="Bruto"        value={brl(form.valorBruto)} />}
              {form.valorLiquido && <SRow label="Líquido"      value={brl(form.valorLiquido)} />}
              {form.aliquota     && <SRow label="Alíquota ISS" value={`${form.aliquota}%`} />}
            </SummaryBlock>
          )}
        </div>
      </Wizard>
    );
  }

  return null;
}

// ─── Wizard ────────────────────────────────────────────────────────────────────
function Wizard({
  title, icon, step, total,
  onBack, onNext,
  nextLabel = 'Próximo', nextDisabled = false,
  isSave = false, saveError,
  children,
}: {
  title: string; icon?: React.ReactNode;
  step: number; total: number;
  onBack?: () => void; onNext?: () => void;
  nextLabel?: string; nextDisabled?: boolean;
  isSave?: boolean; saveError?: string;
  children: React.ReactNode;
}) {
  return (
    <Centered>
      <div className="animate-enter w-full max-w-md">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {Array.from({ length: total }, (_, i) => (
            <div key={i} className={`rounded-full transition-all duration-300 ${
              i + 1 < step  ? 'w-6 h-2 bg-blue-600' :
              i + 1 === step ? 'w-8 h-2 bg-blue-600' :
              'w-2 h-2 bg-gray-200'
            }`} />
          ))}
          <span className="text-xs text-gray-400 ml-2">{step}/{total}</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-5">
            {icon && <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center shrink-0">{icon}</div>}
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
          </div>
          {children}
        </div>

        {saveError && <Alert type="error" message={saveError} className="mt-3" />}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          {onBack ? (
            <button onClick={onBack} className="btn-ghost text-gray-500 text-sm flex items-center gap-1">
              <ChevronLeft size={16} /> Voltar
            </button>
          ) : <span />}
          {onNext && (
            <button onClick={onNext} disabled={nextDisabled}
              className={`btn-primary ${nextDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
              {nextDisabled && isSave ? <Loader2 size={14} className="animate-spin" /> : isSave ? <Save size={14} /> : null}
              {nextLabel}
              {!isSave && <ChevronRight size={15} />}
            </button>
          )}
        </div>
      </div>
    </Centered>
  );
}

// ─── Helpers de layout ────────────────────────────────────────────────────────
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center min-h-full p-6 bg-gray-50">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-2.5">
      {icon && <span className="text-gray-400">{icon}</span>}
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{children}</p>
    </div>
  );
}

function SummaryBlock({ title, children }: { title: string; children: React.ReactNode }) {
  const hasContent = Array.isArray(children) ? children.filter(Boolean).length > 0 : !!children;
  if (!hasContent) return null;
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function SRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-center gap-2 text-sm">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="font-semibold text-gray-800 text-right">{value}</span>
    </div>
  );
}

function Alert({ type, message, className = '' }: { type: 'error' | 'warning'; message: string; className?: string }) {
  const cls = type === 'error'
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-amber-50 border-amber-200 text-amber-700';
  return (
    <div className={`flex items-center gap-2 ${cls} border rounded-xl p-3 text-sm ${className}`}>
      <AlertCircle size={15} className="shrink-0" />{message}
    </div>
  );
}
