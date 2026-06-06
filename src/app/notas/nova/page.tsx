'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, FileText, Pencil, ChevronRight, ChevronLeft,
  Loader2, AlertCircle, CheckCircle, Save, Sparkles, X,
} from 'lucide-react';
import type { PdfExtractResult } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = null | 'pdf' | 'manual';
type PdfStep = 'upload' | 'extracting' | 'review';
type ManualStep = 'essentials' | 'details' | 'finalize';

const fmt = (v: unknown) => (v != null ? String(v) : '');

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function NovaNotaPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>(null);
  const [pdfStep, setPdfStep] = useState<PdfStep>('upload');
  const [manualStep, setManualStep] = useState<ManualStep>('essentials');

  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extracted, setExtracted] = useState<PdfExtractResult | null>(null);
  const [pdfData, setPdfData] = useState(''); // base64 — persistido no banco

  // Form state
  const [form, setForm] = useState<Record<string, string>>({ status: 'lancada', tipo: 'NFS-e' });
  const [prestador, setPrestador] = useState<Record<string, string>>({});
  const [tomador, setTomador] = useState<Record<string, string>>({});

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const sf = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const sp = (k: string, v: string) => setPrestador(p => ({ ...p, [k]: v }));
  const st = (k: string, v: string) => setTomador(p => ({ ...p, [k]: v }));

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
        status: 'lancada',
        tipo: data.tipo || 'NFS-e',
        nomeOrganizador: fmt(data.nomeOrganizador),
        numeroNf: fmt(data.numeroNf),
        numeroRps: fmt(data.numeroRps),
        codigoVerificacao: fmt(data.codigoVerificacao),
        of: fmt(data.of),
        dataEmissao: fmt(data.dataEmissao),
        dataFatoGerador: fmt(data.dataFatoGerador),
        municipioEmissor: fmt(data.municipioEmissor),
        codigoServico: fmt(data.codigoServico),
        descricao: fmt(data.descricao),
        quantidade: fmt(data.quantidade),
        valorUnitario: fmt(data.valorUnitario),
        valorBruto: fmt(data.valorBruto),
        valorLiquido: fmt(data.valorLiquido),
        baseCalculo: fmt(data.baseCalculo),
        aliquota: fmt(data.aliquota),
        valorIss: fmt(data.valorIss),
        ir: fmt(data.ir),
        pisPasep: fmt(data.pisPasep),
        cofins: fmt(data.cofins),
        inss: fmt(data.inss),
        csll: fmt(data.csll),
        outrasRetencoes: fmt(data.outrasRetencoes),
        valorAproximadoTributos: fmt(data.valorAproximadoTributos),
        naturezaOperacao: fmt(data.naturezaOperacao),
        situacaoTributariaIssqn: fmt(data.situacaoTributariaIssqn),
        localPrestacao: fmt(data.localPrestacao),
        situacaoNfse: fmt(data.situacaoNfse),
        regimeTributario: fmt(data.regimeTributario),
        indicacaoRetencao: fmt(data.indicacaoRetencao),
        observacoesFiscais: fmt(data.observacoesFiscais),
        observacoesAutenticidade: fmt(data.observacoesAutenticidade),
        observacoes: '',
        tags: '',
        dataVencimento: '',
        dataRecebimento: '',
      });

      if (data.prestador) {
        setPrestador(Object.fromEntries(
          Object.entries(data.prestador).map(([k, v]) => [k, fmt(v)])
        ));
      }
      if (data.tomador) {
        setTomador(Object.fromEntries(
          Object.entries(data.tomador).map(([k, v]) => [k, fmt(v)])
        ));
      }

      setPdfStep('review');
    } catch {
      setExtractError('Erro ao processar o PDF. Tente novamente.');
      setPdfStep('upload');
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.nomeOrganizador?.trim()) {
      setSaveError('Informe um nome para identificar esta nota.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        ...form,
        pdfData: pdfData || undefined,
        prestador: Object.values(prestador).some(Boolean) ? prestador : undefined,
        tomador: Object.values(tomador).some(Boolean) ? tomador : undefined,
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

  // ── Render: Choice Screen ───────────────────────────────────────────────────
  if (mode === null) {
    return (
      <Centered>
        <div className="animate-enter w-full max-w-md">
          <div className="text-center mb-10">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
              <FileText size={26} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Nova Nota Fiscal</h1>
            <p className="text-gray-400 mt-1.5 text-sm">Como deseja lançar esta nota?</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setMode('pdf')}
              className="flex flex-col items-center gap-4 p-8 bg-white rounded-2xl border-2 border-gray-100 hover:border-red-300 hover:bg-red-50/40 transition-all group shadow-sm"
            >
              <div className="w-16 h-16 bg-red-50 group-hover:bg-red-100 rounded-2xl flex items-center justify-center transition-colors">
                <Upload size={28} className="text-red-500" />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-800">Carregar PDF</p>
                <p className="text-xs text-gray-400 mt-0.5">Extração automática</p>
              </div>
            </button>

            <button
              onClick={() => setMode('manual')}
              className="flex flex-col items-center gap-4 p-8 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/40 transition-all group shadow-sm"
            >
              <div className="w-16 h-16 bg-blue-50 group-hover:bg-blue-100 rounded-2xl flex items-center justify-center transition-colors">
                <Pencil size={28} className="text-blue-500" />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-800">Preencher Manual</p>
                <p className="text-xs text-gray-400 mt-0.5">Digitar os dados</p>
              </div>
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

  // ── Render: PDF — Step 1 (Upload) ───────────────────────────────────────────
  if (mode === 'pdf' && pdfStep === 'upload') {
    return (
      <WizardShell
        title="Carregar PDF da nota"
        step={1} totalSteps={3}
        onBack={() => { setMode(null); setPdfFile(null); setExtractError(''); }}
        onNext={pdfFile ? handleExtract : undefined}
        nextLabel="Próximo"
        nextDisabled={!pdfFile}
      >
        {extractError && (
          <Alert type="error" message={extractError} onClose={() => setExtractError('')} className="mb-4" />
        )}

        <div
          className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer select-none ${
            isDragging
              ? 'border-blue-500 bg-blue-50'
              : pdfFile
              ? 'border-green-400 bg-green-50'
              : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragging(false);
            const f = e.dataTransfer.files[0];
            if (f?.name.toLowerCase().endsWith('.pdf')) setPdfFile(f);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }}
          />

          {pdfFile ? (
            <>
              <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <CheckCircle size={28} className="text-green-600" />
              </div>
              <p className="font-semibold text-green-800">{pdfFile.name}</p>
              <p className="text-sm text-gray-400 mt-1">Clique para trocar o arquivo</p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Upload size={26} className="text-gray-400" />
              </div>
              <p className="font-semibold text-gray-700">Arraste o PDF aqui</p>
              <p className="text-sm text-gray-400 mt-1">ou clique para selecionar o arquivo</p>
            </>
          )}
        </div>
      </WizardShell>
    );
  }

  // ── Render: PDF — Step 2 (Extracting) ──────────────────────────────────────
  if (mode === 'pdf' && pdfStep === 'extracting') {
    return (
      <WizardShell title="Lendo o PDF..." step={2} totalSteps={3}>
        <div className="flex flex-col items-center py-8">
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center">
              <FileText size={34} className="text-blue-500" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center shadow">
              <Loader2 size={14} className="text-white animate-spin" />
            </div>
          </div>
          <p className="font-semibold text-gray-800 text-base">Extraindo dados do PDF...</p>
          <p className="text-sm text-gray-400 mt-2 text-center">
            Identificando campos da nota fiscal.<br />Isso leva apenas alguns segundos.
          </p>
        </div>
      </WizardShell>
    );
  }

  // ── Render: PDF — Step 3 (Review + Name) ───────────────────────────────────
  if (mode === 'pdf' && pdfStep === 'review') {
    const missing  = extracted?.camposNaoEncontrados || [];
    const lowConf  = extracted?.camposBaixaConfianca || [];
    const issues   = extracted?.inconsistencias || [];

    const brl = (v: string | number | undefined) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
      return isNaN(n) ? '' : `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    };
    const dataBR = (v: string) => {
      if (!v) return '';
      try { return new Date(v + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return v; }
    };
    const pct = (v: string) => v ? `${v}%` : '';

    // ── Section helper ──────────────────────────────────────────────────────
    const Section = ({ title, rows }: { title: string; rows: { label: string; value: string; full?: boolean }[] }) => {
      const visible = rows.filter(r => r.value);
      if (!visible.length) return null;
      return (
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">{title}</p>
          <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {visible.map(({ label, value, full }) => (
              <div key={label} className={`flex items-start gap-1.5 min-w-0 ${full ? 'col-span-2' : ''}`}>
                <CheckCircle size={11} className="text-green-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 leading-none">{label}</p>
                  <p className="text-xs font-semibold text-gray-700 break-words">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    };

    return (
      <WizardShell
        title="Revisar e salvar"
        step={3} totalSteps={3}
        onBack={() => { setPdfStep('upload'); setExtracted(null); }}
        onNext={handleSave}
        nextLabel={saving ? 'Salvando...' : 'Salvar Nota'}
        nextDisabled={saving || !form.nomeOrganizador?.trim()}
        isSave
        saveError={saveError}
      >
        {/* ── Nome da nota ──────────────────────────────────────────────── */}
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-800 mb-1.5">
            Nome da nota <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="input text-sm py-2.5 font-medium"
            placeholder="Ex: NF 187 – Instalação tanques de salmoura"
            value={form.nomeOrganizador || ''}
            onChange={e => sf('nomeOrganizador', e.target.value)}
            autoFocus
          />
        </div>

        {/* ── Data de vencimento ────────────────────────────────────────── */}
        <div className="mb-4">
          <label className="label">Data de Vencimento</label>
          <input
            type="date"
            className="input"
            value={form.dataVencimento || ''}
            onChange={e => sf('dataVencimento', e.target.value)}
          />
        </div>

        {/* ── Sparkles header ──────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles size={12} className="text-blue-500" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
            Dados extraídos automaticamente
          </p>
        </div>

        {/* ── Identificação ─────────────────────────────────────────────── */}
        <Section title="Identificação" rows={[
          { label: 'NF Nº',            value: form.numeroNf },
          { label: 'Tipo',             value: form.tipo },
          { label: 'Data Emissão',     value: dataBR(form.dataEmissao) },
          { label: 'Fato Gerador',     value: dataBR(form.dataFatoGerador) },
          { label: 'Cód. Verificação', value: form.codigoVerificacao },
          { label: 'Município',        value: form.municipioEmissor },
          { label: 'Sit. NFS-e',       value: form.situacaoNfse },
          { label: 'OF',               value: form.of },
          { label: 'Cód. Serviço',     value: form.codigoServico },
        ]} />

        {/* ── Serviço ───────────────────────────────────────────────────── */}
        <Section title="Serviço" rows={[
          { label: 'Descrição',    value: form.descricao, full: true },
          { label: 'Quantidade',   value: form.quantidade },
          { label: 'Vlr. Unit.',   value: brl(form.valorUnitario) },
        ]} />

        {/* ── Partes ────────────────────────────────────────────────────── */}
        <Section title="Prestador" rows={[
          { label: 'Razão Social', value: prestador.nomeRazaoSocial || prestador.nomeFantasia || '' },
          { label: 'CNPJ/CPF',    value: prestador.cpfCnpj || '' },
          { label: 'Município',   value: prestador.municipio ? `${prestador.municipio}${prestador.uf ? '/' + prestador.uf : ''}` : '' },
          { label: 'E-mail',      value: prestador.email || '', full: true },
        ]} />
        <Section title="Tomador" rows={[
          { label: 'Razão Social', value: tomador.nomeRazaoSocial || tomador.nomeFantasia || '' },
          { label: 'CNPJ/CPF',    value: tomador.cpfCnpj || '' },
          { label: 'Município',   value: tomador.municipio ? `${tomador.municipio}${tomador.uf ? '/' + tomador.uf : ''}` : '' },
          { label: 'Telefone',    value: tomador.telefone || '' },
        ]} />

        {/* ── Valores ───────────────────────────────────────────────────── */}
        <Section title="Valores" rows={[
          { label: 'Valor Bruto',   value: brl(form.valorBruto) },
          { label: 'Valor Líquido', value: brl(form.valorLiquido) },
          { label: 'Base Cálculo',  value: brl(form.baseCalculo) },
          { label: 'Alíquota ISS',  value: pct(form.aliquota) },
          { label: 'Valor ISS',     value: brl(form.valorIss) },
          ...(extracted?.desconto ? [{ label: 'Desconto', value: brl(extracted.desconto) }] : []),
          ...(extracted?.deducoes ? [{ label: 'Deduções', value: brl(extracted.deducoes) }] : []),
        ]} />

        {/* ── Retenções (mostra só se algum > 0) ───────────────────────── */}
        {(() => {
          const ret = [
            { label: 'PIS/PASEP', value: form.pisPasep },
            { label: 'COFINS',    value: form.cofins },
            { label: 'INSS',      value: form.inss },
            { label: 'IR',        value: form.ir },
            { label: 'CSLL',      value: form.csll },
            { label: 'Outras',    value: form.outrasRetencoes },
          ].filter(r => r.value && parseFloat(r.value) > 0)
           .map(r => ({ label: r.label, value: brl(r.value) }));
          return <Section title="Retenções Federais" rows={ret} />;
        })()}

        {/* ── Fiscal ────────────────────────────────────────────────────── */}
        <Section title="Fiscal" rows={[
          { label: 'Nat. Operação',   value: form.naturezaOperacao },
          { label: 'Sit. Tributária', value: form.situacaoTributariaIssqn },
          { label: 'Local Prestação', value: form.localPrestacao },
          { label: 'Regime',          value: form.regimeTributario },
          ...(extracted?.simplesNacional ? [{ label: 'Simples Nacional', value: 'Sim' }] : []),
          ...(extracted?.valorAproximadoTributosFederal != null ? [{
            label: 'Trib. Federal',
            value: brl(extracted.valorAproximadoTributosFederal),
          }] : []),
          ...(extracted?.valorAproximadoTributosMunicipal != null ? [{
            label: 'Trib. Municipal',
            value: brl(extracted.valorAproximadoTributosMunicipal),
          }] : []),
        ]} />

        {/* ── Avisos ────────────────────────────────────────────────────── */}
        {issues.length > 0 && (
          <Alert type="error" className="mb-2"
            message={`Inconsistência: ${issues.join(' | ')}`} />
        )}
        {lowConf.length > 0 && (
          <Alert type="warning" className="mb-2"
            message={`Baixa confiança: ${lowConf.join(', ')}`} />
        )}
        {missing.length > 0 && (
          <Alert type="warning"
            message={`Não encontrado: ${missing.join(', ')} — edite após salvar.`} />
        )}
      </WizardShell>
    );
  }

  // ── Render: Manual — Step 1 (Essentials) ───────────────────────────────────
  if (mode === 'manual' && manualStep === 'essentials') {
    return (
      <WizardShell
        title="Dados principais"
        step={1} totalSteps={3}
        onBack={() => setMode(null)}
        onNext={() => setManualStep('details')}
        nextLabel="Próximo"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Número da NF">
              <input type="text" className="input" placeholder="187" value={form.numeroNf || ''} onChange={e => sf('numeroNf', e.target.value)} />
            </Field>
            <Field label="Tipo">
              <select className="input" value={form.tipo || 'NFS-e'} onChange={e => sf('tipo', e.target.value)}>
                <option>NFS-e</option>
                <option>NF-e</option>
                <option>NF</option>
                <option>Outro</option>
              </select>
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
          <Field label="Status">
            <select className="input" value={form.status || 'lancada'} onChange={e => sf('status', e.target.value)}>
              <option value="lancada">Lançada</option>
              <option value="rascunho">Rascunho</option>
              <option value="recebida">Recebida</option>
              <option value="antecipada">Antecipada</option>
              <option value="incompleta">Incompleta</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="OF">
              <input type="text" className="input" placeholder="Ex: 6866682" value={form.of || ''} onChange={e => sf('of', e.target.value)} />
            </Field>
            <Field label="Município">
              <input type="text" className="input" placeholder="Dourados/MS" value={form.municipioEmissor || ''} onChange={e => sf('municipioEmissor', e.target.value)} />
            </Field>
          </div>
        </div>
      </WizardShell>
    );
  }

  // ── Render: Manual — Step 2 (Tomador + Valores) ─────────────────────────────
  if (mode === 'manual' && manualStep === 'details') {
    return (
      <WizardShell
        title="Tomador e valores"
        step={2} totalSteps={3}
        onBack={() => setManualStep('essentials')}
        onNext={() => setManualStep('finalize')}
        nextLabel="Próximo"
      >
        <div className="space-y-5">
          {/* Tomador */}
          <div>
            <SectionLabel>Tomador de Serviços</SectionLabel>
            <div className="space-y-3">
              <Field label="Nome / Razão Social">
                <input type="text" className="input" value={tomador.nomeRazaoSocial || ''} onChange={e => st('nomeRazaoSocial', e.target.value)} />
              </Field>
              <Field label="CNPJ / CPF">
                <input type="text" className="input" value={tomador.cpfCnpj || ''} onChange={e => st('cpfCnpj', e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Valores */}
          <div>
            <SectionLabel>Valores</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor Bruto (R$)">
                <input type="number" step="0.01" className="input" placeholder="50000" value={form.valorBruto || ''} onChange={e => sf('valorBruto', e.target.value)} />
              </Field>
              <Field label="Valor Líquido (R$)">
                <input type="number" step="0.01" className="input" placeholder="47500" value={form.valorLiquido || ''} onChange={e => sf('valorLiquido', e.target.value)} />
              </Field>
              <Field label="Alíquota ISS (%)">
                <input type="number" step="0.01" className="input" placeholder="5,00" value={form.aliquota || ''} onChange={e => sf('aliquota', e.target.value)} />
              </Field>
              <Field label="Valor ISS (R$)">
                <input type="number" step="0.01" className="input" value={form.valorIss || ''} onChange={e => sf('valorIss', e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Descrição */}
          <Field label="Descrição do Serviço">
            <textarea
              className="input min-h-[72px] resize-none"
              placeholder="Ex: instalação dos tanques de salmoura"
              value={form.descricao || ''}
              onChange={e => sf('descricao', e.target.value)}
            />
          </Field>
        </div>
      </WizardShell>
    );
  }

  // ── Render: Manual — Step 3 (Finalize) ─────────────────────────────────────
  if (mode === 'manual' && manualStep === 'finalize') {
    return (
      <WizardShell
        title="Finalizar"
        step={3} totalSteps={3}
        onBack={() => setManualStep('details')}
        onNext={handleSave}
        nextLabel={saving ? 'Salvando...' : 'Salvar Nota'}
        nextDisabled={saving || !form.nomeOrganizador?.trim()}
        isSave
        saveError={saveError}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-2">
              Nome da nota <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="input text-sm py-3 font-medium"
              placeholder="Ex: NF 187 – Cliente XYZ"
              value={form.nomeOrganizador || ''}
              onChange={e => sf('nomeOrganizador', e.target.value)}
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">Nome para identificar esta nota na lista.</p>
          </div>

          <Field label="Observações (opcional)">
            <textarea
              className="input min-h-[72px] resize-none"
              placeholder="Anotações internas..."
              value={form.observacoes || ''}
              onChange={e => sf('observacoes', e.target.value)}
            />
          </Field>

          {/* Resumo */}
          {(form.numeroNf || form.valorBruto || tomador.nomeRazaoSocial) && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Resumo da nota</p>
              {form.numeroNf && <Row label="NF Nº" value={form.numeroNf} />}
              {form.dataEmissao && (
                <Row
                  label="Emissão"
                  value={(() => { try { return new Date(form.dataEmissao + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return form.dataEmissao; } })()}
                />
              )}
              {form.valorBruto && (
                <Row label="Valor Bruto" value={`R$ ${parseFloat(form.valorBruto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
              )}
              {tomador.nomeRazaoSocial && <Row label="Tomador" value={tomador.nomeRazaoSocial} />}
            </div>
          )}
        </div>
      </WizardShell>
    );
  }

  return null;
}

// ─── Wizard Shell ─────────────────────────────────────────────────────────────
function WizardShell({
  title, step, totalSteps,
  onBack, onNext,
  nextLabel = 'Próximo', nextDisabled = false,
  isSave = false,
  saveError,
  children,
}: {
  title: string;
  step: number;
  totalSteps: number;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  isSave?: boolean;
  saveError?: string;
  children: React.ReactNode;
}) {
  return (
    <Centered>
      <div className="animate-enter w-full max-w-md">
        {/* Progress indicator */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                  i + 1 < step
                    ? 'bg-blue-600 text-white'
                    : i + 1 === step
                    ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                    : 'bg-gray-100 text-gray-400'
                }`}>
                  {i + 1 < step ? <CheckCircle size={13} /> : i + 1}
                </div>
                {i < totalSteps - 1 && (
                  <div className={`w-8 h-0.5 rounded-full transition-colors duration-300 ${i + 1 < step ? 'bg-blue-600' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
          <span className="text-xs text-gray-400 font-medium">Etapa {step} / {totalSteps}</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-bold text-gray-900 mb-5">{title}</h2>
          {children}
        </div>

        {/* Error */}
        {saveError && (
          <Alert type="error" message={saveError} className="mt-3" />
        )}

        {/* Navigation */}
        {(onBack || onNext) && (
          <div className="flex items-center justify-between mt-4">
            {onBack ? (
              <button onClick={onBack} className="btn-ghost text-gray-500 text-sm">
                <ChevronLeft size={16} /> Voltar
              </button>
            ) : <span />}

            {onNext && (
              <button onClick={onNext} disabled={nextDisabled} className="btn-primary">
                {nextDisabled && isSave
                  ? <Loader2 size={14} className="animate-spin" />
                  : isSave
                  ? <Save size={14} />
                  : null}
                {nextLabel}
                {!isSave && !nextDisabled && <ChevronRight size={15} />}
              </button>
            )}
          </div>
        )}
      </div>
    </Centered>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full p-6 bg-gray-50">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2.5">{children}</p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="font-semibold text-gray-800">{value}</span>
    </div>
  );
}

function Alert({
  type, message, onClose, className = '',
}: {
  type: 'error' | 'warning';
  message: string;
  onClose?: () => void;
  className?: string;
}) {
  const styles = type === 'error'
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-yellow-50 border-yellow-200 text-yellow-700';
  return (
    <div className={`flex items-start gap-2 border rounded-xl p-3 text-sm ${styles} ${className}`}>
      <AlertCircle size={15} className="shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="ml-auto shrink-0">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
