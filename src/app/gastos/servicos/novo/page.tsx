'use client';

import { useRouter } from 'next/navigation';
import { ServicoWizard } from '@/components/gastos/ServicoWizard';

export default function NovoServicoPage() {
  const router = useRouter();
  return (
    <ServicoWizard
      onCreated={s => router.push(`/gastos/servicos/${s.id}`)}
      onCancel={() => router.push('/gastos')}
    />
  );
}
