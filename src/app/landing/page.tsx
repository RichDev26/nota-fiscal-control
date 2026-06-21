import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WorkPro Control — Notas fiscais por IA',
  description: 'O WorkPro Control lê o PDF da sua nota, extrai todos os dados automaticamente e ainda controla seus impostos — sem você digitar uma linha sequer.',
};

function s(css: string): React.CSSProperties {
  const obj: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = trimmed.slice(0, colonIdx).trim()
      .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    obj[prop] = trimmed.slice(colonIdx + 1).trim();
  }
  return obj as React.CSSProperties;
}

export default function LandingPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .lp *{box-sizing:border-box;}
        .lp summary::-webkit-details-marker{display:none;}
        .lp summary{list-style:none;}
        .lp details[open] .acc-plus{transform:rotate(45deg);}
        .lp .acc-plus{transition:transform .2s ease;}
        .lp a{text-decoration:none;color:inherit;}
        @media(min-width:760px){.lp .sticky-cta{display:none !important;}}
        @media(max-width:760px){
          .lp .nav-links{display:none !important;}
          .lp .grid-3,.lp .grid-2{grid-template-columns:1fr !important;}
          .lp .offer-grid{grid-template-columns:1fr !important;}
          .lp .float-phone{display:none !important;}
        }
      `}</style>

      <div className="lp" style={s("background:#F6F6F3;color:#1B1B1A;font-family:'Hanken Grotesk',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;")}>

        {/* NAV */}
        <nav style={s("position:sticky;top:0;z-index:50;background:rgba(246,246,243,0.82);backdrop-filter:blur(12px);border-bottom:1px solid rgba(0,0,0,0.05);")}>
          <div style={s("max-width:1180px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:24px;")}>
            <a href="#topo" style={s("display:flex;align-items:center;gap:11px;")}>
              <img src="/logo.png" alt="WorkPro Control" style={s("width:38px;height:38px;display:block;flex:none;")} />
              <span style={s("display:flex;flex-direction:column;line-height:1.05;")}>
                <span style={s("font-weight:700;font-size:16px;letter-spacing:-0.01em;white-space:nowrap;")}>WorkPro Control</span>
                <span style={s("font-size:11px;color:#8A8A82;font-weight:500;")}>Notas fiscais por IA</span>
              </span>
            </a>
            <div style={s("display:flex;align-items:center;gap:30px;font-size:14.5px;font-weight:500;color:#56564F;")}>
              <div style={s("display:flex;gap:30px;")} className="nav-links">
                <a href="#como-funciona">Como funciona</a>
                <a href="#beneficios">Recursos</a>
                <a href="#preco">Preço</a>
                <a href="#faq">FAQ</a>
              </div>
            </div>
            <a href="#preco" style={s("background:#2563EB;color:#fff;font-weight:600;font-size:14.5px;padding:11px 20px;border-radius:999px;white-space:nowrap;")}>Começar grátis</a>
          </div>
        </nav>

        {/* HERO */}
        <header id="topo" style={s("position:relative;max-width:1180px;margin:0 auto;padding:78px 24px 0;text-align:center;")}>
          <div style={s("display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid rgba(0,0,0,0.06);padding:7px 15px;border-radius:999px;font-size:13px;font-weight:600;color:#56564F;box-shadow:0 1px 2px rgba(0,0,0,0.03);")}>
            <span style={s("width:7px;height:7px;border-radius:50%;background:#2563EB;display:inline-block;")}></span>
            7 dias grátis · sem cartão de crédito
          </div>
          <h1 style={s("font-family:Georgia,serif;font-weight:500;font-size:clamp(42px,7vw,86px);line-height:1.0;letter-spacing:-0.02em;margin:26px auto 0;max-width:14ch;")}>
            Chega de montar relatório fiscal na madrugada.
          </h1>
          <p style={s("font-size:clamp(17px,2vw,20px);line-height:1.55;color:#56564F;max-width:50ch;margin:24px auto 0;")}>
            O WorkPro Control lê o PDF da sua nota, extrai todos os dados automaticamente e ainda controla seus impostos — sem você digitar uma linha sequer.
          </p>
          <div style={s("margin-top:32px;display:flex;flex-direction:column;align-items:center;gap:12px;")}>
            <a href="#preco" style={s("background:#2563EB;color:#fff;font-weight:600;font-size:17px;padding:16px 34px;border-radius:999px;box-shadow:0 10px 24px -8px rgba(37,99,235,0.55);")}>
              Começar grátis por 7 dias
            </a>
            <span style={s("font-size:13px;color:#8A8A82;font-weight:500;")}>Sem cartão de crédito • Cancele quando quiser</span>
          </div>

          {/* phone + blob */}
          <div style={s("position:relative;margin-top:54px;padding-bottom:8px;display:flex;justify-content:center;")}>
            <div style={s("position:absolute;inset:0;display:flex;justify-content:center;align-items:flex-start;pointer-events:none;")}>
              <div style={s("width:min(720px,92vw);height:560px;margin-top:40px;background:radial-gradient(38% 46% at 32% 42%, rgba(37,99,235,0.20), transparent 70%), radial-gradient(40% 44% at 70% 56%, rgba(232,148,120,0.30), transparent 72%), radial-gradient(46% 50% at 52% 78%, rgba(120,180,140,0.22), transparent 74%);filter:blur(38px);")}></div>
            </div>
            <div style={s("position:relative;width:296px;background:#15161A;border-radius:46px;padding:11px;box-shadow:0 40px 80px -28px rgba(20,22,26,0.55),0 0 0 1px rgba(0,0,0,0.04);")}>
              <div style={s("position:absolute;top:20px;left:50%;transform:translateX(-50%);width:88px;height:26px;background:#15161A;border-radius:999px;z-index:2;")}></div>
              <img src="/painel-mobile.png" alt="Painel WorkPro Control no celular" style={s("display:block;width:100%;border-radius:36px;")} />
            </div>
          </div>
        </header>

        {/* 3-UP MINI BENEFITS */}
        <section style={s("max-width:1000px;margin:0 auto;padding:64px 24px 18px;")}>
          <div className="grid-3" style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:24px;text-align:center;")}>
            <div style={s("display:flex;flex-direction:column;align-items:center;gap:14px;")}>
              <span style={s("width:52px;height:52px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.04);")}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M4 20l4-1 9.5-9.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 15l-1 5z" stroke="#2563EB" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="M3 21h18" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
              <p style={s("font-family:'Newsreader',serif;font-size:21px;line-height:1.2;margin:0;")}>Fim da digitação<br />manual</p>
            </div>
            <div style={s("display:flex;flex-direction:column;align-items:center;gap:14px;")}>
              <span style={s("width:52px;height:52px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.04);")}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8.5" stroke="#2563EB" strokeWidth="1.7" />
                  <path d="M12 7.5V12l3 2" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <p style={s("font-family:'Newsreader',serif;font-size:21px;line-height:1.2;margin:0;")}>Nunca mais<br />imposto vencido</p>
            </div>
            <div style={s("display:flex;flex-direction:column;align-items:center;gap:14px;")}>
              <span style={s("width:52px;height:52px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.04);")}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="3" width="14" height="18" rx="2" stroke="#2563EB" strokeWidth="1.7" />
                  <path d="M9 9h6M9 13h6M9 17h3" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
              <p style={s("font-family:'Newsreader',serif;font-size:21px;line-height:1.2;margin:0;")}>Relatório pro<br />contador em 1 clique</p>
            </div>
          </div>
          <p style={s("text-align:center;font-size:13px;color:#A0A099;margin:34px 0 0;font-family:ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:0.02em;")}>
            Focado em NFS-e — nota fiscal de serviço eletrônica
          </p>
        </section>

        {/* PROBLEM */}
        <section style={s("max-width:1180px;margin:0 auto;padding:96px 24px 0;")}>
          <div style={s("max-width:780px;margin:0 auto;text-align:center;")}>
            <p style={s("font-size:13px;font-weight:700;letter-spacing:0.14em;color:#2563EB;text-transform:uppercase;margin:0 0 16px;")}>A rotina de quem é PJ</p>
            <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(32px,4.4vw,52px);line-height:1.06;letter-spacing:-0.02em;margin:0;")}>Todo mês, a mesma história.</h2>
            <p style={s("font-size:18px;line-height:1.6;color:#56564F;margin:22px auto 0;max-width:54ch;")}>
              Você abre PDF por PDF, digita os dados na mão, tenta lembrar quem te pagou — e no fim ainda monta um relatório pro contador do zero. Isso não é gestão, é retrabalho. E está te custando horas.
            </p>
          </div>
          <div className="grid-2" style={s("display:grid;grid-template-columns:repeat(2,1fr);gap:16px;max-width:880px;margin:46px auto 0;")}>
            {[
              'Abrindo PDF por PDF pra digitar os dados num controle manual.',
              'Sem saber quanto deve de imposto até juntar tudo de novo.',
              'Perdendo prazo de pagamento por não ter um lugar que avisasse.',
              'Notas espalhadas entre e-mail, Drive, pasta do PC e algum caderno.',
              'Montando o relatório do trimestre na véspera, na raça.',
              'Sem histórico de nada — e rezando pra nunca ter uma auditoria.',
            ].map((text, i) => (
              <div key={i} style={s("background:#fff;border:1px solid rgba(0,0,0,0.05);border-radius:16px;padding:22px 24px;display:flex;gap:14px;align-items:flex-start;")}>
                <span style={s("color:#C7483B;font-size:18px;line-height:1.4;flex:none;")}>✕</span>
                <p style={s("margin:0;font-size:15.5px;line-height:1.5;color:#3A3A36;")}>{text}</p>
              </div>
            ))}
          </div>
          <p style={s("text-align:center;font-family:'Newsreader',serif;font-size:22px;color:#1B1B1A;margin:38px auto 0;max-width:42ch;")}>
            Isso não é culpa sua. É o custo real de ser PJ sem a ferramenta certa.
          </p>
        </section>

        {/* SOLUTION / STEPS */}
        <section id="como-funciona" style={s("max-width:1180px;margin:0 auto;padding:104px 24px 0;")}>
          <div style={s("max-width:760px;margin:0 auto;text-align:center;")}>
            <p style={s("font-size:13px;font-weight:700;letter-spacing:0.14em;color:#2563EB;text-transform:uppercase;margin:0 0 16px;")}>Como funciona</p>
            <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(34px,5vw,60px);line-height:1.02;letter-spacing:-0.02em;margin:0;")}>
              Você fez a nota.<br />A IA faz o resto.
            </h2>
            <p style={s("font-size:18px;line-height:1.6;color:#56564F;margin:22px auto 0;max-width:50ch;")}>
              Número da nota, datas, valor bruto, deduções, ISS, tomador, CNPJ — tudo extraído automaticamente, revisado por você em segundos e salvo com o PDF original junto.
            </p>
          </div>
          <div className="grid-3" style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:980px;margin:52px auto 0;")}>
            {[
              { n: '1', title: 'Faça upload do PDF', desc: 'Arraste a nota fiscal que você já emitiu no portal da prefeitura.' },
              { n: '2', title: 'A IA extrai tudo', desc: 'Em segundos, todos os campos são lidos e preenchidos por você.' },
              { n: '3', title: 'Revise e pronto', desc: 'Confira, salve, e seus impostos já entram no painel — totalizados.' },
            ].map((step) => (
              <div key={step.n} style={s("background:#fff;border:1px solid rgba(0,0,0,0.05);border-radius:20px;padding:32px 28px;box-shadow:0 4px 14px rgba(0,0,0,0.03);")}>
                <span style={s("display:inline-flex;width:38px;height:38px;border-radius:50%;background:#EAF0FE;color:#2563EB;font-weight:700;align-items:center;justify-content:center;font-size:16px;")}>{step.n}</span>
                <h3 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:23px;margin:20px 0 8px;")}>{step.title}</h3>
                <p style={s("margin:0;font-size:15px;line-height:1.55;color:#6B6B64;")}>{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* DEVICE SHOWCASE */}
        <section style={s("max-width:1180px;margin:0 auto;padding:104px 24px 0;")}>
          <div style={s("max-width:720px;margin:0 auto 8px;text-align:center;")}>
            <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(32px,4.4vw,52px);line-height:1.05;letter-spacing:-0.02em;margin:0;")}>
              No computador às 22h. No celular saindo da reunião.
            </h2>
            <p style={s("font-size:18px;line-height:1.6;color:#56564F;margin:20px auto 0;max-width:48ch;")}>
              O mesmo painel, em qualquer tela. Lançou uma nota no celular? Funciona. Gerou o relatório no notebook? Também.
            </p>
          </div>
          <div style={s("position:relative;margin:56px auto 0;max-width:1000px;")}>
            <div style={s("background:linear-gradient(135deg,#EEF2FB,#F3EEEA);border-radius:28px;padding:50px 42px 44px;border:1px solid rgba(0,0,0,0.04);")}>
              <div style={s("max-width:740px;margin:0 auto;")}>
                <div style={s("position:relative;background:#1B1C21;border-radius:16px 16px 5px 5px;padding:13px;box-shadow:0 26px 60px -26px rgba(20,22,40,0.5);")}>
                  <div style={s("position:absolute;top:5px;left:50%;transform:translateX(-50%);width:6px;height:6px;border-radius:50%;background:#34353B;")}></div>
                  <div style={s("border-radius:5px;overflow:hidden;background:#fff;")}>
                    <img src="/painel-desktop.png" alt="Painel WorkPro Control no computador" style={s("display:block;width:100%;")} />
                  </div>
                </div>
                <div style={s("position:relative;height:15px;margin:0 -44px;background:linear-gradient(#dadce1,#b4b7c0);border-radius:0 0 13px 13px;box-shadow:0 16px 26px -14px rgba(0,0,0,0.34);")}>
                  <div style={s("position:absolute;top:0;left:50%;transform:translateX(-50%);width:128px;height:7px;background:#a9acb5;border-radius:0 0 9px 9px;")}></div>
                </div>
              </div>
            </div>
            <div className="float-phone" style={s("position:absolute;right:-6px;bottom:-26px;width:184px;background:#15161A;border-radius:30px;padding:7px;box-shadow:0 30px 60px -20px rgba(20,22,26,0.5);")}>
              <div style={s("position:absolute;top:13px;left:50%;transform:translateX(-50%);width:58px;height:17px;background:#15161A;border-radius:999px;z-index:2;")}></div>
              <img src="/painel-mobile.png" alt="Painel no celular" style={s("display:block;width:100%;border-radius:24px;")} />
            </div>
          </div>
        </section>

        {/* BENEFITS */}
        <section id="beneficios" style={s("max-width:1180px;margin:0 auto;padding:120px 24px 0;")}>
          <div style={s("max-width:680px;margin:0 auto;text-align:center;")}>
            <p style={s("font-size:13px;font-weight:700;letter-spacing:0.14em;color:#2563EB;text-transform:uppercase;margin:0 0 16px;")}>O que muda na sua vida</p>
            <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(32px,4.4vw,52px);line-height:1.05;letter-spacing:-0.02em;margin:0;")}>
              Controle fiscal de verdade, sem virar contador de si mesmo.
            </h2>
          </div>
          <div className="grid-3" style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:52px auto 0;")}>
            {[
              {
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12.5L10 17.5L19 7" stroke="#2563EB" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
                title: 'Fim da digitação manual',
                desc: 'A IA lê o PDF e preenche tudo. Você só revisa e confirma.',
              },
              {
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.3" stroke="#2563EB" strokeWidth="1.8" /><path d="M12 7.5V12l3 2" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
                title: 'Nunca mais imposto vencido',
                desc: 'Todas as obrigações num painel só, com totais de pendente, pago e vencido.',
              },
              {
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3v12M12 15l-4-4M12 15l4-4" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" /></svg>,
                title: 'Relatório em 1 clique',
                desc: 'Selecione o período, exporte em PDF ou Excel. Pronto, sem montar nada.',
              },
              {
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="#2563EB" strokeWidth="1.8" /><path d="M16 16l4 4" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" /></svg>,
                title: 'Todas as notas num lugar só',
                desc: 'Com PDF original sempre acessível e busca por tomador, CNPJ ou número.',
              },
              {
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 7l8-4 8 4-8 4-8-4z" stroke="#2563EB" strokeWidth="1.8" strokeLinejoin="round" /><path d="M4 7v6l8 4 8-4V7" stroke="#2563EB" strokeWidth="1.8" strokeLinejoin="round" /></svg>,
                title: 'Histórico completo',
                desc: 'O que mudou, quem alterou, quando. Ideal pra quem trabalha com contador.',
              },
              {
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="18" rx="2.5" stroke="#2563EB" strokeWidth="1.8" /><path d="M11 18h2" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" /></svg>,
                title: 'Seus dados são só seus',
                desc: 'Cada conta é isolada. Ninguém acessa suas notas além de você.',
              },
            ].map((item, i) => (
              <div key={i} style={s("background:#fff;border:1px solid rgba(0,0,0,0.05);border-radius:18px;padding:28px;")}>
                <span style={s("display:inline-flex;width:42px;height:42px;border-radius:11px;background:#EAF0FE;align-items:center;justify-content:center;")}>{item.icon}</span>
                <h3 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:21px;margin:18px 0 7px;")}>{item.title}</h3>
                <p style={s("margin:0;font-size:14.5px;line-height:1.55;color:#6B6B64;")}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* SOCIAL PROOF */}
        <section style={s("max-width:1180px;margin:0 auto;padding:104px 24px 0;text-align:center;")}>
          <p style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(40px,6vw,76px);line-height:1;letter-spacing:-0.02em;margin:0;color:#2563EB;")}>+800</p>
          <p style={s("font-size:19px;color:#3A3A36;margin:16px auto 0;max-width:40ch;")}>
            prestadores de serviço já organizaram suas notas com o WorkPro Control.
          </p>
        </section>

        {/* PRICING */}
        <section id="preco" style={s("max-width:1180px;margin:0 auto;padding:104px 24px 0;")}>
          <div style={s("max-width:640px;margin:0 auto 44px;text-align:center;")}>
            <p style={s("font-size:13px;font-weight:700;letter-spacing:0.14em;color:#2563EB;text-transform:uppercase;margin:0 0 16px;")}>A oferta</p>
            <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(32px,4.4vw,52px);line-height:1.05;letter-spacing:-0.02em;margin:0;")}>Um plano. Tudo incluso.</h2>
          </div>
          <div className="offer-grid" style={s("display:grid;grid-template-columns:1.05fr 0.95fr;gap:0;max-width:960px;margin:0 auto;border-radius:26px;overflow:hidden;box-shadow:0 30px 70px -30px rgba(20,22,40,0.5);")}>
            <div style={s("background:#fff;padding:44px 42px;border:1px solid rgba(0,0,0,0.06);border-right:none;")}>
              <h3 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:26px;margin:0 0 4px;")}>WorkPro Control</h3>
              <p style={s("margin:0 0 26px;color:#8A8A82;font-size:14px;font-weight:500;")}>Plano único · tudo que você precisa</p>
              <div style={s("display:flex;flex-direction:column;gap:15px;")}>
                {[
                  'Lançamento automático de NFS-e por IA',
                  'Controle completo de impostos no mesmo painel',
                  'Relatórios em PDF e Excel com 1 clique',
                  'Busca, filtros e histórico de alterações',
                  'Dashboard com visão do mês e histórico total',
                  'Acesso completo no celular e no desktop',
                  '30 extrações de PDF por hora, processamento estável',
                ].map((feat, i) => (
                  <div key={i} style={s("display:flex;gap:12px;align-items:flex-start;")}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={s("flex:none;margin-top:1px;")}>
                      <circle cx="12" cy="12" r="10" fill="#EAF0FE" />
                      <path d="M8 12.2l2.6 2.6L16 9" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span style={s("font-size:15px;line-height:1.45;color:#2D2D29;")}>{feat}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={s("background:#15161A;color:#fff;padding:44px 40px;display:flex;flex-direction:column;justify-content:center;text-align:center;")}>
              <span style={s("align-self:center;background:rgba(37,99,235,0.22);color:#9FBEFF;font-weight:700;font-size:12.5px;letter-spacing:0.04em;padding:6px 13px;border-radius:999px;")}>
                75% OFF · POR TEMPO LIMITADO
              </span>
              <p style={s("margin:20px 0 0;color:#7C7E86;font-size:15px;")}>
                <span style={s("text-decoration:line-through;")}>De R$ 199,90/mês</span>
              </p>
              <div style={s("display:flex;align-items:baseline;justify-content:center;gap:6px;margin-top:4px;")}>
                <span style={s("font-family:'Newsreader',serif;font-weight:500;font-size:64px;line-height:1;")}>R$ 49,90</span>
              </div>
              <p style={s("margin:6px 0 0;color:#A6A8AF;font-size:14px;")}>por mês</p>
              <a href="#" style={s("margin:26px 0 0;background:#fff;color:#15161A;font-weight:700;font-size:16px;padding:15px 24px;border-radius:999px;")}>
                Começar grátis por 7 dias
              </a>
              <p style={s("margin:16px 0 0;color:#8A8C93;font-size:12.5px;line-height:1.5;")}>
                Sem cartão no teste · Cartão de crédito ou Pix<br />
                Cancele quando quiser, sem multa
              </p>
            </div>
          </div>
        </section>

        {/* OBJECTIONS */}
        <section style={s("max-width:820px;margin:0 auto;padding:104px 24px 0;")}>
          <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(30px,4vw,46px);line-height:1.05;letter-spacing:-0.02em;margin:0 0 28px;text-align:center;")}>
            Antes que você pergunte
          </h2>
          <div style={s("background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:18px;padding:6px 26px;")}>
            {[
              { q: 'Meus dados fiscais estão seguros?', a: 'Com certeza. Cada conta é completamente isolada — nenhum outro usuário acessa suas notas, PDFs ou dados tributários. Os arquivos ficam fora de pasta pública e o acesso é sempre autenticado. Seus dados são seus, e só seus.' },
              { q: 'Funciona com qualquer nota fiscal?', a: 'É focado em NFS-e — nota fiscal de serviço eletrônica. Se você presta serviço e emite NFS-e, é exatamente pra você. O sistema organiza suas notas, mas não emite: você continua emitindo pelo portal da prefeitura, e o Control cuida do que vem depois.' },
              { q: 'Preciso entender muito de imposto pra usar?', a: 'Não. Você cadastra suas obrigações (ou usa as sugestões do sistema) e o WorkPro Control organiza e totaliza tudo automaticamente. Você não precisa ser contador — só saber que tem impostos a pagar. O Control te mostra o quê, quanto e quando.' },
              { q: 'E se eu tiver muitas notas pra lançar de uma vez?', a: 'Sem problema. O sistema processa até 30 extrações de PDF por hora — generoso pra qualquer prestador. O limite garante processamento estável e preciso. Volume extraordinário? É só distribuir em lotes.' },
              { q: 'Uma conta serve só pra uma empresa?', a: 'Por enquanto, sim — uma conta equivale a um CNPJ. Se você gerencia mais de uma empresa, vai precisar de uma conta por empresa. Funcionalidade multiempresa está no roadmap.' },
            ].map((item, i, arr) => (
              <details key={i} style={i < arr.length - 1 ? s("border-bottom:1px solid #EDEDE8;") : undefined}>
                <summary style={s("display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 0;cursor:pointer;font-weight:600;font-size:17px;")}>
                  {item.q}
                  <span className="acc-plus" style={s("color:#2563EB;font-size:22px;font-weight:400;flex:none;")}>+</span>
                </summary>
                <p style={s("margin:0;padding:0 0 22px;font-size:15.5px;line-height:1.6;color:#56564F;")}>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* GUARANTEE */}
        <section style={s("max-width:1180px;margin:0 auto;padding:104px 24px 0;")}>
          <div style={s("max-width:760px;margin:0 auto;background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:24px;padding:48px 44px;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,0.04);")}>
            <span style={s("display:inline-flex;width:58px;height:58px;border-radius:50%;background:#EAF0FE;align-items:center;justify-content:center;")}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" stroke="#2563EB" strokeWidth="1.7" strokeLinejoin="round" />
                <path d="M9 12l2 2 4-4" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(28px,3.6vw,42px);line-height:1.08;letter-spacing:-0.02em;margin:22px 0 0;")}>
              Se não funcionar pra você, você não paga. Simples assim.
            </h2>
            <p style={s("font-size:17px;line-height:1.6;color:#56564F;margin:18px auto 0;max-width:54ch;")}>
              São 7 dias pra testar completamente grátis, sem cartão. Se entrar, usar e achar que não faz sentido — é só sair. Sem cobrança, sem pergunta, sem burocracia. Produto que funciona não precisa prender cliente.
            </p>
          </div>
        </section>

        {/* URGENCY */}
        <section style={s("max-width:1180px;margin:0 auto;padding:104px 24px 0;")}>
          <div style={s("background:#2563EB;border-radius:26px;padding:56px 44px;text-align:center;color:#fff;position:relative;overflow:hidden;")}>
            <div style={s("position:absolute;inset:0;background:radial-gradient(40% 60% at 80% 20%, rgba(255,255,255,0.12), transparent 70%);")}></div>
            <div style={s("position:relative;")}>
              <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(30px,4.2vw,50px);line-height:1.05;letter-spacing:-0.02em;margin:0;")}>
                Esse preço não vai ficar assim.
              </h2>
              <p style={s("font-size:18px;line-height:1.6;color:#DCE6FF;margin:20px auto 0;max-width:52ch;")}>
                São 75% de desconto enquanto estamos em fase de expansão. Quando esse período acabar, o valor volta pra R$ 199,90/mês. Quem entrar agora trava o preço promocional enquanto mantiver a assinatura ativa.
              </p>
              <a href="#preco" style={s("display:inline-block;margin-top:30px;background:#fff;color:#15161A;font-weight:700;font-size:16.5px;padding:16px 32px;border-radius:999px;")}>
                Quero garantir meu desconto de 75%
              </a>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" style={s("max-width:820px;margin:0 auto;padding:104px 24px 0;")}>
          <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(30px,4vw,46px);line-height:1.05;letter-spacing:-0.02em;margin:0 0 28px;text-align:center;")}>
            Perguntas frequentes
          </h2>
          <div>
            {[
              { q: 'Preciso instalar alguma coisa?', a: 'Não. Funciona 100% no navegador — celular ou computador. É só acessar, fazer login e começar a usar.' },
              { q: 'Como funciona o período de teste?', a: 'São 7 dias com acesso completo a tudo, sem pedir cartão. Se gostar, assina ao final. Se não, é só não assinar — sem cobranças.' },
              { q: 'O WorkPro Control emite nota fiscal?', a: 'Não. Ele organiza as notas que você já emite. Você continua emitindo no portal da prefeitura, e o Control cuida da organização, controle e relatórios depois da emissão.' },
              { q: 'Serve pra quem nunca usou um sistema assim?', a: 'Sim. A interface foi pensada pra quem hoje usa planilha, pasta no Drive ou papel. Se você consegue fazer upload de um PDF, consegue usar o WorkPro Control.' },
              { q: 'E pra quem já tem volume grande de notas acumuladas?', a: 'Funciona também. Você lança notas antigas manualmente ou via upload de PDF. O sistema organiza por período, então dá pra construir um histórico desde quando quiser.' },
              { q: 'Quais as formas de pagamento?', a: 'Cartão de crédito ou Pix. Cobrança mensal, sem fidelidade. Cancele quando quiser direto pelo painel.' },
              { q: 'Posso cancelar a qualquer momento?', a: 'Sim. Sem multa, sem carência, sem ligação pra cancelar. Você controla sua assinatura diretamente pelo painel da sua conta.' },
            ].map((item, i, arr) => (
              <details key={i} style={i < arr.length - 1 ? s("border-bottom:1px solid #E7E7E1;") : undefined}>
                <summary style={s("display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 4px;cursor:pointer;font-weight:600;font-size:17px;")}>
                  {item.q}
                  <span className="acc-plus" style={s("color:#2563EB;font-size:22px;font-weight:400;flex:none;")}>+</span>
                </summary>
                <p style={s("margin:0;padding:0 4px 22px;font-size:15.5px;line-height:1.6;color:#56564F;")}>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* FINAL CTA */}
        <section style={s("max-width:1180px;margin:0 auto;padding:120px 24px 0;text-align:center;")}>
          <h2 style={s("font-family:'Newsreader',serif;font-weight:500;font-size:clamp(36px,5.4vw,68px);line-height:1.02;letter-spacing:-0.02em;margin:0 auto;max-width:18ch;")}>
            Você já perdeu tempo suficiente com isso.
          </h2>
          <p style={s("font-size:18px;line-height:1.6;color:#56564F;margin:24px auto 0;max-width:50ch;")}>
            Deixe o WorkPro Control fazer esse trabalho no seu lugar — pra você focar no que importa e terminar o dia sabendo que nada ficou esquecido.
          </p>
          <div style={s("margin-top:32px;display:flex;flex-direction:column;align-items:center;gap:12px;")}>
            <a href="#preco" style={s("background:#2563EB;color:#fff;font-weight:600;font-size:17px;padding:16px 36px;border-radius:999px;box-shadow:0 10px 24px -8px rgba(37,99,235,0.55);")}>
              Começar meus 7 dias grátis →
            </a>
            <span style={s("font-size:13px;color:#8A8A82;font-weight:500;")}>Desconto de 75% garantido pra quem entrar hoje</span>
          </div>
          <div style={s("max-width:620px;margin:64px auto 0;text-align:left;background:#fff;border:1px solid rgba(0,0,0,0.06);border-left:3px solid #2563EB;border-radius:14px;padding:26px 28px;")}>
            <p style={s("margin:0;font-size:15.5px;line-height:1.65;color:#3A3A36;")}>
              <strong style={s("font-weight:700;")}>PS:</strong>{' '}
              Se você chegou até aqui, é porque o problema é real. O WorkPro Control resolve isso por R$ 49,90/mês — menos do que uma hora do seu tempo faturado. Com 7 dias grátis, o risco é zero. O desconto de 75% é por tempo limitado.
            </p>
          </div>
        </section>

        {/* FOOTER */}
        <footer style={s("margin-top:104px;border-top:1px solid rgba(0,0,0,0.07);")}>
          <div style={s("max-width:1180px;margin:0 auto;padding:40px 24px;display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;")}>
            <div style={s("display:flex;align-items:center;gap:11px;")}>
              <img src="/logo.png" alt="WorkPro Control" style={s("width:32px;height:32px;display:block;flex:none;")} />
              <span style={s("font-weight:700;font-size:15px;")}>WorkPro Control</span>
            </div>
            <p style={s("margin:0;font-size:12.5px;color:#9A9A92;max-width:52ch;line-height:1.5;text-align:right;")}>
              Ao se cadastrar, você concorda com nossa Política de Privacidade e com o tratamento dos seus dados conforme a LGPD.
            </p>
          </div>
          <div style={s("max-width:1180px;margin:0 auto;padding:0 24px 32px;font-size:12px;color:#B0B0A8;")}>
            © 2026 WorkPro Control. Todos os direitos reservados.
          </div>
        </footer>

        {/* STICKY MOBILE CTA */}
        <a
          href="#preco"
          className="sticky-cta"
          style={s("position:fixed;left:16px;right:16px;bottom:16px;z-index:60;background:#2563EB;color:#fff;font-weight:700;font-size:16px;padding:15px;border-radius:14px;text-align:center;box-shadow:0 12px 30px -8px rgba(37,99,235,0.6);")}
        >
          Começar grátis por 7 dias
        </a>

      </div>
    </>
  );
}
