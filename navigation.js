(() => {
  'use strict';
  const toggle = document.getElementById('menu-toggle');
  const menu = document.getElementById('nav-menu');
  if (!toggle || !menu) return;
  document.documentElement.classList.add('navigation-ready');
  function closeMenu(restoreFocus = false) {
    toggle.classList.remove('open');
    menu.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.classList.toggle('open', open);
    menu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  });
  menu.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') closeMenu(true);
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
  });
  window.matchMedia('(min-width: 1051px)').addEventListener('change', () => closeMenu());
  const sections = [...document.querySelectorAll('main > section[id]')];
  const links = [...menu.querySelectorAll('a.nav-link[href^="#"]')];
  if (!sections.length || !links.length) return;
  let queued = false;
  function updateCurrentSection() {
    queued = false;
    const trigger = Math.max(110, window.innerHeight * 0.35);
    let current = sections[0].id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= trigger) current = section.id;
    }
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 20) current = sections.at(-1).id;
    for (const link of links) {
      const active = link.hash === `#${current}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  function scheduleUpdate() {
    if (!queued) { queued = true; requestAnimationFrame(updateCurrentSection); }
  }
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  window.addEventListener('pageshow', scheduleUpdate);
  updateCurrentSection();
})();
