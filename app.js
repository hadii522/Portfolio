(() => {
  'use strict';
  const canvas = document.getElementById('animation-canvas');
  const context = canvas?.getContext('2d');
  if (!context) return;

  const FRAME_COUNT = 240;
  const MAX_PENDING = 4;
  const MAX_CACHED = 40;
  const LOOK_AHEAD = 24;
  const LOOK_BEHIND = 8;
  const EPSILON = 0.002;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const smallScreen = window.matchMedia('(max-width: 768px)');
  const connection = navigator.connection;
  const images = new Map();
  const pending = new Set();
  const failed = new Set();
  let frameRequest = 0;
  let currentIndex = 0;
  let targetIndex = 0;
  let direction = 1;
  let lastTimestamp = null;
  let lastDrawnPosition = -1;
  let viewWidth = 0;
  let viewHeight = 0;
  let resizePending = true;

  function enabled() {
    return !reducedMotion.matches && !connection?.saveData && !document.hidden;
  }
  function schedule() {
    if (enabled() && !frameRequest) frameRequest = requestAnimationFrame(draw);
  }
  function updateTarget() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    targetIndex = Math.min(FRAME_COUNT - 1, Math.max(0, window.scrollY / maxScroll * (FRAME_COUNT - 1)));
    direction = Math.sign(targetIndex - currentIndex) || direction;
  }
  function trimCache() {
    const protectedFrames = new Set(bufferCandidates());
    const farthest = [...images.keys()].sort((a, b) =>
      Number(protectedFrames.has(a)) - Number(protectedFrames.has(b)) ||
      Math.abs(b - currentIndex) - Math.abs(a - currentIndex));
    const limit = smallScreen.matches ? 24 : MAX_CACHED;
    while (images.size > limit) images.delete(farthest.shift());
  }

  function bufferCandidates() {
    const anchor = Math.floor(currentIndex);
    const candidates = [anchor, Math.ceil(currentIndex)];
    const ahead = smallScreen.matches ? 12 : LOOK_AHEAD;
    const behind = smallScreen.matches ? 6 : LOOK_BEHIND;
    for (let offset = 1; offset <= ahead; offset++) {
      candidates.push(anchor + direction * offset);
      if (offset <= behind) candidates.push(anchor - direction * offset);
    }
    return candidates;
  }

  // Rebuild priorities after every completion or direction change. In-flight
  // requests stay bounded; stale completions never choose the displayed frame.
  function fillBuffer() {
    if (!enabled()) return;
    for (const index of bufferCandidates()) {
      if (pending.size >= (smallScreen.matches ? 3 : MAX_PENDING)) break;
      if (index < 0 || index >= FRAME_COUNT || images.has(index) || pending.has(index) || failed.has(index)) continue;
      requestImage(index);
    }
  }
  function requestImage(index) {
    pending.add(index);
    const image = new Image();
    image.decoding = 'async';
    let settled = false;
    function finish(success) {
      if (settled) return;
      settled = true;
      pending.delete(index);
      if (success) images.set(index, image);
      else failed.add(index);
      trimCache();
      fillBuffer();
      if (Math.abs(targetIndex - currentIndex) > EPSILON || index === Math.floor(currentIndex) || index === Math.ceil(currentIndex)) schedule();
    }
    image.onload = async () => {
      try {
        // Loading the encoded file is not enough: prepare its pixels before RAF.
        if (typeof image.decode === 'function') await image.decode();
        finish(image.naturalWidth > 0);
      } catch {
        finish(false);
      }
    };
    image.onerror = () => finish(false);
    image.src = `assets/animation/frame_${String(index + 1).padStart(4, '0')}.webp`;
  }

  function ready(index) { return images.has(index) || failed.has(index); }
  function advanceTo(proposed) {
    if (!ready(Math.floor(currentIndex)) || !ready(Math.ceil(currentIndex))) return currentIndex;
    if (proposed >= currentIndex) {
      let edge = Math.floor(currentIndex);
      while (edge < Math.ceil(proposed) && ready(edge + 1)) edge++;
      return Math.min(proposed, edge);
    }
    let edge = Math.ceil(currentIndex);
    while (edge > Math.floor(proposed) && ready(edge - 1)) edge--;
    return Math.max(proposed, edge);
  }
  function findImage(index, step) {
    for (let candidate = index; candidate >= 0 && candidate < FRAME_COUNT; candidate += step) {
      if (images.has(candidate)) return { index: candidate, image: images.get(candidate) };
      if (!failed.has(candidate)) break;
    }
    return null;
  }
  function drawCover(image) {
    const scale = Math.max(viewWidth / image.naturalWidth, viewHeight / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (viewWidth - width) / 2, (viewHeight - height) / 2, width, height);
  }
  function render() {
    if (Math.abs(currentIndex - lastDrawnPosition) < 0.0001) return;
    const lower = findImage(Math.floor(currentIndex), -1);
    const upper = findImage(Math.ceil(currentIndex), 1);
    const first = lower || upper;
    const second = upper || lower;
    if (!first) return; // Keep the last canvas pixels, or the CSS poster.
    context.clearRect(0, 0, viewWidth, viewHeight);
    context.globalAlpha = 1;
    drawCover(first.image);
    if (second.index !== first.index) {
      context.globalAlpha = Math.min(1, Math.max(0, (currentIndex - first.index) / (second.index - first.index)));
      drawCover(second.image);
      context.globalAlpha = 1;
    }
    lastDrawnPosition = currentIndex;
  }
  function draw(timestamp) {
    frameRequest = 0;
    if (!enabled()) return;
    if (resizePending) {
      viewWidth = window.innerWidth;
      viewHeight = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, smallScreen.matches ? 1 : 1.5);
      canvas.width = Math.round(viewWidth * dpr);
      canvas.height = Math.round(viewHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastDrawnPosition = -1;
      resizePending = false;
      updateTarget();
    }
    const now = Number.isFinite(timestamp) ? timestamp : (lastTimestamp ?? 0) + 1000 / 60;
    const elapsed = lastTimestamp === null ? 1000 / 60 : Math.min(50, Math.max(0, now - lastTimestamp));
    lastTimestamp = now;
    const previous = currentIndex;
    const difference = targetIndex - currentIndex;
    const amount = Math.abs(difference) <= EPSILON ? difference : difference * (1 - Math.exp(-elapsed / 100));
    currentIndex = advanceTo(currentIndex + amount);
    render();
    fillBuffer();
    if (Math.abs(targetIndex - currentIndex) > EPSILON && currentIndex !== previous) schedule();
    else lastTimestamp = null; // A decode completion restarts a blocked animation.
  }
  function refreshPreference() {
    lastTimestamp = null;
    if (!enabled()) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      canvas.hidden = true;
    } else {
      canvas.hidden = false;
      resizePending = true;
      updateTarget();
      fillBuffer();
      schedule();
    }
  }
  window.addEventListener('scroll', () => { updateTarget(); fillBuffer(); schedule(); }, { passive: true });
  window.addEventListener('resize', () => { resizePending = true; schedule(); }, { passive: true });
  document.addEventListener('visibilitychange', refreshPreference);
  reducedMotion.addEventListener('change', refreshPreference);
  smallScreen.addEventListener('change', refreshPreference);
  connection?.addEventListener?.('change', refreshPreference);
  refreshPreference();
})();
