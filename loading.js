(() => {
  'use strict';
  const root = document.documentElement;
  window.portfolioBackground = {
    loading() {
      root.classList.remove('animation-ready');
      const status = document.getElementById('background-status');
      if (status) status.hidden = false;
    },
    finish(ready = false) {
      root.classList.toggle('animation-ready', ready);
      const status = document.getElementById('background-status');
      if (status) status.hidden = true;
    }
  };
})();
