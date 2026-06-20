/**
 * Validação de dígito verificador — CNPJ e CPF.
 * Algoritmo padrão Receita Federal. Rejeita sequências repetidas (00000000000000).
 */

function strip(doc: string): string {
  return doc.replace(/\D/g, '');
}

export function validarCNPJ(cnpj: string): boolean {
  const d = strip(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;

  const soma = (digits: string, weights: number[]) =>
    weights.reduce((acc, w, i) => acc + parseInt(digits[i]) * w, 0);

  const dv1 = soma(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const r1 = dv1 % 11 < 2 ? 0 : 11 - (dv1 % 11);
  if (r1 !== parseInt(d[12])) return false;

  const dv2 = soma(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const r2 = dv2 % 11 < 2 ? 0 : 11 - (dv2 % 11);
  return r2 === parseInt(d[13]);
}

export function validarCPF(cpf: string): boolean {
  const d = strip(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;

  const dv1 = [10, 9, 8, 7, 6, 5, 4, 3, 2]
    .reduce((acc, w, i) => acc + parseInt(d[i]) * w, 0);
  const r1 = (dv1 * 10) % 11;
  if ((r1 === 10 ? 0 : r1) !== parseInt(d[9])) return false;

  const dv2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]
    .reduce((acc, w, i) => acc + parseInt(d[i]) * w, 0);
  const r2 = (dv2 * 10) % 11;
  return (r2 === 10 ? 0 : r2) === parseInt(d[10]);
}

export function validarDocumento(doc: string): {
  valido: boolean;
  tipo: 'CNPJ' | 'CPF' | 'DESCONHECIDO';
} {
  const d = strip(doc);
  if (d.length === 14) return { valido: validarCNPJ(doc), tipo: 'CNPJ' };
  if (d.length === 11) return { valido: validarCPF(doc),  tipo: 'CPF'  };
  return { valido: false, tipo: 'DESCONHECIDO' };
}
