(() => {
  'use strict';
  const root = document.documentElement;
  const visitKey = 'portfolio-background-ready-v1';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData) return;
  try {
    if (localStorage.getItem(visitKey) === 'yes') return;
  } catch { /* Storage can be unavailable in private browsing. */ }

  let finished = false;
  root.classList.add('background-loading');
  // Start the escape hatch before the page or animation script has loaded.
  const timeout = setTimeout(() => finish(false), 8000);
  function finish(ready = false) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    root.classList.remove('background-loading');
    document.getElementById('page-loader')?.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeydown);
    if (document.activeElement?.closest?.('#page-loader')) document.getElementById('main-content')?.focus({ preventScroll: true });
    if (ready) {
      try { localStorage.setItem(visitKey, 'yes'); } catch { /* Keep the page usable without storage. */ }
    }
  }
  function onKeydown(event) {
    if (event.key === 'Escape') finish(false);
  }
  window.portfolioIntro = { finish };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('DOMContentLoaded', () => {
    if (finished) return;
    document.getElementById('page-loader')?.setAttribute('aria-hidden', 'false');
    document.getElementById('loader-continue')?.addEventListener('click', () => finish(false));
  }, { once: true });
})();
