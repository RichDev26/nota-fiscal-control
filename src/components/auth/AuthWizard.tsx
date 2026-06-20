'use client';

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Eye, EyeOff, ArrowRight, ArrowLeft,
  Check, Loader2, Mail, Lock, User, FileText,
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

type Mode = 'welcome' | 'login' | 'register';
type LoginStep  = 1 | 2;
type RegStep    = 1 | 2 | 3 | 4 | 5;

interface Form {
  email:         string;
  senha:         string;
  confirmar:     string;
  nome:          string;
  lembrarMe:     boolean;
}

// ─── FORCE DA SENHA ───────────────────────────────────────────────────────────

function passwordStrength(p: string): 0 | 1 | 2 | 3 | 4 {
  if (!p) return 0;
  let score = 0;
  if (p.length >= 8)            score++;
  if (p.length >= 12)           score++;
  if (/[A-Z]/.test(p))          score++;
  if (/[0-9]/.test(p))          score++;
  if (/[^A-Za-z0-9]/.test(p))   score++;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}

const STRENGTH = [
  { label: '',            bar: '' },
  { label: 'Muito fraca', bar: 'bg-red-500'     },
  { label: 'Fraca',       bar: 'bg-orange-400'  },
  { label: 'Boa',         bar: 'bg-blue-500'    },
  { label: 'Forte',       bar: 'bg-emerald-500' },
];

// ─── VALIDAÇÃO ────────────────────────────────────────────────────────────────

function validateEmail(v: string) {
  if (!v.trim())                             return 'Informe seu e-mail';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'E-mail inválido';
  return '';
}

// ─── LOGO ─────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2 mb-8">
      <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm">
        <FileText size={18} className="text-white" />
      </div>
      <span className="text-lg font-semibold text-gray-900 tracking-tight">NF Control</span>
    </div>
  );
}

// ─── BARRA DE PROGRESSO ───────────────────────────────────────────────────────

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1.5 mt-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i < current
              ? 'bg-blue-600 w-5'
              : i === current
              ? 'bg-blue-400 w-3'
              : 'bg-gray-200 w-3'
          }`}
        />
      ))}
    </div>
  );
}

// ─── INPUT ────────────────────────────────────────────────────────────────────

interface InputProps {
  label:       string;
  type?:       string;
  value:       string;
  onChange:    (v: string) => void;
  onEnter?:    () => void;
  placeholder?: string;
  error?:      string;
  hint?:       string;
  autoFocus?:  boolean;
  suffix?:     React.ReactNode;
  inputRef?:   React.RefObject<HTMLInputElement>;
}

function StepInput({
  label, type = 'text', value, onChange, onEnter,
  placeholder, error, hint, suffix, inputRef,
}: InputProps) {
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); }
  };
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          autoComplete={type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'name'}
          className={`w-full rounded-xl border px-4 py-3 text-gray-900 text-base
            placeholder-gray-400 outline-none transition-all duration-150
            focus:ring-2 focus:ring-blue-500 focus:border-transparent
            ${error ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300 focus:bg-white'}`}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1">
          <span>⚠</span> {error}
        </p>
      )}
      {hint && !error && (
        <p className="mt-1.5 text-xs text-gray-400">{hint}</p>
      )}
    </div>
  );
}

// ─── BOTÃO PRIMÁRIO ───────────────────────────────────────────────────────────

function Btn({
  children, onClick, loading = false, disabled = false, type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full flex items-center justify-center gap-2 bg-blue-600
        hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-3 px-6
        rounded-xl transition-all duration-150 shadow-sm disabled:opacity-60
        disabled:cursor-not-allowed mt-6 text-base"
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : children}
    </button>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export default function AuthWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode,        setMode]        = useState<Mode>('welcome');
  const [loginStep,   setLoginStep]   = useState<LoginStep>(1);
  const [regStep,     setRegStep]     = useState<RegStep>(1);
  const [form,        setForm]        = useState<Form>({
    email: '', senha: '', confirmar: '', nome: '', lembrarMe: true,
  });
  const [showPwd,       setShowPwd]       = useState(false);
  const [showPwd2,      setShowPwd2]      = useState(false);
  const [esqueciSenha,  setEsqueciSenha]  = useState(false);
  const [error,         setError]         = useState('');
  const [loading,     setLoading]     = useState(false);
  const [animKey,     setAnimKey]     = useState(0);

  // Foca o input automaticamente em cada step
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [mode, loginStep, regStep]);

  function set(key: keyof Form, value: string | boolean) {
    setForm(f => ({ ...f, [key]: value }));
    setError('');
  }

  function advance() {
    setAnimKey(k => k + 1);
    setError('');
  }

  // ── LOGIN ──────────────────────────────────────────────────────────────────

  function handleLoginNext() {
    if (loginStep === 1) {
      const err = validateEmail(form.email);
      if (err) { setError(err); return; }
      setLoginStep(2); advance();
    } else {
      if (!form.senha) { setError('Informe sua senha'); return; }
      submitLogin();
    }
  }

  async function submitLogin() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: form.email, senha: form.senha, lembrarMe: form.lembrarMe }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Erro ao entrar'); return; }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  // ── CADASTRO ───────────────────────────────────────────────────────────────

  function handleRegNext() {
    if (regStep === 1) {
      const err = validateEmail(form.email);
      if (err) { setError(err); return; }
      setRegStep(2); advance();

    } else if (regStep === 2) {
      if (form.senha.length < 8) { setError('Mínimo 8 caracteres'); return; }
      if (passwordStrength(form.senha) < 2) { setError('Escolha uma senha mais forte'); return; }
      setRegStep(3); advance();

    } else if (regStep === 3) {
      if (!form.confirmar) { setError('Confirme a senha'); return; }
      if (form.confirmar !== form.senha) { setError('As senhas não coincidem'); return; }
      setRegStep(4); advance();

    } else if (regStep === 4) {
      const nome = form.nome.trim();
      if (!nome) { setError('Informe seu nome'); return; }
      if (nome.length < 2) { setError('Nome muito curto'); return; }
      setRegStep(5); advance();

    } else if (regStep === 5) {
      submitRegister();
    }
  }

  async function submitRegister() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: form.email, senha: form.senha, nome: form.nome.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar conta');
        if (data.field === 'email') { setRegStep(1); advance(); }
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function goWelcome() {
    setMode('welcome');
    setLoginStep(1); setRegStep(1);
    setForm({ email: '', senha: '', confirmar: '', nome: '', lembrarMe: true });
    setError(''); setShowPwd(false); setShowPwd2(false);
    advance();
  }

  function handleRegBack() {
    setError('');
    if (regStep > 1) {
      setRegStep(s => (s - 1) as RegStep);
      advance();
    } else {
      goWelcome();
    }
  }

  // ── SENHA FORÇA ────────────────────────────────────────────────────────────

  const strength = passwordStrength(form.senha);
  const StrengthBar = () => (
    form.senha.length > 0 ? (
      <div className="mt-2.5">
        <div className="flex gap-1 mb-1">
          {[1,2,3,4].map(i => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                i <= strength ? STRENGTH[strength].bar : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-gray-400">{STRENGTH[strength].label}</p>
      </div>
    ) : null
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────

  const firstName = form.nome.trim().split(' ')[0];

  return (
    <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Logo />

        <div className="bg-white rounded-2xl shadow-md overflow-hidden">
          <div className="p-7">

            {/* ── CONTEÚDO ANIMADO ── */}
            <div key={animKey} className="auth-step-enter">

              {/* ===== WELCOME ===== */}
              {mode === 'welcome' && (
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 mb-1">Bem-vindo!</h1>
                  <p className="text-gray-500 text-sm mb-8">
                    Gerencie suas notas fiscais de forma simples e segura.
                  </p>
                  <button
                    onClick={() => { setMode('login'); advance(); }}
                    className="w-full flex items-center justify-between bg-blue-600
                      hover:bg-blue-700 text-white font-medium py-3.5 px-5
                      rounded-xl transition-all duration-150 shadow-sm mb-3"
                  >
                    <span>Entrar na conta</span>
                    <ArrowRight size={18} />
                  </button>
                  <button
                    onClick={() => { setMode('register'); advance(); }}
                    className="w-full flex items-center justify-between border border-gray-200
                      hover:border-blue-300 hover:bg-blue-50 text-gray-700 font-medium
                      py-3.5 px-5 rounded-xl transition-all duration-150"
                  >
                    <span>Criar conta</span>
                    <ArrowRight size={18} />
                  </button>
                </div>
              )}

              {/* ===== LOGIN ===== */}
              {mode === 'login' && (
                <div>
                  <button
                    onClick={goWelcome}
                    className="flex items-center gap-1.5 text-sm text-gray-400
                      hover:text-gray-600 transition-colors mb-6"
                  >
                    <ArrowLeft size={14} /> Voltar
                  </button>

                  <h2 className="text-xl font-bold text-gray-900 mb-1">
                    {loginStep === 1 ? 'Qual é o seu e-mail?' : 'Digite sua senha'}
                  </h2>
                  <p className="text-sm text-gray-400 mb-6">
                    {loginStep === 1
                      ? 'Use o e-mail cadastrado na sua conta.'
                      : `Entrando como ${form.email}`}
                  </p>

                  {loginStep === 1 && (
                    <StepInput
                      label="E-mail"
                      type="email"
                      value={form.email}
                      onChange={v => set('email', v)}
                      onEnter={handleLoginNext}
                      placeholder="seu@email.com"
                      error={error}
                      inputRef={inputRef}
                    />
                  )}

                  {loginStep === 2 && (
                    <>
                      {esqueciSenha ? (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-2">
                          <p className="font-semibold">Redefinição de senha</p>
                          <p>
                            Para redefinir sua senha, entre em contato com o suporte informando
                            o e-mail cadastrado: <span className="font-medium">{form.email}</span>
                          </p>
                          <button
                            onClick={() => setEsqueciSenha(false)}
                            className="text-blue-600 font-semibold hover:underline text-xs mt-1"
                          >
                            Voltar para o login
                          </button>
                        </div>
                      ) : (
                        <>
                          <StepInput
                            label="Senha"
                            type={showPwd ? 'text' : 'password'}
                            value={form.senha}
                            onChange={v => set('senha', v)}
                            onEnter={handleLoginNext}
                            placeholder="••••••••"
                            error={error}
                            inputRef={inputRef}
                            suffix={
                              <button
                                type="button"
                                onClick={() => setShowPwd(p => !p)}
                                className="text-gray-400 hover:text-gray-600"
                                tabIndex={-1}
                              >
                                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                            }
                          />
                          <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={form.lembrarMe}
                              onChange={e => set('lembrarMe', e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600"
                            />
                            <span className="text-sm text-gray-600">Lembrar de mim por 30 dias</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setEsqueciSenha(true)}
                            className="mt-3 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            Esqueci minha senha
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {!esqueciSenha && (
                    <Btn onClick={handleLoginNext} loading={loading}>
                      {loginStep === 1 ? 'Avançar' : 'Entrar'}
                      {!loading && <ArrowRight size={16} />}
                    </Btn>
                  )}

                  <ProgressDots total={2} current={loginStep - 1} />
                </div>
              )}

              {/* ===== CADASTRO ===== */}
              {mode === 'register' && (
                <div>
                  <button
                    onClick={handleRegBack}
                    className="flex items-center gap-1.5 text-sm text-gray-400
                      hover:text-gray-600 transition-colors mb-6"
                  >
                    <ArrowLeft size={14} /> Voltar
                  </button>

                  {/* Etapa 1 — E-mail */}
                  {regStep === 1 && (
                    <>
                      <h2 className="text-xl font-bold text-gray-900 mb-1">Criar sua conta</h2>
                      <p className="text-sm text-gray-400 mb-6">Qual é o seu e-mail?</p>
                      <StepInput
                        label="E-mail"
                        type="email"
                        value={form.email}
                        onChange={v => set('email', v)}
                        onEnter={handleRegNext}
                        placeholder="seu@email.com"
                        error={error}
                        inputRef={inputRef}
                      />
                    </>
                  )}

                  {/* Etapa 2 — Senha */}
                  {regStep === 2 && (
                    <>
                      <h2 className="text-xl font-bold text-gray-900 mb-1">Escolha uma senha</h2>
                      <p className="text-sm text-gray-400 mb-6">Mínimo 8 caracteres.</p>
                      <StepInput
                        label="Senha"
                        type={showPwd ? 'text' : 'password'}
                        value={form.senha}
                        onChange={v => set('senha', v)}
                        onEnter={handleRegNext}
                        placeholder="••••••••"
                        error={error}
                        inputRef={inputRef}
                        suffix={
                          <button
                            type="button"
                            onClick={() => setShowPwd(p => !p)}
                            className="text-gray-400 hover:text-gray-600"
                            tabIndex={-1}
                          >
                            {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        }
                      />
                      <StrengthBar />
                    </>
                  )}

                  {/* Etapa 3 — Confirmar senha */}
                  {regStep === 3 && (
                    <>
                      <h2 className="text-xl font-bold text-gray-900 mb-1">Confirme a senha</h2>
                      <p className="text-sm text-gray-400 mb-6">Digite a senha novamente.</p>
                      <StepInput
                        label="Confirmar senha"
                        type={showPwd2 ? 'text' : 'password'}
                        value={form.confirmar}
                        onChange={v => set('confirmar', v)}
                        onEnter={handleRegNext}
                        placeholder="••••••••"
                        error={error}
                        inputRef={inputRef}
                        suffix={
                          <button
                            type="button"
                            onClick={() => setShowPwd2(p => !p)}
                            className="text-gray-400 hover:text-gray-600"
                            tabIndex={-1}
                          >
                            {showPwd2 ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        }
                      />
                    </>
                  )}

                  {/* Etapa 4 — Nome */}
                  {regStep === 4 && (
                    <>
                      <h2 className="text-xl font-bold text-gray-900 mb-1">Como você se chama?</h2>
                      <p className="text-sm text-gray-400 mb-6">Seu nome aparecerá no painel.</p>
                      <StepInput
                        label="Seu nome"
                        type="text"
                        value={form.nome}
                        onChange={v => set('nome', v)}
                        onEnter={handleRegNext}
                        placeholder="João Silva"
                        error={error}
                        inputRef={inputRef}
                      />
                    </>
                  )}

                  {/* Etapa 5 — Revisão */}
                  {regStep === 5 && (
                    <>
                      <h2 className="text-xl font-bold text-gray-900 mb-1">
                        Tudo certo, {firstName}!
                      </h2>
                      <p className="text-sm text-gray-400 mb-6">Confira seus dados antes de continuar.</p>

                      <div className="space-y-3">
                        {[
                          { icon: <Mail size={14} />,    label: 'E-mail', value: form.email },
                          { icon: <Lock size={14} />,    label: 'Senha',  value: '•'.repeat(Math.min(form.senha.length, 12)) },
                          { icon: <User size={14} />,    label: 'Nome',   value: form.nome.trim() },
                        ].map(({ icon, label, value }) => (
                          <div key={label} className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-xl">
                            <span className="text-blue-500 shrink-0">{icon}</span>
                            <div className="min-w-0">
                              <p className="text-xs text-gray-400">{label}</p>
                              <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
                            </div>
                            <Check size={14} className="text-emerald-500 shrink-0 ml-auto" />
                          </div>
                        ))}
                      </div>

                      {error && (
                        <p className="mt-3 text-sm text-red-500 text-center">⚠ {error}</p>
                      )}
                    </>
                  )}

                  <Btn onClick={handleRegNext} loading={loading}>
                    {regStep < 5
                      ? <><span>Avançar</span><ArrowRight size={16} /></>
                      : <><span>Criar conta</span><Check size={16} /></>}
                  </Btn>

                  <ProgressDots total={5} current={regStep - 1} />
                </div>
              )}

            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-5">
          Seus dados estão protegidos com criptografia.
        </p>
      </div>
    </div>
  );
}
