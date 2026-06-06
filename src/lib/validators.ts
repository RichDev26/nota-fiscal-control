export function validarCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  return rest === parseInt(c[10]);
}

export function validarCNPJ(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (str: string, weights: number[]) =>
    weights.reduce((s, w, i) => s + parseInt(str[i]) * w, 0);
  const mod = (n: number) => {
    const r = n % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = mod(calc(c, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  const d2 = mod(calc(c, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return parseInt(c[12]) === d1 && parseInt(c[13]) === d2;
}

export function validarCpfCnpj(valor: string): boolean {
  const v = valor.replace(/\D/g, '');
  if (v.length === 11) return validarCPF(v);
  if (v.length === 14) return validarCNPJ(v);
  return false;
}

export function formatarCpfCnpj(valor: string): string {
  const v = valor.replace(/\D/g, '');
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return valor;
}

export function formatarMoeda(valor: number | null | undefined): string {
  if (valor == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

export function formatarData(data: string | Date | null | undefined): string {
  if (!data) return '—';
  // Strings ISO "YYYY-MM-DD": parse manualmente para evitar shift de fuso horário.
  // new Date('2026-05-19') interpreta como UTC 00:00, que em UTC-3 vira 18/05!
  if (typeof data === 'string') {
    const iso = data.split('T')[0];
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = typeof data === 'string' ? new Date(data) : data;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function parseDateBR(str: string): Date | null {
  if (!str) return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function formatarAliquota(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(2)}%`;
}
