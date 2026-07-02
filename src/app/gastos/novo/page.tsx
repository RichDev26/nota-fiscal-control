'use client';

import { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Upload, Pencil, ChevronRight, X, Loader2, Check,
  FileText, Paperclip, Info, Wallet, Briefcase, PlusCircle, AlertCircle,
} from 'lucide-react';
import { formatarMoeda, parseDateBR } from '@/lib/validators';
import { Shell } from '@/components/gastos/WizardShell';
import { ServicoWizard } from '@/components/gastos/ServicoWizard';
import { CATEGORIAS_GASTO, FORMAS_PAGAMENTO } from '@/types';
import type { AnexoGasto, ProdutoGasto, PdfExtractResult, Servico } from '@/types';

type Mode = null | 'upload' | 'manual';

// ─── Uploader de anexos (reusa POST /api/upload existente) ─────────────────────
function AnexosField({ anexos, setAnexos }: { anexos: AnexoGasto[]; setAnexos: (a: AnexoGasto[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    const novos: AnexoGasto[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/upload', { method: 'POST', body: fd });
        const d = await r.json();
        if (r.ok) novos.push({ url: d.url, filename: d.filename, nome: file.name, tipo: file.type });
      } catch { /* ignora arquivo com falha */ }
    }
    setAnexos([...anexos, ...novos]);
    setBusy(false);
  }, [anexos, setAnexos]);

  return (
    <div>
      <input ref={ref} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
        onChange={e => { addFiles(e.target.files); if (ref.current) ref.current.value = ''; }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors text-sm font-semibold">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
        {busy ? 'Enviando...' : 'Anexar nota / comprovante'}
      </button>
      {anexos.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {anexos.map((a, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <FileText size={14} className="text-gray-400 shrink-0" />
              <span className="text-xs text-gray-600 truncate flex-1">{a.nome}</span>
              <button type="button" onClick={() => setAnexos(anexos.filter((_, j) => j !== i))}
                className="text-gray-300 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
function NovoGastoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);

  // Todo gasto pertence obrigatoriamente a um serviço em andamento.
  const [servicoId, setServicoId]     = useState<string | null>(null);
  const [servicoNome, setServicoNome] = useState('');
  const [servicos, setServicos]       = useState<Servico[]>([]);
  const [loadingServicos, setLoadingServicos] = useState(true);
  const [showNovoServico, setShowNovoServico] = useState(false);

  const [mode, setMode] = useState<Mode>(null);
  const [step, setStep] = useState(1);
  const [extraindo, setExtraindo] = useState(false);
  // Feedback da leitura automática: null = veio manual; ok = extraiu; falha = tentou e não leu
  const [leitura, setLeitura] = useState<null | { ok: boolean; msg: string }>(null);

  // Carrega serviços em andamento; se veio de /gastos/servicos/[id] (?servico=ID),
  // pré-seleciona direto — usuário não precisa escolher de novo.
  useEffect(() => {
    (async () => {
      const r = await fetch('/api/servicos?status=em_andamento');
      const d = await r.json();
      const lista: Servico[] = Array.isArray(d) ? d : [];
      setServicos(lista);
      const preId = searchParams.get('servico');
      if (preId) {
        const pre = lista.find(s => s.id === preId);
        if (pre) { setServicoId(pre.id); setServicoNome(pre.nome); }
      }
      setLoadingServicos(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Form
  const [valor, setValor]           = useState('');
  const [descricao, setDescricao]   = useState('');
  const [data, setData]             = useState(new Date().toISOString().split('T')[0]);
  const [categoria, setCategoria]   = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [formaPagamento, setFormaPag] = useState('');
  const [observacoes, setObs]       = useState('');
  const [anexos, setAnexos]         = useState<AnexoGasto[]>([]);
  // Dados extraídos do documento (mesmo pipeline das Notas)
  const [fornecedorCnpj, setFornecedorCnpj]   = useState('');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [serieDocumento, setSerieDocumento]   = useState('');
  const [produtos, setProdutos]               = useState<ProdutoGasto[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const valorNum = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  const step1Ok = descricao.trim().length > 0 && isFinite(valorNum) && valorNum > 0;

  // ── Upload + extração via o MESMO pipeline das Notas (/api/pdf-extract) ────────
  const handleUploadAdvance = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setExtraindo(true);

    // 1. Anexa todos os arquivos ao gasto (rota de upload já existente).
    const novos: AnexoGasto[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append('file', file);
      try {
        const r = await fetch('/api/upload', { method: 'POST', body: fd });
        const d = await r.json();
        if (r.ok) novos.push({ url: d.url, filename: d.filename, nome: file.name, tipo: file.type });
      } catch { /* ignora arquivo com falha */ }
    }
    setAnexos(novos);

    // 2. Extrai do primeiro PDF usando EXATAMENTE o extrator das Notas.
    const pdf = Array.from(files).find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdf) {
      setLeitura({ ok: false, msg: 'Nenhum PDF para leitura automática — preencha os dados abaixo.' });
      setExtraindo(false); setMode('manual'); setStep(1); return;
    }

    try {
      const fd = new FormData(); fd.append('file', pdf);
      const r = await fetch('/api/pdf-extract', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) {
        setLeitura({ ok: false, msg: d.error || 'Não foi possível ler o documento automaticamente — preencha manualmente.' });
      } else {
        const n = aplicarExtracao(d);
        setLeitura({ ok: true, msg: `Leitura automática concluída — ${n} campo(s) preenchido(s). Confira antes de salvar.` });
      }
    } catch {
      setLeitura({ ok: false, msg: 'Falha na leitura automática — preencha os dados manualmente.' });
    } finally {
      setExtraindo(false); setMode('manual'); setStep(1);
    }
  };

  // Mapeia o PdfExtractResult (NFS-e) → campos do Gasto. Reutiliza o resultado do
  // pipeline existente; não interpreta o PDF por conta própria.
  function aplicarExtracao(d: PdfExtractResult): number {
    let n = 0;
    const forn = d.prestador?.nomeRazaoSocial || d.prestador?.nomeFantasia;
    if (forn)                { setFornecedor(forn); n++; }
    if (d.prestador?.cpfCnpj){ setFornecedorCnpj(d.prestador.cpfCnpj); n++; }
    if (d.numeroNf)          { setNumeroDocumento(String(d.numeroNf)); n++; }
    if (d.serie)             { setSerieDocumento(String(d.serie)); n++; }
    if (d.valorBruto != null){ setValor(d.valorBruto.toFixed(2).replace('.', ',')); n++; }
    if (d.dataEmissao) {
      const dt = parseDateBR(d.dataEmissao);
      if (dt) { setData(dt.toISOString().split('T')[0]); n++; }
    }
    if (d.descricao) { setDescricao(d.descricao); n++; }
    else if (forn)   { setDescricao(`Compra — ${forn}`); }

    // Produtos: DANFE traz a lista completa (d.produtos); NFS-e traz no máximo
    // uma linha de serviço (reconstruída dos campos simples).
    if (Array.isArray(d.produtos) && d.produtos.length) {
      setProdutos(d.produtos);
    } else if (d.descricao || d.valorUnitario != null || d.quantidade != null) {
      setProdutos([{
        descricao:     d.descricao ?? null,
        quantidade:    d.quantidade ?? null,
        unidade:       null,
        valorUnitario: d.valorUnitario ?? null,
        valorTotal:    d.valorBruto ?? null,
      }]);
    }
    return n;
  }

  const handleSave = async () => {
    if (!step1Ok) return;
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/gastos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valor: valorNum, descricao, data, categoria, fornecedor, formaPagamento, observacoes, anexos,
          fornecedorCnpj, numeroDocumento, serieDocumento, produtos,
          servicoId,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Erro ao salvar.'); return; }
      // Vai para o detalhe (não a lista): a lista filtra por "Este mês" e, quando a
      // data vem do documento extraído (normalmente no passado), o gasto some da
      // visão padrão — parecendo que não foi salvo. Mesmo padrão do fluxo de Notas.
      router.push(`/gastos/${d.id}`);
    } catch { setError('Erro de conexão.'); }
    finally { setSaving(false); }
  };

  // ── Etapa 0 — Selecionar Serviço (obrigatório antes de tudo) ──────────────────
  if (!servicoId) {
    if (showNovoServico) {
      return (
        <ServicoWizard
          onCreated={s => { setServicoId(s.id); setServicoNome(s.nome); setShowNovoServico(false); }}
          onCancel={() => setShowNovoServico(false)}
        />
      );
    }
    return (
      <Shell onBack={() => router.push('/gastos')}>
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Briefcase size={24} className="text-purple-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Selecionar Serviço</h1>
          <p className="text-gray-400 mt-1 text-sm">Todo gasto pertence a um serviço em andamento</p>
        </div>

        {loadingServicos ? (
          <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
        ) : servicos.length === 0 ? (
          <div className="text-center py-6">
            <p className="font-semibold text-gray-600">Nenhum serviço em andamento</p>
            <p className="text-sm text-gray-400 mt-0.5 mb-2">Crie um serviço para começar a lançar gastos</p>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {servicos.map(s => (
              <button key={s.id} onClick={() => { setServicoId(s.id); setServicoNome(s.nome); }}
                className="w-full text-left p-4 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/30 transition-all flex items-center justify-between gap-3 active:scale-[0.98]">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 truncate">{s.nome}</p>
                  <p className="text-xs text-gray-400">{s.quantidadeGastos} gasto{s.quantidadeGastos !== 1 ? 's' : ''} · {formatarMoeda(s.valorContratado)} contratado</p>
                </div>
                <ChevronRight size={18} className="text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        )}

        <button onClick={() => setShowNovoServico(true)}
          className="btn-secondary w-full justify-center py-3.5 rounded-2xl text-sm">
          <PlusCircle size={16} /> Criar novo serviço
        </button>
      </Shell>
    );
  }

  // ── Seleção de modo ──────────────────────────────────────────────────────────
  if (mode === null) {
    return (
      <Shell onBack={() => setServicoId(null)}>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Novo Gasto</h1>
          <p className="text-gray-400 mt-1 text-sm flex items-center justify-center gap-1.5">
            <Briefcase size={13} className="text-purple-500" /> {servicoNome}
          </p>
          <p className="text-gray-400 mt-2">Como deseja registrar?</p>
        </div>
        <div className="space-y-3">
          <button onClick={() => setMode('upload')}
            className="w-full text-left p-6 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/30 transition-all group shadow-sm active:scale-[0.98]">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-red-50 group-hover:bg-red-100 rounded-2xl flex items-center justify-center transition-colors shrink-0">
                <Upload size={24} className="text-red-500" />
              </div>
              <div className="pt-1">
                <p className="font-bold text-gray-900 text-base">Carregar Nota/Comprovante</p>
                <p className="text-sm text-gray-400 mt-0.5 leading-snug">Anexe os documentos<br />do gasto</p>
              </div>
              <ChevronRight size={18} className="text-gray-300 ml-auto shrink-0 mt-3 group-hover:text-blue-400 transition-colors" />
            </div>
          </button>
          <button onClick={() => setMode('manual')}
            className="w-full text-left p-6 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/30 transition-all group shadow-sm active:scale-[0.98]">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-blue-50 group-hover:bg-blue-100 rounded-2xl flex items-center justify-center transition-colors shrink-0">
                <Pencil size={22} className="text-blue-500" />
              </div>
              <div className="pt-1">
                <p className="font-bold text-gray-900 text-base">Preencher Manualmente</p>
                <p className="text-sm text-gray-400 mt-0.5 leading-snug">Registre o gasto<br />em poucos passos</p>
              </div>
              <ChevronRight size={18} className="text-gray-300 ml-auto shrink-0 mt-3 group-hover:text-blue-400 transition-colors" />
            </div>
          </button>
        </div>
        <div className="text-center mt-6">
          <button onClick={() => router.push('/gastos')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            ← Voltar para os gastos
          </button>
        </div>
      </Shell>
    );
  }

  // ── Modo Upload ──────────────────────────────────────────────────────────────
  if (mode === 'upload') {
    return (
      <Shell onBack={extraindo ? undefined : () => setMode(null)}>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Carregar documentos</h1>
          <p className="text-gray-400 mt-1 text-sm">Nota fiscal, cupom, comprovante — pode anexar vários</p>
        </div>
        <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
          onChange={e => handleUploadAdvance(e.target.files)} />

        {extraindo ? (
          <div className="border-2 border-dashed border-blue-200 bg-blue-50/40 rounded-2xl p-10 text-center mb-4">
            <Loader2 size={28} className="text-blue-500 animate-spin mx-auto mb-3" />
            <p className="font-semibold text-gray-700">Lendo o documento...</p>
            <p className="text-sm text-gray-400 mt-0.5">Extraindo os dados automaticamente</p>
          </div>
        ) : (
          <div onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-2xl p-10 text-center cursor-pointer hover:border-blue-300 hover:bg-gray-50 transition-all mb-4">
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Upload size={24} className="text-gray-400" />
            </div>
            <p className="font-semibold text-gray-600">Clique para selecionar os arquivos</p>
            <p className="text-sm text-gray-400 mt-0.5">PDF, JPG ou PNG</p>
          </div>
        )}

        <div className="flex items-start gap-2 bg-blue-50 text-blue-700 rounded-xl p-3 text-xs">
          <Info size={14} className="shrink-0 mt-0.5" />
          O sistema lê o PDF com o mesmo motor das Notas Fiscais e preenche os campos automaticamente. Você confere e ajusta antes de salvar.
        </div>
      </Shell>
    );
  }

  // ── Modo Manual — Etapa 1: essencial ──────────────────────────────────────────
  if (mode === 'manual' && step === 1) {
    return (
      <Shell onBack={() => setMode(null)}>
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-purple-50 rounded-2xl flex items-center justify-center">
              <Wallet size={18} className="text-purple-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Novo Gasto</h1>
          </div>
          <p className="text-gray-400 text-sm">Etapa 1 de 2 · o essencial</p>
        </div>

        {leitura && (
          <div className={`flex items-start gap-2 rounded-xl p-3 text-xs mb-4 ${
            leitura.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {leitura.ok ? <Check size={14} className="shrink-0 mt-0.5" /> : <Info size={14} className="shrink-0 mt-0.5" />}
            {leitura.msg}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="label">Valor *</label>
            <input type="text" inputMode="decimal" className="input text-2xl font-bold text-center py-3" placeholder="0,00"
              value={valor} onChange={e => setValor(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Descrição *</label>
            <input type="text" className="input" placeholder="Ex: Almoço com cliente, material de obra..."
              value={descricao} onChange={e => setDescricao(e.target.value)} />
          </div>
        </div>

        <button onClick={() => setStep(2)} disabled={!step1Ok}
          className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6 disabled:opacity-50">
          Continuar <ChevronRight size={18} />
        </button>
      </Shell>
    );
  }

  // ── Modo Manual — Etapa 2: detalhes (opcionais) + salvar ──────────────────────
  return (
    <Shell onBack={() => setStep(1)}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Detalhes</h1>
        <p className="text-gray-400 text-sm">Etapa 2 de 2 · tudo opcional</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-4">
          <AlertCircle size={14} />{error}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Data</label>
            <input type="date" className="input" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div>
            <label className="label">Categoria</label>
            <select className="input" value={categoria} onChange={e => setCategoria(e.target.value)}>
              <option value="">—</option>
              {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Fornecedor</label>
            <input type="text" className="input" placeholder="Opcional" value={fornecedor} onChange={e => setFornecedor(e.target.value)} />
          </div>
          <div>
            <label className="label">Pagamento</label>
            <select className="input" value={formaPagamento} onChange={e => setFormaPag(e.target.value)}>
              <option value="">—</option>
              {FORMAS_PAGAMENTO.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Observações</label>
          <input type="text" className="input" placeholder="Opcional" value={observacoes} onChange={e => setObs(e.target.value)} />
        </div>

        {/* Dados do documento — aparecem quando houve leitura automática */}
        {(leitura || numeroDocumento || serieDocumento || fornecedorCnpj) && (
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Dados do documento</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nº do documento</label>
                <input type="text" className="input" placeholder="—" value={numeroDocumento} onChange={e => setNumeroDocumento(e.target.value)} />
              </div>
              <div>
                <label className="label">Série</label>
                <input type="text" className="input" placeholder="—" value={serieDocumento} onChange={e => setSerieDocumento(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">CNPJ do fornecedor</label>
              <input type="text" className="input" placeholder="—" value={fornecedorCnpj} onChange={e => setFornecedorCnpj(e.target.value)} />
            </div>
            {produtos.length > 0 && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 text-xs text-gray-500">
                <FileText size={14} className="text-gray-400" />
                {produtos.length} item(ns) extraído(s) do documento — salvos junto ao gasto.
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">Anexos</label>
          <AnexosField anexos={anexos} setAnexos={setAnexos} />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving || !step1Ok}
        className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6">
        {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
        {saving ? 'Salvando...' : 'Salvar Gasto'}
      </button>
    </Shell>
  );
}

export default function NovoGastoPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>}>
      <NovoGastoContent />
    </Suspense>
  );
}
