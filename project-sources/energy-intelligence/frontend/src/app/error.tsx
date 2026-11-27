'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal-error">
      <h1>Something interrupted this view.</h1>
      <p>Your stored data is unaffected. Retry the page or inspect the local service logs.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
