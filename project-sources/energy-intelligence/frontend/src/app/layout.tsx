import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'ETIP · Energy Intelligence',
  description: 'Real GB energy data, transparent forecasts and evidence-led market research.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
