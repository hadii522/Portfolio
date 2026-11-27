import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="fatal-error">
      <h1>This workspace view does not exist.</h1>
      <Link href="/">Return to overview</Link>
    </main>
  );
}
