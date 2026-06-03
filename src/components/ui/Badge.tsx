import { STATUS_COLORS, STATUS_LABELS, STATUS_IMPOSTO_COLORS, STATUS_IMPOSTO_LABELS } from '@/types';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function ImpostoBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_IMPOSTO_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_IMPOSTO_LABELS[status] || status}
    </span>
  );
}
