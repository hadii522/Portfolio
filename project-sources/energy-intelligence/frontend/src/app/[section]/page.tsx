import { notFound } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!['market', 'forecasts', 'research', 'reports', 'operations', 'settings'].includes(section)) notFound();
  return <Dashboard section={section} />;
}
