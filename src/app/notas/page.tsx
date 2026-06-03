'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { PlusCircle, Search, Filter, FileText, ArrowUpDown, ChevronLeft, ChevronRight, Trash2, Eye } from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { NotaFiscal } from '@/types';

const STATUS_OPTIONS = ['', 'rascunho', 'lancada', 'recebida', 'antecipada', 'incompleta', 'invalida', 'substitutiva', 'substituida', 'cancelada'];
const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Data Criação' },
  { value: 'dataEmissao', label: 'Data Emissão' },
  { value: 'dataVencimento', label: 'Vencimento' },
  { value: 'valorBruto', label: 'Valor' },
  { value: 'numeroNf', label: 'Número NF' },
];

function NotasContent() {
  const router = useRouter();
  const sp = useSearchParams();

  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [loading, setLoading] = useState(true);

  const [busca, setBusca] = useState(sp.get('busca') || '');
  const [status, setStatus] = useState(sp.get('status') || '');
  const [dataInicio, setDataInicio] = useState(sp.get('dataInicio') || '');
  const [dataFim, setDataFim] = useState(sp.get('dataFim') || '');
  const [ordenarPor, setOrdenarPor] = useState(sp.get('ordenarPor') || 'createdAt');
  const [ordem, setOrdem] = useState<'asc' | 'desc'>((sp.get('ordem') as 'asc' | 'desc') || 'desc');
  const [pagina, setPagina] = useState(parseInt(sp.get('pagina') || '1'));

  const fetchNotas = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      busca, status, dataInicio, dataFim, ordenarPor, ordem,
      pagina: String(pagina), por: '15',
    });
    try {
      const r = await fetch(`/api/notas?${params}`);
      const d = await r.json();
      setNotas(d.notas || []);
      setTotal(d.total || 0);
      setTotalPaginas(d.totalPaginas || 1);
    } finally {
      setLoading(false);
    }
  }, [busca, status, dataInicio, dataFim, ordenarPor, ordem, pagina]);

  useEffect(() => { fetchNotas(); }, [fetchNotas]);

  const handleDelete = async (id: string, nome: string) => {
    if (!confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita.`)) return;
    await fetch(`/api/notas/${id}`, { method: 'DELETE' });
    fetchNotas();
  };

  const toggleOrdem = (campo: string) => {
    if (ordenarPor === campo) setOrdem(o => o === 'asc' ? 'desc' : 'asc');
    else { setOrdenarPor(campo); setOrdem('desc'); }
    setPagina(1);
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notas Fiscais</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} nota{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/notas/nova" className="btn-primary">
          <PlusCircle size={16} /> Nova Nota
        </Link>
      </div>

      {/* Filtros */}
      <div className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="Buscar por NF, nome, tomador..."
              className="input pl-9" value={busca}
              onChange={e => { setBusca(e.target.value); setPagina(1); }}
            />
          </div>
          <select className="input" value={status} onChange={e => { setStatus(e.target.value); setPagina(1); }}>
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.slice(1).map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
            ))}
          </select>
          <input type="date" className="input" value={dataInicio} onChange={e => { setDataInicio(e.target.value); setPagina(1); }} placeholder="Data início" title="Data início" />
          <input type="date" className="input" value={dataFim} onChange={e => { setDataFim(e.target.value); setPagina(1); }} placeholder="Data fim" title="Data fim" />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <ArrowUpDown size={13} />
            <select className="input w-auto text-sm" value={ordenarPor} onChange={e => { setOrdenarPor(e.target.value); setPagina(1); }}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button className="btn-ghost btn-sm" onClick={() => setOrdem(o => o === 'asc' ? 'desc' : 'asc')}>
              {ordem === 'asc' ? '↑ ASC' : '↓ DESC'}
            </button>
          </div>
          {(busca || status || dataInicio || dataFim) && (
            <button className="btn-ghost btn-sm text-red-500" onClick={() => { setBusca(''); setStatus(''); setDataInicio(''); setDataFim(''); setPagina(1); }}>
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : notas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <FileText size={40} className="mb-3 opacity-40" />
            <p className="font-medium">Nenhuma nota encontrada</p>
            <p className="text-sm mt-1">Ajuste os filtros ou lance uma nova nota</p>
            <Link href="/notas/nova" className="btn-primary mt-4"><PlusCircle size={15} /> Nova Nota</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-auto w-full">
              <thead>
                <tr>
                  <th onClick={() => toggleOrdem('createdAt')} className="cursor-pointer hover:bg-gray-100">Nome / NF</th>
                  <th onClick={() => toggleOrdem('dataEmissao')} className="cursor-pointer hover:bg-gray-100">Emissão</th>
                  <th>Tomador</th>
                  <th>Prestador</th>
                  <th onClick={() => toggleOrdem('valorBruto')} className="cursor-pointer hover:bg-gray-100 text-right">Valor Bruto</th>
                  <th className="text-right">Valor Líq.</th>
                  <th onClick={() => toggleOrdem('dataVencimento')} className="cursor-pointer hover:bg-gray-100">Vencimento</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {notas.map(n => (
                  <tr key={n.id}>
                    <td>
                      <div className="font-medium text-gray-900 truncate max-w-[180px]">
                        {n.nomeOrganizador || `NF ${n.numeroNf || 'S/N'}`}
                      </div>
                      {n.numeroNf && <div className="text-xs text-gray-400">#{n.numeroNf}</div>}
                    </td>
                    <td className="text-gray-600">{formatarData(n.dataEmissao)}</td>
                    <td className="truncate max-w-[160px] text-gray-700">
                      {n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || '—'}
                    </td>
                    <td className="truncate max-w-[160px] text-gray-700">
                      {n.prestador?.nomeRazaoSocial || n.prestador?.nomeFantasia || '—'}
                    </td>
                    <td className="text-right font-semibold text-gray-900">{formatarMoeda(n.valorBruto)}</td>
                    <td className="text-right text-gray-700">{formatarMoeda(n.valorLiquido)}</td>
                    <td className="text-gray-600">{formatarData(n.dataVencimento)}</td>
                    <td>
                      <span className={`badge ${STATUS_COLORS[n.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[n.status] || n.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Link href={`/notas/${n.id}`} className="btn-ghost btn-sm p-1.5" title="Ver detalhes">
                          <Eye size={14} />
                        </Link>
                        <button onClick={() => handleDelete(n.id, n.nomeOrganizador || n.numeroNf || n.id)} className="btn-ghost btn-sm p-1.5 text-red-400 hover:text-red-600" title="Excluir">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>Página {pagina} de {totalPaginas} • {total} registros</span>
          <div className="flex items-center gap-1">
            <button className="btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
              const p = Math.max(1, pagina - 2) + i;
              if (p > totalPaginas) return null;
              return (
                <button key={p} onClick={() => setPagina(p)}
                  className={`btn-sm px-3 py-1.5 rounded ${p === pagina ? 'bg-blue-600 text-white' : 'btn-secondary'}`}>
                  {p}
                </button>
              );
            })}
            <button className="btn-secondary btn-sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NotasPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    }>
      <NotasContent />
    </Suspense>
  );
}
