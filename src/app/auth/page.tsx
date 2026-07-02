import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import AuthWizard from '@/components/auth/AuthWizard';

export const metadata = {
  title: 'Entrar — NF Control',
};

export default async function AuthPage() {
  const session = await getSession();
  if (session) redirect('/home');
  return <AuthWizard />;
}
