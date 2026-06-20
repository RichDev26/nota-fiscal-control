'use client';

import { useState } from 'react';
import { Settings, User, Lock, Check, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useSession } from '@/context/SessionContext';

function Alert({ type, msg }: { type: 'ok' | 'err'; msg: string }) {
  const base = 'flex items-center gap-2 rounded-xl p-3.5 text-sm mb-4';
  return type === 'ok'
    ? <div className={`${base} bg-green-50 border border-green-200 text-green-700`}><Check size={15} className="shrink-0" />{msg}</div>
    : <div className={`${base} bg-red-50 border border-red-200 text-red-700`}><AlertCircle size={15} className="shrink-0" />{msg}</div>;
}

export default function ConfiguracoesPage() {
  const { usuario } = useSession();

  // ── Alterar nome ──────────────────────────────────────────────────────────────
  const [nome,        setNome]        = useState(usuario?.nome ?? '');
  const [nomeSt,      setNomeSt]      = useState<{ ok?: string; err?: string } | null>(null);
  const [nomeLoading, setNomeLoading] = useState(false);

  async function handleSalvarNome() {
    if (!nome.trim() || nome.trim().length < 2) {
      setNomeSt({ err: 'Nome muito curto (mínimo 2 caracteres)' });
      return;
    }
    setNomeLoading(true); setNomeSt(null);
    try {
      const res  = await fetch('/api/auth/alterar-nome', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ nome: nome.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setNomeSt({ err: data.error ?? 'Erro ao atualizar nome' }); return; }
      setNomeSt({ ok: 'Nome atualizado com sucesso!' });
    } catch {
      setNomeSt({ err: 'Erro de conexão. Tente novamente.' });
    } finally {
      setNomeLoading(false);
    }
  }

  // ── Alterar senha ─────────────────────────────────────────────────────────────
  const [senhaAtual,    setSenhaAtual]    = useState('');
  const [novaSenha,     setNovaSenha]     = useState('');
  const [confirmar,     setConfirmar]     = useState('');
  const [showAtual,     setShowAtual]     = useState(false);
  const [showNova,      setShowNova]      = useState(false);
  const [senhaSt,       setSenhaSt]       = useState<{ ok?: string; err?: string } | null>(null);
  const [senhaLoading,  setSenhaLoading]  = useState(false);

  async function handleSalvarSenha() {
    if (!senhaAtual) { setSenhaSt({ err: 'Informe a senha atual' }); return; }
    if (novaSenha.length < 8) { setSenhaSt({ err: 'Nova senha precisa ter mínimo 8 caracteres' }); return; }
    if (novaSenha !== confirmar) { setSenhaSt({ err: 'As senhas não coincidem' }); return; }
    setSenhaLoading(true); setSenhaSt(null);
    try {
      const res  = await fetch('/api/auth/alterar-senha', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ senhaAtual, novaSenha }),
      });
      const data = await res.json();
      if (!res.ok) { setSenhaSt({ err: data.error ?? 'Erro ao alterar senha' }); return; }
      setSenhaSt({ ok: 'Senha alterada com sucesso!' });
      setSenhaAtual(''); setNovaSenha(''); setConfirmar('');
    } catch {
      setSenhaSt({ err: 'Erro de conexão. Tente novamente.' });
    } finally {
      setSenhaLoading(false);
    }
  }

  return (
    <div className="p-5 md:p-8 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 bg-gray-50 rounded-2xl flex items-center justify-center">
            <Settings size={18} className="text-gray-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        </div>
        <p className="text-sm text-gray-400 mt-1">Gerencie suas informações de conta</p>
      </div>

      {/* ── Alterar nome ── */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
            <User size={15} className="text-blue-600" />
          </div>
          <p className="font-bold text-gray-900">Alterar nome</p>
        </div>

        {nomeSt?.ok  && <Alert type="ok"  msg={nomeSt.ok}  />}
        {nomeSt?.err && <Alert type="err" msg={nomeSt.err} />}

        <div>
          <label className="label">Seu nome</label>
          <input
            type="text"
            className="input text-base"
            value={nome}
            onChange={e => { setNome(e.target.value); setNomeSt(null); }}
            placeholder="João Silva"
          />
        </div>

        <button
          onClick={handleSalvarNome}
          disabled={nomeLoading}
          className="btn-primary w-full py-3.5 justify-center rounded-2xl"
        >
          {nomeLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {nomeLoading ? 'Salvando...' : 'Salvar nome'}
        </button>
      </div>

      {/* ── Alterar senha ── */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 bg-orange-50 rounded-xl flex items-center justify-center">
            <Lock size={15} className="text-orange-600" />
          </div>
          <p className="font-bold text-gray-900">Alterar senha</p>
        </div>

        {senhaSt?.ok  && <Alert type="ok"  msg={senhaSt.ok}  />}
        {senhaSt?.err && <Alert type="err" msg={senhaSt.err} />}

        <div>
          <label className="label">Senha atual</label>
          <div className="relative">
            <input
              type={showAtual ? 'text' : 'password'}
              className="input text-base pr-10"
              value={senhaAtual}
              onChange={e => { setSenhaAtual(e.target.value); setSenhaSt(null); }}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowAtual(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showAtual ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Nova senha</label>
          <div className="relative">
            <input
              type={showNova ? 'text' : 'password'}
              className="input text-base pr-10"
              value={novaSenha}
              onChange={e => { setNovaSenha(e.target.value); setSenhaSt(null); }}
              placeholder="Mínimo 8 caracteres"
            />
            <button
              type="button"
              onClick={() => setShowNova(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showNova ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Confirmar nova senha</label>
          <input
            type="password"
            className="input text-base"
            value={confirmar}
            onChange={e => { setConfirmar(e.target.value); setSenhaSt(null); }}
            placeholder="••••••••"
          />
        </div>

        <button
          onClick={handleSalvarSenha}
          disabled={senhaLoading}
          className="btn-primary w-full py-3.5 justify-center rounded-2xl"
        >
          {senhaLoading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
          {senhaLoading ? 'Alterando...' : 'Alterar senha'}
        </button>
      </div>

      {/* ── Info da conta ── */}
      {usuario && (
        <div className="card p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Conta</p>
          <div className="space-y-2.5">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">E-mail</span>
              <span className="text-sm font-medium text-gray-900">{usuario.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Nome</span>
              <span className="text-sm font-medium text-gray-900">{usuario.nome}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
