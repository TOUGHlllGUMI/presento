// 発表(プレゼンテーション)モード

const Present = (() => {
  let deck = null;
  let index = 0;
  let overlay, stageEl, slideEl, counterEl;
  let recording = false;
  let slideEnterTime = 0;
  let slideDurations = [];
  let presentStartTime = 0;

  // #present-slide は編集画面の #slide-canvas と同じく常に 960x540px 固定で組み立て、
  // 実際の画面いっぱいに見せるための拡大率は #present-stage 側の transform:scale で掛ける
  // (要素の left/top は SLIDE_W x SLIDE_H を基準にした絶対px なので、スライド自体を
  // ビューポート幅に合わせて可変サイズにすると座標が合わなくなる)
  function updateStageScale() {
    if (!stageEl) return;
    const scale = Math.min((window.innerWidth * 0.92) / SLIDE_W, (window.innerHeight * 0.92) / SLIDE_H);
    stageEl.style.transform = `scale(${scale})`;
  }

  function init() {
    overlay = document.getElementById('present-overlay');
    stageEl = document.getElementById('present-stage');
    slideEl = document.getElementById('present-slide');
    counterEl = document.getElementById('present-counter');
    document.getElementById('present-prev').addEventListener('click', prev);
    document.getElementById('present-next').addEventListener('click', next);
    document.getElementById('present-exit').addEventListener('click', exit);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target === slideEl) next();
    });
    window.addEventListener('resize', updateStageScale);
    document.addEventListener('fullscreenchange', updateStageScale);
  }

  function render(transitionType) {
    const slide = deck.slides[index];
    renderSlideSurface(slideEl, slide, false);
    counterEl.textContent = `${index + 1} / ${deck.slides.length}`;

    const type = transitionType || slide.transition || 'none';
    slideEl.classList.remove('pt-fade', 'pt-slide');
    if (type === 'fade') { void slideEl.offsetWidth; slideEl.classList.add('pt-fade'); }
    else if (type === 'slide') { void slideEl.offsetWidth; slideEl.classList.add('pt-slide'); }

    let animCount = 0;
    slide.elements.forEach((el) => {
      if (!el.animateIn) return;
      const node = slideEl.querySelector(`.sl-el[data-id="${el.id}"]`);
      if (node) {
        node.classList.add('pt-el-in');
        node.style.animationDelay = (animCount * 120) + 'ms';
        animCount++;
      }
    });
  }

  function start(currentDeck, startIndex, opts) {
    deck = currentDeck;
    index = startIndex || 0;
    overlay.classList.remove('hidden');
    recording = !!(opts && opts.record);
    presentStartTime = Date.now();
    slideEnterTime = presentStartTime;
    slideDurations = [];
    updateStageScale();
    render();
    const el = overlay;
    if (el.requestFullscreen) el.requestFullscreen().then(updateStageScale).catch(() => {});
    document.addEventListener('keydown', onKey);
  }

  function logSlideTime() {
    const now = Date.now();
    slideDurations.push({ index, ms: now - slideEnterTime });
    slideEnterTime = now;
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return m > 0 ? `${m}分${rs}秒` : `${rs}秒`;
  }

  function exit() {
    overlay.classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.removeEventListener('keydown', onKey);
    if (recording) {
      logSlideTime();
      const total = Date.now() - presentStartTime;
      showToast(`発表時間: ${fmtDuration(total)}(${slideDurations.length}スライド分の切り替えを記録)`);
      recording = false;
    }
  }

  function next() {
    if (index < deck.slides.length - 1) {
      if (recording) logSlideTime();
      index++;
      render('forward');
    }
  }
  function prev() {
    if (index > 0) {
      if (recording) logSlideTime();
      index--;
      render('back');
    }
  }
  function onKey(e) {
    if (e.key === 'Escape') exit();
    else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') next();
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
  }

  return { init, start, exit };
})();

document.addEventListener('DOMContentLoaded', Present.init);
