(() => {
  'use strict';
  const buttons = [...document.querySelectorAll('.filter-btn')];
  const cards = [...document.querySelectorAll('.showcase-card')];
  const status = document.getElementById('project-filter-status');
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      let visibleCount = 0;
      for (const candidate of buttons) {
        const selected = candidate === button;
        candidate.classList.toggle('active', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      }
      for (const card of cards) {
        const categories = (card.dataset.category || '').split(/\s+/);
        card.hidden = filter !== 'all' && !categories.includes(filter);
        if (!card.hidden) visibleCount++;
      }
      if (status) status.textContent = `${visibleCount} ${visibleCount === 1 ? 'project' : 'projects'} shown`;
    });
  }
})();
