// UI層: 状態管理・イベント処理・書式パネル・キーボード操作をまとめる。

let deck = loadDeck() || createDeck();
let activeSlideId = deck.slides[0].id;
let selection = [];
let editingTextId = null;
let history = createHistory(deck);
let clipboard = [];
let stageScale = 1;
let saveTimer = null;
let drawMode = null;
let drawColor = '#e5484d';
let drawWidth = 3;
let drawPreviewSvg = null;
let sorterMode = false;

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 20;

// スライダー + 数値入力(直接タイプ可能)を1組にした行を作る汎用ヘルパー
function buildSliderNumRow(labelText, min, max, getValue, setValue, onLive, suffix) {
  const row = el('div', 'prop-row opacity-row');
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.className = 'opacity-slider';
  const numInput = document.createElement('input');
  numInput.type = 'number'; numInput.min = String(min); numInput.max = String(max); numInput.className = 'num-input opacity-num';

  const sync = () => {
    const v = Math.round(getValue());
    slider.value = String(v);
    numInput.value = String(v);
  };
  sync();

  const apply = (raw) => {
    let v = Number(raw);
    if (Number.isNaN(v)) v = min;
    v = Math.max(min, Math.min(max, v));
    setValue(v);
    slider.value = String(v);
    numInput.value = String(v);
    if (onLive) onLive();
  };

  slider.addEventListener('input', () => apply(slider.value));
  slider.addEventListener('change', () => commit());
  numInput.addEventListener('input', () => apply(numInput.value));
  numInput.addEventListener('change', () => commit());

  row.appendChild(el('span', 'prop-hint', labelText));
  row.appendChild(slider);
  row.appendChild(numInput);
  if (suffix) row.appendChild(el('span', 'prop-hint', suffix));
  row._sync = sync;
  return row;
}

// 色の getter/setter に紐づく「透明度」スライダー行を1つ作る
function buildOpacityRow(getColor, setColor, onLive, labelText) {
  return buildSliderNumRow(
    labelText || '透明度', 0, 100,
    () => { const { a } = parseColorRGBA(getColor()); return Math.round((1 - (a != null ? a : 1)) * 100); },
    (transparency) => {
      const { r, g, b } = parseColorRGBA(getColor());
      setColor(toColorString(r, g, b, (100 - transparency) / 100));
    },
    onLive, '%',
  );
}

// 新しい色を「一番広い隙間」の中央に、両隣の色を混ぜた色で挿入する。
// 既存の色の位置は変えない(手で調整した配置を壊さないため)。
function insertGradientStop(stops) {
  if (stops.length < 2) {
    stops.push({ color: stops[0] ? stops[0].color : '#ffffff', pos: 1 });
    return;
  }
  const sorted = stops.slice().sort((a, b) => a.pos - b.pos);
  let bestGap = -1, bestA = sorted[0], bestB = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].pos - sorted[i].pos;
    if (gap > bestGap) { bestGap = gap; bestA = sorted[i]; bestB = sorted[i + 1]; }
  }
  const ca = parseColorRGBA(bestA.color), cb = parseColorRGBA(bestB.color);
  const blended = toColorString(
    ca.r + (cb.r - ca.r) / 2, ca.g + (cb.g - ca.g) / 2, ca.b + (cb.b - ca.b) / 2, ca.a + (cb.a - ca.a) / 2,
  );
  stops.push({ color: blended, pos: (bestA.pos + bestB.pos) / 2 });
}

// s.fillGradient の色一覧+角度を編集するコントロール一式を作る(呼び出し側で
// s.fillGradient が既にセットされている前提)。色は「+ 色を追加」でいくつでも増やせ、
// 各色の位置(0〜100%)も個別にスライダーで調整できる。
function buildGradientControls(s, onLive) {
  const wrap = document.createElement('div');
  const live = () => { renderCanvas(); if (onLive) onLive(); };

  const stopsWrap = document.createElement('div');
  wrap.appendChild(stopsWrap);

  function renderStops() {
    stopsWrap.innerHTML = '';
    const stops = s.fillGradient.stops;
    stops.forEach((stop, i) => {
      const row = el('div', 'prop-row');
      const c = document.createElement('input');
      c.type = 'color'; c.value = colorToHex(stop.color);
      c.oninput = () => { stop.color = withNewRgbKeepAlpha(stop.color, c.value); live(); };
      c.onchange = onFieldCommit;
      row.appendChild(c);
      row.appendChild(el('span', 'prop-hint', `色${i + 1}`));
      if (stops.length > 2) {
        const delBtn = el('button', 'toggle-btn', '×');
        delBtn.title = 'この色を削除';
        delBtn.onclick = () => {
          stops.splice(i, 1);
          commit();
        };
        row.appendChild(delBtn);
      }
      stopsWrap.appendChild(row);

      stopsWrap.appendChild(buildSliderNumRow(
        '位置', 0, 100,
        () => Math.round(stop.pos * 100),
        (v) => { stop.pos = v / 100; },
        live, '%',
      ));

      stopsWrap.appendChild(buildOpacityRow(() => stop.color, (c2) => { stop.color = c2; live(); }, null, `色${i + 1}の透明度`));
    });
  }
  renderStops();

  const addBtn = el('button', 'toggle-btn', '+ 色を追加');
  addBtn.onclick = () => {
    insertGradientStop(s.fillGradient.stops);
    commit();
  };
  wrap.appendChild(addBtn);

  wrap.appendChild(buildSliderNumRow(
    '角度', 0, 359,
    () => s.fillGradient.angle,
    (v) => { s.fillGradient.angle = v; },
    live, '°',
  ));

  return wrap;
}

// 「単色 / グラデーション」切り替えボタン行。s.fillGradient の有無を切り替える
function buildFillModeToggle(s) {
  const row = el('div', 'prop-row');
  const solidBtn = el('button', 'toggle-btn' + (!s.fillGradient ? ' active' : ''), '単色');
  const gradBtn = el('button', 'toggle-btn' + (s.fillGradient ? ' active' : ''), 'グラデーション');
  solidBtn.onclick = () => {
    if (!s.fillGradient) return;
    delete s.fillGradient;
    commit(); renderPropPanel();
  };
  gradBtn.onclick = () => {
    if (s.fillGradient) return;
    const base = (s.fill && s.fill !== 'transparent') ? s.fill : '#6c4ff2';
    s.fillGradient = { angle: 90, stops: [{ color: base, pos: 0 }, { color: '#ffffff', pos: 1 }] };
    commit(); renderPropPanel();
  };
  row.appendChild(solidBtn);
  row.appendChild(gradBtn);
  return row;
}

function getActiveSlide() {
  return findSlide(deck, activeSlideId) || deck.slides[0];
}

// ---- 永続化 / 履歴 ----

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDeck(deck), 400);
}

function commit() {
  historyPush(history, deck);
  scheduleSave();
  renderCanvas();
  renderSlideListUI();
  renderPropPanel();
}

function commitSilent() {
  // 位置のみの軽い更新後、履歴と保存だけ行い、DOM再構築はしない
  historyPush(history, deck);
  scheduleSave();
  renderSlideListUI();
}

function undo() {
  const d = historyUndo(history);
  if (!d) return;
  deck = d;
  if (!findSlide(deck, activeSlideId)) activeSlideId = deck.slides[0].id;
  selection = [];
  editingTextId = null;
  renderCanvas();
  renderSlideListUI();
  renderPropPanel();
  scheduleSave();
}

function redo() {
  const d = historyRedo(history);
  if (!d) return;
  deck = d;
  if (!findSlide(deck, activeSlideId)) activeSlideId = deck.slides[0].id;
  selection = [];
  editingTextId = null;
  renderCanvas();
  renderSlideListUI();
  renderPropPanel();
  scheduleSave();
}

// ---- スライド一覧 ----

function renderSlideListUI() {
  const listEl = document.getElementById('slide-list');
  renderSlideList(deck, activeSlideId, listEl);
}

function selectSlide(id) {
  if (id === activeSlideId) return;
  activeSlideId = id;
  selection = [];
  editingTextId = null;
  renderCanvas();
  renderSlideListUI();
  renderPropPanel();
  if (sorterMode) renderSlideSorter();
}

// ---- スライド一覧表示(スライドソーター) ----

function renderSlideSorter() {
  const grid = document.getElementById('slide-sorter-grid');
  grid.innerHTML = '';
  deck.slides.forEach((slide, i) => {
    const tile = document.createElement('div');
    tile.className = 'sorter-tile' + (slide.id === activeSlideId ? ' active' : '');
    tile.dataset.slideId = slide.id;
    tile.draggable = true;

    const frame = document.createElement('div');
    frame.className = 'sorter-frame';
    const inner = document.createElement('div');
    inner.className = 'sorter-inner';
    frame.appendChild(inner);
    renderSlideSurface(inner, slide, false);

    const num = el('div', 'sorter-num', String(i + 1));

    const actions = document.createElement('div');
    actions.className = 'sorter-actions';
    const dupBtn = document.createElement('button');
    dupBtn.className = 'sorter-action-btn';
    dupBtn.title = '複製';
    dupBtn.dataset.action = 'dup';
    dupBtn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>';
    const delBtn = document.createElement('button');
    delBtn.className = 'sorter-action-btn';
    delBtn.title = '削除';
    delBtn.dataset.action = 'del';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    actions.appendChild(dupBtn);
    actions.appendChild(delBtn);

    tile.appendChild(frame);
    tile.appendChild(num);
    tile.appendChild(actions);
    grid.appendChild(tile);
  });

  const addTile = document.createElement('button');
  addTile.className = 'sorter-add-tile';
  addTile.id = 'sorter-add-btn';
  addTile.title = '新しいスライド';
  addTile.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  grid.appendChild(addTile);

  grid.querySelectorAll('.sorter-frame').forEach((frame) => {
    const w = frame.clientWidth;
    const scale = w / SLIDE_W;
    frame.querySelector('.sorter-inner').style.transform = `scale(${scale})`;
  });
}

function setViewMode(mode) {
  sorterMode = mode === 'sorter';
  document.getElementById('canvas-scroll').classList.toggle('hidden', sorterMode);
  document.getElementById('zoom-bar').classList.toggle('hidden', sorterMode);
  document.getElementById('slide-sorter').classList.toggle('hidden', !sorterMode);
  document.getElementById('slide-panel').classList.toggle('hidden', sorterMode);
  document.getElementById('btn-normal-view').classList.toggle('active', !sorterMode);
  document.getElementById('btn-sorter-view').classList.toggle('active', sorterMode);
  if (sorterMode) renderSlideSorter();
}

function addSlide() {
  const s = createSlide();
  const idx = deck.slides.findIndex(sl => sl.id === activeSlideId);
  deck.slides.splice(idx + 1, 0, s);
  activeSlideId = s.id;
  selection = [];
  commit();
}

function duplicateSlideById(id) {
  const s = findSlide(deck, id);
  if (!s) return;
  const clone = JSON.parse(JSON.stringify(s));
  clone.id = uid();
  clone.elements.forEach(e => e.id = uid());
  const idx = deck.slides.findIndex(sl => sl.id === id);
  deck.slides.splice(idx + 1, 0, clone);
  activeSlideId = clone.id;
  selection = [];
  commit();
}

function deleteSlideById(id) {
  if (deck.slides.length <= 1) { showToast('最後の1枚は削除できません'); return; }
  const idx = deck.slides.findIndex(sl => sl.id === id);
  deck.slides.splice(idx, 1);
  if (activeSlideId === id) {
    activeSlideId = deck.slides[Math.max(0, idx - 1)].id;
  }
  selection = [];
  commit();
}

function reorderSlide(dragId, targetId, before) {
  const from = deck.slides.findIndex(s => s.id === dragId);
  if (from === -1) return;
  const [item] = deck.slides.splice(from, 1);
  let to = deck.slides.findIndex(s => s.id === targetId);
  if (to === -1) to = deck.slides.length;
  if (!before) to += 1;
  deck.slides.splice(to, 0, item);
  commit();
}

// ---- 要素追加 ----

function addElementToActiveSlide(el) {
  const slide = getActiveSlide();
  el.zIndex = nextZIndex(slide);
  slide.elements.push(el);
  selection = [el.id];
  return el;
}

function addTextBox() {
  const slide = getActiveSlide();
  const el = createDefaultTextEl({ zIndex: nextZIndex(slide) });
  slide.elements.push(el);
  selection = [el.id];
  editingTextId = el.id;
  commit();
  requestAnimationFrame(() => {
    const node = document.querySelector(`#slide-canvas .sl-el[data-id="${el.id}"] .sl-text-inner`);
    if (node) { node.contentEditable = 'true'; attachTextEditHandlers(node, el.id); focusAndSelectAll(node); }
  });
}

function addShape(shapeType) {
  const el = shapeType === 'rounded-rect'
    ? createShapeEl('rect', { cornerRadius: 24 })
    : createShapeEl(shapeType);
  addElementToActiveSlide(el);
  commit();
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleImageFile(file) {
  try {
    const img = await loadImageFile(file);
    const maxDim = 1600;
    const w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(img, 0, 0, cw, ch);
    const preservePng = /png|gif|webp/.test(file.type);
    const dataUrl = c.toDataURL(preservePng ? 'image/png' : 'image/jpeg', 0.85);
    const el = createImageEl(dataUrl, cw, ch);
    addElementToActiveSlide(el);
    commit();
  } catch (e) {
    showToast('画像の読み込みに失敗しました');
  }
}

// ---- 選択操作 ----

function deleteSelected() {
  if (!selection.length) return;
  const slide = getActiveSlide();
  slide.elements = slide.elements.filter(e => !selection.includes(e.id));
  selection = [];
  commit();
}

function duplicateSelected() {
  if (!selection.length) return;
  const slide = getActiveSlide();
  const newIds = [];
  const groupIdMap = {};
  selection.forEach(id => {
    const el = findElement(slide, id);
    if (!el) return;
    const clone = JSON.parse(JSON.stringify(el));
    clone.id = uid();
    clone.x += 24; clone.y += 24;
    clone.zIndex = nextZIndex(slide);
    if (clone.groupId) {
      if (!groupIdMap[clone.groupId]) groupIdMap[clone.groupId] = uid();
      clone.groupId = groupIdMap[clone.groupId];
    }
    slide.elements.push(clone);
    newIds.push(clone.id);
  });
  selection = newIds;
  commit();
}

function copySelected() {
  const slide = getActiveSlide();
  clipboard = selection.map(id => findElement(slide, id)).filter(Boolean).map(e => JSON.parse(JSON.stringify(e)));
}

function pasteClipboard() {
  if (!clipboard.length) return;
  const slide = getActiveSlide();
  const newIds = [];
  clipboard.forEach(src => {
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = uid();
    clone.x += 24; clone.y += 24;
    clone.zIndex = nextZIndex(slide);
    slide.elements.push(clone);
    newIds.push(clone.id);
  });
  selection = newIds;
  commit();
}

function nudgeSelected(key, big) {
  const slide = getActiveSlide();
  const d = big ? 10 : 1;
  const dx = key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0;
  const dy = key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0;
  selection.forEach(id => {
    const el = findElement(slide, id);
    if (el) { el.x += dx; el.y += dy; }
  });
  commit();
}

function setLayerOrder(mode) {
  const slide = getActiveSlide();
  if (selection.length > 1) {
    if (mode !== 'front' && mode !== 'back') return;
    const els = selection.map(id => findElement(slide, id)).filter(Boolean).sort((a, b) => a.zIndex - b.zIndex);
    if (mode === 'front') {
      let z = nextZIndex(slide);
      els.forEach(e => { e.zIndex = z++; });
    } else {
      let z = Math.min(...slide.elements.map(e => e.zIndex)) - els.length;
      els.forEach(e => { e.zIndex = z++; });
    }
    commit();
    return;
  }
  if (selection.length !== 1) return;
  const el = findElement(slide, selection[0]);
  if (!el) return;
  const sorted = slide.elements.slice().sort((a, b) => a.zIndex - b.zIndex);
  const i = sorted.findIndex(e => e.id === el.id);
  if (mode === 'front') el.zIndex = nextZIndex(slide);
  else if (mode === 'back') el.zIndex = Math.min(...slide.elements.map(e => e.zIndex)) - 1;
  else if (mode === 'forward' && i < sorted.length - 1) {
    const other = sorted[i + 1]; const tmp = el.zIndex; el.zIndex = other.zIndex; other.zIndex = tmp;
  } else if (mode === 'backward' && i > 0) {
    const other = sorted[i - 1]; const tmp = el.zIndex; el.zIndex = other.zIndex; other.zIndex = tmp;
  }
  commit();
}

// ---- キャンバス描画 ----

function renderCanvas() {
  const slide = getActiveSlide();
  const container = document.getElementById('slide-canvas');
  renderSlideSurface(container, slide, false);
  if (editingTextId) {
    const node = container.querySelector(`.sl-el[data-id="${editingTextId}"] .sl-text-inner`);
    if (node) { node.contentEditable = 'true'; attachTextEditHandlers(node, editingTextId); }
  }
  renderSelectionOverlay();
  syncDesignTab();
  syncTransitionTab();
  renderCommentList();
}

function syncDesignTab() {
  const input = document.getElementById('bg-color-input');
  if (!input) return;
  const slide = getActiveSlide();
  input.value = slide.background.type === 'color' ? slide.background.value : '#ffffff';
}

function repositionElementNode(el) {
  const node = document.querySelector(`#slide-canvas .sl-el[data-id="${el.id}"]`);
  if (!node) return;
  // cssText を丸ごと上書きすると、type別に個別プロパティで設定した背景色・枠線・
  // マスク画像・影(filter)などが消えてしまう(ドラッグ中に図形が透明に見える原因だった)。
  // 位置・サイズ・回転・重なり順だけをピンポイントで更新する。
  const flipX = el.flipH ? -1 : 1;
  const flipY = el.flipV ? -1 : 1;
  node.style.left = el.x + 'px';
  node.style.top = el.y + 'px';
  node.style.width = el.w + 'px';
  node.style.height = el.h + 'px';
  node.style.transform = `rotate(${el.rotation || 0}deg) scale(${flipX},${flipY})`;
  node.style.zIndex = el.zIndex;
}

function rotatePoint(px, py, cx, cy, deg) {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: cx + (px - cx) * cos - (py - cy) * sin, y: cy + (px - cx) * sin + (py - cy) * cos };
}

function handleLocalPoint(handle, w, h) {
  const map = {
    nw: [0, 0], n: [w / 2, 0], ne: [w, 0],
    e: [w, h / 2], se: [w, h], s: [w / 2, h],
    sw: [0, h], w: [0, h / 2],
  };
  return map[handle];
}

function renderSelectionOverlay() {
  document.querySelectorAll('#slide-canvas .selection-outline, #slide-canvas .handle, #slide-canvas .marquee').forEach(n => n.remove());
  if (!selection.length) return;
  const slide = getActiveSlide();
  const canvas = document.getElementById('slide-canvas');
  const els = selection.map(id => findElement(slide, id)).filter(Boolean);
  if (!els.length) return;

  if (els.length === 1) {
    const el = els[0];
    const outline = document.createElement('div');
    outline.className = 'selection-outline';
    outline.style.cssText = elStyleCommon(el);
    canvas.appendChild(outline);

    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    HANDLES.forEach(h => {
      const [lx, ly] = handleLocalPoint(h, el.w, el.h);
      const gp = rotatePoint(el.x + lx, el.y + ly, cx, cy, el.rotation || 0);
      const dot = document.createElement('div');
      dot.className = 'handle handle-' + h;
      dot.dataset.handle = h;
      dot.dataset.id = el.id;
      dot.style.left = gp.x + 'px';
      dot.style.top = gp.y + 'px';
      canvas.appendChild(dot);
    });
    const rp = rotatePoint(cx, cy - el.h / 2 - 34, cx, cy, el.rotation || 0);
    const rot = document.createElement('div');
    rot.className = 'handle handle-rotate';
    rot.dataset.handle = 'rotate';
    rot.dataset.id = el.id;
    rot.style.left = rp.x + 'px';
    rot.style.top = rp.y + 'px';
    canvas.appendChild(rot);
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    els.forEach(el => {
      minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.w); maxY = Math.max(maxY, el.y + el.h);
    });
    const outline = document.createElement('div');
    outline.className = 'selection-outline multi';
    outline.style.cssText = `left:${minX}px;top:${minY}px;width:${maxX - minX}px;height:${maxY - minY}px;`;
    canvas.appendChild(outline);
  }
}

function getLogicalPoint(e) {
  const rect = document.getElementById('slide-canvas').getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (SLIDE_W / rect.width),
    y: (e.clientY - rect.top) * (SLIDE_H / rect.height),
  };
}

// ---- ドラッグ: 移動 / リサイズ / 回転 / マーキー選択 ----

const SNAP_THRESHOLD = 6; // 論理px。この範囲内ならスライドの端・中央に吸着する

// 「動かした後の候補座標(edges)」のどれかが「スライド側の吸着ライン(targets)」の
// どれかにこの範囲内で近づいたら、一番近いものへスナップするズレ量を返す
function bestSnapDelta(edges, targets, threshold) {
  let best = null;
  edges.forEach((edge) => {
    targets.forEach((target) => {
      const diff = target - edge;
      if (Math.abs(diff) <= threshold && (!best || Math.abs(diff) < Math.abs(best.diff))) {
        best = { diff, target };
      }
    });
  });
  return best;
}

function computeMoveSnap(left, right, top, bottom) {
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const bestX = bestSnapDelta([left, right, cx], [0, SLIDE_W, SLIDE_W / 2], SNAP_THRESHOLD);
  const bestY = bestSnapDelta([top, bottom, cy], [0, SLIDE_H, SLIDE_H / 2], SNAP_THRESHOLD);
  return {
    dx: bestX ? bestX.diff : 0,
    dy: bestY ? bestY.diff : 0,
    lineX: bestX ? bestX.target : null,
    lineY: bestY ? bestY.target : null,
  };
}

function showSnapGuide(axis, pos) {
  let line = document.getElementById('snap-guide-' + axis);
  if (!line) {
    line = document.createElement('div');
    line.id = 'snap-guide-' + axis;
    line.className = 'snap-guide snap-guide-' + axis;
    document.getElementById('slide-canvas').appendChild(line);
  }
  if (axis === 'x') line.style.left = pos + 'px';
  else line.style.top = pos + 'px';
}

function clearSnapGuides() {
  document.querySelectorAll('#slide-canvas .snap-guide').forEach(n => n.remove());
}

function beginMoveDrag(e, clickedId) {
  e.preventDefault();
  const slide = getActiveSlide();
  if (!selection.includes(clickedId)) {
    selection = [clickedId];
    renderSelectionOverlay();
    renderPropPanel();
  }
  const start = getLogicalPoint(e);
  const initials = selection.map(id => { const el = findElement(slide, id); return { id, x: el.x, y: el.y, w: el.w, h: el.h }; });
  let bbMinX = Infinity, bbMinY = Infinity, bbMaxX = -Infinity, bbMaxY = -Infinity;
  initials.forEach((init) => {
    bbMinX = Math.min(bbMinX, init.x);
    bbMinY = Math.min(bbMinY, init.y);
    bbMaxX = Math.max(bbMaxX, init.x + init.w);
    bbMaxY = Math.max(bbMaxY, init.y + init.h);
  });
  let moved = false;

  function onMove(ev) {
    const p = getLogicalPoint(ev);
    let dx = p.x - start.x, dy = p.y - start.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;

    const snap = computeMoveSnap(bbMinX + dx, bbMaxX + dx, bbMinY + dy, bbMaxY + dy);
    dx += snap.dx; dy += snap.dy;
    if (snap.lineX != null) showSnapGuide('x', snap.lineX);
    else { const g = document.getElementById('snap-guide-x'); if (g) g.remove(); }
    if (snap.lineY != null) showSnapGuide('y', snap.lineY);
    else { const g = document.getElementById('snap-guide-y'); if (g) g.remove(); }

    initials.forEach(init => {
      const el = findElement(slide, init.id);
      if (!el) return;
      el.x = init.x + dx; el.y = init.y + dy;
      repositionElementNode(el);
    });
    renderSelectionOverlay();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    clearSnapGuides();
    if (moved) commit();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function beginResizeDrag(e, id, handle) {
  e.preventDefault();
  e.stopPropagation();
  const slide = getActiveSlide();
  const el = findElement(slide, id);
  if (!el) return;
  const init = { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation || 0 };
  const cx0 = init.x + init.w / 2, cy0 = init.y + init.h / 2;
  const theta = init.rotation * Math.PI / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const start = getLogicalPoint(e);
  const wantsE = handle.includes('e'), wantsW = handle.includes('w');
  const wantsS = handle.includes('s'), wantsN = handle.includes('n');
  const isCorner = (wantsE || wantsW) && (wantsN || wantsS);

  function onMove(ev) {
    const p = getLogicalPoint(ev);
    const dxG = p.x - start.x, dyG = p.y - start.y;
    const dxLocal = dxG * cos + dyG * sin;
    const dyLocal = -dxG * sin + dyG * cos;

    let newW = init.w, newH = init.h;
    if (wantsE) newW = init.w + dxLocal;
    else if (wantsW) newW = init.w - dxLocal;
    if (wantsS) newH = init.h + dyLocal;
    else if (wantsN) newH = init.h - dyLocal;

    const aspectLocked = isCorner && ev.shiftKey;
    if (aspectLocked) {
      const scaleW = newW / init.w, scaleH = newH / init.h;
      const scale = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
      newW = init.w * scale;
      newH = init.h * scale;
    }

    // 吸着は「回転していない図形」のみ対象(回転していると辺が軸に沿わないため)。
    // アスペクト比固定中は縦横が連動しているのでスキップする。
    let snapLineX = null, snapLineY = null;
    if (!aspectLocked && init.rotation === 0) {
      if (wantsE) {
        const snap = bestSnapDelta([init.x + newW], [0, SLIDE_W, SLIDE_W / 2], SNAP_THRESHOLD);
        if (snap) { newW += snap.diff; snapLineX = snap.target; }
      } else if (wantsW) {
        const snap = bestSnapDelta([init.x + init.w - newW], [0, SLIDE_W, SLIDE_W / 2], SNAP_THRESHOLD);
        if (snap) { newW -= snap.diff; snapLineX = snap.target; }
      }
      if (wantsS) {
        const snap = bestSnapDelta([init.y + newH], [0, SLIDE_H, SLIDE_H / 2], SNAP_THRESHOLD);
        if (snap) { newH += snap.diff; snapLineY = snap.target; }
      } else if (wantsN) {
        const snap = bestSnapDelta([init.y + init.h - newH], [0, SLIDE_H, SLIDE_H / 2], SNAP_THRESHOLD);
        if (snap) { newH -= snap.diff; snapLineY = snap.target; }
      }
    }

    newW = Math.max(MIN_SIZE, newW);
    newH = Math.max(MIN_SIZE, newH);

    const cdx = wantsE ? (newW - init.w) / 2 : wantsW ? (init.w - newW) / 2 : 0;
    const cdy = wantsS ? (newH - init.h) / 2 : wantsN ? (init.h - newH) / 2 : 0;

    const offGX = cdx * cos - cdy * sin;
    const offGY = cdx * sin + cdy * cos;
    const newCx = cx0 + offGX, newCy = cy0 + offGY;

    el.x = newCx - newW / 2;
    el.y = newCy - newH / 2;
    el.w = newW;
    el.h = newH;
    repositionElementNode(el);
    if (snapLineX != null) showSnapGuide('x', snapLineX);
    else { const g = document.getElementById('snap-guide-x'); if (g) g.remove(); }
    if (snapLineY != null) showSnapGuide('y', snapLineY);
    else { const g = document.getElementById('snap-guide-y'); if (g) g.remove(); }
    renderSelectionOverlay();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    clearSnapGuides();
    commit();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function beginRotateDrag(e, id) {
  e.preventDefault();
  e.stopPropagation();
  const slide = getActiveSlide();
  const el = findElement(slide, id);
  if (!el) return;
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;

  function angleAt(ev) {
    const p = getLogicalPoint(ev);
    return Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
  }
  function onMove(ev) {
    let deg = angleAt(ev);
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    el.rotation = Math.round(deg);
    repositionElementNode(el);
    renderSelectionOverlay();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    commit();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function beginMarquee(e) {
  const canvas = document.getElementById('slide-canvas');
  const start = getLogicalPoint(e);
  const box = document.createElement('div');
  box.className = 'marquee';
  canvas.appendChild(box);
  let moved = false;

  function update(p) {
    const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
    const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    box.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    return { x, y, w, h };
  }
  function onMove(ev) {
    const p = getLogicalPoint(ev);
    if (Math.abs(p.x - start.x) > 2 || Math.abs(p.y - start.y) > 2) moved = true;
    update(p);
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const p = getLogicalPoint(ev);
    const rect = update(p);
    box.remove();
    if (moved) {
      const slide = getActiveSlide();
      selection = slide.elements.filter(el => {
        return el.x < rect.x + rect.w && el.x + el.w > rect.x && el.y < rect.y + rect.h && el.y + el.h > rect.y;
      }).map(el => el.id);
    } else {
      selection = [];
    }
    renderSelectionOverlay();
    renderPropPanel();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ---- テキスト編集 ----

function focusAndSelectAll(node) {
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ダブルクリックした座標にカーソルを置く(全選択せず、その場所から入力できるようにする)
function placeCaretAtPoint(node, clientX, clientY) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos && pos.offsetNode) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  // クリック地点がテキストの外(余白など)だった場合は末尾にカーソルを置く
  if (!range || !node.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function attachTextEditHandlers(node, id) {
  node.onblur = () => commitTextEdit();
  node.onmousedown = (e) => e.stopPropagation();
  node.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); node.blur(); }
  };
}

function commitTextEdit() {
  if (!editingTextId) return;
  const slide = getActiveSlide();
  const el = findElement(slide, editingTextId);
  const node = document.querySelector(`#slide-canvas .sl-el[data-id="${editingTextId}"] .sl-text-inner`);
  if (el && node) el.text = node.textContent;
  editingTextId = null;
  commit();
}

// ---- 書式パネル ----

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function renderPropPanel() {
  syncFormatTab();
  syncAnimTab();
  const empty = document.getElementById('prop-empty');
  const content = document.getElementById('prop-content');
  content.innerHTML = '';
  const slide = getActiveSlide();

  if (selection.length === 0) {
    empty.classList.remove('hidden');
    content.classList.remove('hidden');
    const bgBlock = el('div', 'prop-section');
    bgBlock.appendChild(el('div', 'prop-label', 'スライドの背景'));
    const row = el('div', 'prop-row');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = slide.background.type === 'color' ? slide.background.value : '#ffffff';
    colorInput.oninput = () => { slide.background = { type: 'color', value: colorInput.value }; document.getElementById('slide-canvas').style.background = colorInput.value; };
    colorInput.onchange = () => commit();
    row.appendChild(colorInput);
    row.appendChild(el('span', 'prop-hint', '背景色を選択'));
    bgBlock.appendChild(row);
    content.appendChild(bgBlock);
    return;
  }

  empty.classList.add('hidden');
  content.classList.remove('hidden');

  if (selection.length > 1) {
    content.appendChild(buildLayerAndActionsSection());
    return;
  }

  const target = findElement(slide, selection[0]);
  if (!target) return;

  if (target.type === 'text') content.appendChild(buildTextSection(target));
  else if (target.type === 'rect' || target.type === 'ellipse' || target.type === 'poly') content.appendChild(buildShapeSection(target));
  else if (target.type === 'merge') content.appendChild(buildMergeSection(target));
  else if (target.type === 'line' || target.type === 'arrow' || target.type === 'double-arrow' || target.type === 'draw') content.appendChild(buildLineSection(target));
  else if (target.type === 'image') content.appendChild(buildImageSection(target));

  content.appendChild(buildTransformSection(target));
  content.appendChild(buildLayerAndActionsSection());
}

function onFieldCommit() { commit(); }

function buildTextSection(t) {
  const sec = el('div', 'prop-section');
  sec.appendChild(el('div', 'prop-label', '文字'));

  const row1 = el('div', 'prop-row');
  const fontSel = document.createElement('select');
  [[''+"'Zen Kaku Gothic New', 'Noto Sans JP', sans-serif", 'ゴシック体'], ["'Noto Serif JP', serif", '明朝体'], ["'Courier New', monospace", '等幅']].forEach(([v, label]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = label;
    if (t.fontFamily === v) o.selected = true;
    fontSel.appendChild(o);
  });
  fontSel.onchange = () => { t.fontFamily = fontSel.value; commit(); };
  row1.appendChild(fontSel);

  const sizeInput = document.createElement('input');
  sizeInput.type = 'number'; sizeInput.min = 8; sizeInput.max = 300; sizeInput.value = t.fontSize;
  sizeInput.className = 'num-input';
  sizeInput.oninput = () => { t.fontSize = Number(sizeInput.value) || t.fontSize; updateTextLive(t); };
  sizeInput.onchange = onFieldCommit;
  row1.appendChild(sizeInput);
  sec.appendChild(row1);

  const row2 = el('div', 'prop-row');
  const colorInput = document.createElement('input');
  colorInput.type = 'color'; colorInput.value = colorToHex(t.color);
  colorInput.oninput = () => { t.color = withNewRgbKeepAlpha(t.color, colorInput.value); updateTextLive(t); };
  colorInput.onchange = onFieldCommit;
  row2.appendChild(colorInput);

  const mkToggle = (label, active, onClick) => {
    const b = el('button', 'toggle-btn' + (active ? ' active' : ''), label);
    b.onclick = onClick;
    return b;
  };
  row2.appendChild(mkToggle('<b>B</b>', t.bold, () => { t.bold = !t.bold; commit(); }));
  row2.appendChild(mkToggle('<i>I</i>', t.italic, () => { t.italic = !t.italic; commit(); }));
  row2.appendChild(mkToggle('<u>U</u>', t.underline, () => { t.underline = !t.underline; commit(); }));
  sec.appendChild(row2);

  const row3 = el('div', 'prop-row');
  [['left', '左'], ['center', '中央'], ['right', '右']].forEach(([v, label]) => {
    row3.appendChild(mkToggle(label, t.align === v, () => { t.align = v; commit(); }));
  });
  sec.appendChild(row3);

  sec.appendChild(buildOpacityRow(() => t.color, (c) => { t.color = c; updateTextLive(t); }, null, '文字色の透明度'));

  return sec;
}

function updateTextLive(t) {
  const node = document.querySelector(`#slide-canvas .sl-el[data-id="${t.id}"] .sl-text-inner`);
  if (node) {
    node.style.fontSize = t.fontSize + 'px';
    node.style.color = t.color;
  }
}

function buildMergeSection(s) {
  const sec = el('div', 'prop-section');
  sec.appendChild(el('div', 'prop-label', '塗りつぶし'));
  sec.appendChild(el('div', 'prop-hint', '図形の結合で作成された図形です'));

  if (s.fillImage) {
    sec.appendChild(el('div', 'prop-hint', '(画像で塗りつぶされています)'));
    return sec;
  }

  sec.appendChild(buildFillModeToggle(s));
  if (s.fillGradient) {
    sec.appendChild(buildGradientControls(s));
  } else {
    const row = el('div', 'prop-row');
    const fill = document.createElement('input');
    fill.type = 'color'; fill.value = colorToHex(s.fill);
    fill.oninput = () => { s.fill = withNewRgbKeepAlpha(s.fill, fill.value); quickRestyle(s); };
    fill.onchange = onFieldCommit;
    row.appendChild(fill);
    sec.appendChild(row);
    sec.appendChild(buildOpacityRow(() => s.fill, (c) => { s.fill = c; quickRestyle(s); }));
  }
  return sec;
}

function buildShapeSection(s) {
  const sec = el('div', 'prop-section');
  sec.appendChild(el('div', 'prop-label', '塗りつぶしと枠線'));

  sec.appendChild(buildFillModeToggle(s));
  if (s.fillGradient) {
    sec.appendChild(buildGradientControls(s));
  } else {
    const row = el('div', 'prop-row');
    const fill = document.createElement('input');
    fill.type = 'color'; fill.value = colorToHex(s.fill);
    fill.oninput = () => { s.fill = withNewRgbKeepAlpha(s.fill, fill.value); quickRestyle(s); };
    fill.onchange = onFieldCommit;
    row.appendChild(fill);
    row.appendChild(el('span', 'prop-hint', '塗り'));
    sec.appendChild(row);
    sec.appendChild(buildOpacityRow(() => s.fill, (c) => { s.fill = c; quickRestyle(s); }, null, '塗りの透明度'));
  }

  const strokeRow = el('div', 'prop-row');
  const stroke = document.createElement('input');
  stroke.type = 'color'; stroke.value = colorToHex(s.stroke);
  stroke.oninput = () => { s.stroke = withNewRgbKeepAlpha(s.stroke, stroke.value); quickRestyle(s); };
  stroke.onchange = onFieldCommit;
  strokeRow.appendChild(stroke);
  strokeRow.appendChild(el('span', 'prop-hint', '枠線'));
  sec.appendChild(strokeRow);
  sec.appendChild(buildOpacityRow(() => s.stroke, (c) => { s.stroke = c; quickRestyle(s); }, null, '枠線の透明度'));

  const row2 = el('div', 'prop-row');
  const sw = document.createElement('input');
  sw.type = 'number'; sw.min = 0; sw.max = 40; sw.value = s.strokeWidth;
  sw.className = 'num-input';
  sw.oninput = () => { s.strokeWidth = Number(sw.value) || 0; quickRestyle(s); };
  sw.onchange = onFieldCommit;
  row2.appendChild(sw);
  row2.appendChild(el('span', 'prop-hint', '線の太さ'));
  sec.appendChild(row2);

  if (s.type === 'rect') {
    const row3 = el('div', 'prop-row');
    const cr = document.createElement('input');
    cr.type = 'number'; cr.min = 0; cr.max = 200; cr.value = s.cornerRadius || 0;
    cr.className = 'num-input';
    cr.oninput = () => { s.cornerRadius = Number(cr.value) || 0; quickRestyle(s); };
    cr.onchange = onFieldCommit;
    row3.appendChild(cr);
    row3.appendChild(el('span', 'prop-hint', '角丸'));
    sec.appendChild(row3);
  }
  return sec;
}

function quickRestyle(s) {
  const node = document.querySelector(`#slide-canvas .sl-el[data-id="${s.id}"]`);
  if (!node) return;
  if (s.type === 'rect' || s.type === 'ellipse') {
    node.style.background = s.fillGradient ? buildCssGradient(s.fillGradient) : s.fill;
    node.style.border = s.strokeWidth > 0 ? `${s.strokeWidth}px solid ${s.stroke}` : 'none';
    if (s.type === 'rect') node.style.borderRadius = (s.cornerRadius || 0) + 'px';
  } else if (s.type === 'poly') {
    if (s.fillGradient) {
      renderCanvas();
      return;
    }
    const poly = node.querySelector('polygon');
    if (poly) {
      poly.setAttribute('fill', s.fill && s.fill !== 'transparent' ? s.fill : 'none');
      poly.setAttribute('stroke', s.strokeWidth > 0 ? s.stroke : 'none');
      poly.setAttribute('stroke-width', s.strokeWidth || 0);
    }
  } else if (s.type === 'line' || s.type === 'arrow' || s.type === 'double-arrow' || s.type === 'draw') {
    const line = node.querySelector('line, polyline');
    if (line) {
      line.setAttribute('stroke', s.stroke);
      line.setAttribute('stroke-width', s.strokeWidth);
    }
  } else if (s.type === 'text') {
    const inner = node.querySelector('.sl-text-inner');
    if (inner) inner.style.background = s.fill && s.fill !== 'transparent' ? s.fill : 'transparent';
  } else if (s.type === 'merge') {
    node.style.background = s.fillImage ? '' : (s.fillGradient ? buildCssGradient(s.fillGradient) : s.fill);
  }
}

function buildLineSection(s) {
  const sec = el('div', 'prop-section');
  sec.appendChild(el('div', 'prop-label', '線'));
  const row = el('div', 'prop-row');
  const stroke = document.createElement('input');
  stroke.type = 'color'; stroke.value = colorToHex(s.stroke);
  stroke.oninput = () => { s.stroke = withNewRgbKeepAlpha(s.stroke, stroke.value); renderCanvas(); };
  stroke.onchange = onFieldCommit;
  row.appendChild(stroke);

  const sw = document.createElement('input');
  sw.type = 'number'; sw.min = 1; sw.max = 40; sw.value = s.strokeWidth;
  sw.className = 'num-input';
  sw.oninput = () => { s.strokeWidth = Number(sw.value) || 1; renderCanvas(); };
  sw.onchange = onFieldCommit;
  row.appendChild(sw);
  row.appendChild(el('span', 'prop-hint', '太さ'));
  sec.appendChild(row);
  sec.appendChild(buildOpacityRow(() => s.stroke, (c) => { s.stroke = c; renderCanvas(); }));
  return sec;
}

function buildImageSection(img) {
  const sec = el('div', 'prop-section');
  sec.appendChild(el('div', 'prop-label', '画像'));
  const hint = el('div', 'prop-hint', 'ドラッグして移動・リサイズできます');
  sec.appendChild(hint);
  return sec;
}

function buildTransformSection(t) {
  const sec = el('div', 'prop-section');
  sec.appendChild(el('div', 'prop-label', '位置とサイズ'));
  const row1 = el('div', 'prop-row');
  const xInput = document.createElement('input'); xInput.type = 'number'; xInput.className = 'num-input'; xInput.value = Math.round(t.x);
  const yInput = document.createElement('input'); yInput.type = 'number'; yInput.className = 'num-input'; yInput.value = Math.round(t.y);
  xInput.oninput = () => { t.x = Number(xInput.value) || 0; repositionElementNode(t); renderSelectionOverlay(); };
  yInput.oninput = () => { t.y = Number(yInput.value) || 0; repositionElementNode(t); renderSelectionOverlay(); };
  xInput.onchange = onFieldCommit; yInput.onchange = onFieldCommit;
  row1.appendChild(el('span', 'prop-hint', 'X')); row1.appendChild(xInput);
  row1.appendChild(el('span', 'prop-hint', 'Y')); row1.appendChild(yInput);
  sec.appendChild(row1);

  const row2 = el('div', 'prop-row');
  const wInput = document.createElement('input'); wInput.type = 'number'; wInput.className = 'num-input'; wInput.value = Math.round(t.w);
  const hInput = document.createElement('input'); hInput.type = 'number'; hInput.className = 'num-input'; hInput.value = Math.round(t.h);
  wInput.oninput = () => { t.w = Math.max(MIN_SIZE, Number(wInput.value) || t.w); repositionElementNode(t); renderSelectionOverlay(); };
  hInput.oninput = () => { t.h = Math.max(MIN_SIZE, Number(hInput.value) || t.h); repositionElementNode(t); renderSelectionOverlay(); };
  wInput.onchange = onFieldCommit; hInput.onchange = onFieldCommit;
  row2.appendChild(el('span', 'prop-hint', 'W')); row2.appendChild(wInput);
  row2.appendChild(el('span', 'prop-hint', 'H')); row2.appendChild(hInput);
  sec.appendChild(row2);

  return sec;
}

function buildLayerAndActionsSection() {
  const sec = el('div', 'prop-section');
  sec.appendChild(el('div', 'prop-label', '重なり順'));
  const row = el('div', 'prop-row');
  const mk = (title, svg, mode) => {
    const b = el('button', 'icon-btn small', svg);
    b.title = title;
    b.onclick = () => setLayerOrder(mode);
    return b;
  };
  row.appendChild(mk('最前面へ', '⇑', 'front'));
  row.appendChild(mk('前面へ', '↑', 'forward'));
  row.appendChild(mk('背面へ', '↓', 'backward'));
  row.appendChild(mk('最背面へ', '⇓', 'back'));
  sec.appendChild(row);

  const row2 = el('div', 'prop-row');
  const dup = el('button', 'text-btn', '複製'); dup.onclick = duplicateSelected;
  const del = el('button', 'text-btn danger', '削除'); del.onclick = deleteSelected;
  row2.appendChild(dup); row2.appendChild(del);
  sec.appendChild(row2);
  return sec;
}

// ---- ズーム ----

function applyZoom() {
  document.getElementById('canvas-stage').style.transform = `scale(${stageScale})`;
  const pct = Math.round(stageScale * 100) + '%';
  document.getElementById('zoom-label').textContent = pct;
  const ribbonLabel = document.getElementById('zoom-label-ribbon');
  if (ribbonLabel) ribbonLabel.textContent = pct;
}

function zoomFit() {
  const area = document.getElementById('canvas-area');
  const availW = area.clientWidth - 80;
  const availH = area.clientHeight - 100;
  stageScale = Math.max(0.2, Math.min(availW / SLIDE_W, availH / SLIDE_H, 2));
  applyZoom();
}

// ---- トースト ----

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---- 右クリックのコンテキストメニュー (PowerPoint風) ----

const CM_ICONS = {
  cut: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 19M8 16.5 20 5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="16" rx="1.5"/><rect x="9" y="3" width="6" height="3" rx="1"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13"/></svg>',
  front: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="12" height="12" rx="1.5"/><rect x="3" y="3" width="8" height="8" rx="1.2" fill="#fff"/></svg>',
  back: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="12" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.2" fill="#fff"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>',
  size: '<svg viewBox="0 0 24 24"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4m11-5v4a1 1 0 0 1-1 1h-4"/></svg>',
  format: '<svg viewBox="0 0 24 24"><path d="M12 3c-4 4-7 7.5-7 11a7 7 0 0 0 14 0c0-3.5-3-7-7-11z"/></svg>',
  bg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 4-4 5 5"/></svg>',
  newslide: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="15" height="14" rx="1.5"/><path d="M18.5 10v8M14.5 14h8"/></svg>',
};

function cmItem({ icon, label, action, disabled, submenu }) {
  const row = document.createElement('div');
  row.className = 'cm-item' + (disabled ? ' disabled' : '') + (submenu ? ' has-submenu' : '');
  row.innerHTML = `<span class="cm-icon">${icon || ''}</span><span class="cm-label">${label}</span>`;
  if (submenu) {
    row.innerHTML += '<span class="cm-arrow">▸</span>';
    const sub = document.createElement('div');
    sub.className = 'cm-submenu';
    submenu.forEach((item) => sub.appendChild(cmItem(item)));
    row.appendChild(sub);
  } else if (!disabled && action) {
    row.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); action(); });
  }
  return row;
}

function cmDivider() {
  const d = document.createElement('div');
  d.className = 'cm-divider';
  return d;
}

function pasteClipboardAt(point) {
  if (!clipboard.length) return;
  const slide = getActiveSlide();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  clipboard.forEach((e) => {
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w); maxY = Math.max(maxY, e.y + e.h);
  });
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const dx = point.x - cx, dy = point.y - cy;
  const newIds = [];
  clipboard.forEach((src) => {
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = uid(); clone.x += dx; clone.y += dy; clone.zIndex = nextZIndex(slide);
    slide.elements.push(clone);
    newIds.push(clone.id);
  });
  selection = newIds;
  commit();
}

function cutSelected() {
  copySelected();
  deleteSelected();
}

function flashPropSection(labelText) {
  const labels = document.querySelectorAll('#prop-content .prop-label');
  for (const l of labels) {
    if (l.textContent === labelText) {
      const sec = l.closest('.prop-section');
      sec.classList.remove('flash-highlight');
      void sec.offsetWidth;
      sec.classList.add('flash-highlight');
      sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
  }
}

function formatSectionLabel(type) {
  if (type === 'text') return '文字';
  if (type === 'line' || type === 'arrow' || type === 'double-arrow') return '線';
  if (type === 'image') return '画像';
  if (type === 'merge') return '塗りつぶし';
  return '塗りつぶしと枠線';
}

function buildElementContextMenu(target) {
  const items = [];
  items.push(cmItem({ icon: CM_ICONS.cut, label: '切り取り', action: cutSelected }));
  items.push(cmItem({ icon: CM_ICONS.copy, label: 'コピー', action: copySelected }));
  items.push(cmItem({ icon: CM_ICONS.paste, label: '貼り付け', disabled: !clipboard.length, action: () => pasteClipboardAt(contextMenuPoint) }));
  items.push(cmDivider());
  items.push(cmItem({ icon: CM_ICONS.duplicate, label: '複製', action: duplicateSelected }));
  items.push(cmItem({ icon: CM_ICONS.delete, label: '削除', action: deleteSelected }));
  items.push(cmDivider());
  if (selection.length === 1 && target && target.type === 'text') {
    items.push(cmItem({
      icon: CM_ICONS.text, label: 'テキストの編集', action: () => {
        editingTextId = target.id;
        renderCanvas();
        requestAnimationFrame(() => {
          const node = document.querySelector(`#slide-canvas .sl-el[data-id="${target.id}"] .sl-text-inner`);
          if (node) focusAndSelectAll(node);
        });
      },
    }));
    items.push(cmDivider());
  }
  items.push(cmItem({
    icon: CM_ICONS.front, label: '最前面へ移動', submenu: [
      { icon: CM_ICONS.front, label: '最前面へ移動', action: () => setLayerOrder('front') },
      { icon: CM_ICONS.front, label: '前面へ移動', action: () => setLayerOrder('forward') },
    ],
  }));
  items.push(cmItem({
    icon: CM_ICONS.back, label: '最背面へ移動', submenu: [
      { icon: CM_ICONS.back, label: '最背面へ移動', action: () => setLayerOrder('back') },
      { icon: CM_ICONS.back, label: '背面へ移動', action: () => setLayerOrder('backward') },
    ],
  }));
  if (selection.length === 1 && target) {
    items.push(cmDivider());
    items.push(cmItem({ icon: CM_ICONS.image, label: '図として保存...', action: () => saveElementAsImage(target) }));
    items.push(cmDivider());
    items.push(cmItem({ icon: CM_ICONS.size, label: '配置とサイズ...', action: () => flashPropSection('位置とサイズ') }));
    items.push(cmItem({ icon: CM_ICONS.format, label: '図形の書式設定...', action: () => flashPropSection(formatSectionLabel(target.type)) }));
  }
  return items;
}

function buildEmptyCanvasContextMenu() {
  const items = [];
  items.push(cmItem({ icon: CM_ICONS.paste, label: '貼り付け', disabled: !clipboard.length, action: () => pasteClipboardAt(contextMenuPoint) }));
  items.push(cmDivider());
  items.push(cmItem({
    icon: CM_ICONS.bg, label: '背景の書式設定...', action: () => {
      document.querySelector('.ribbon-tab[data-tab="design"]').click();
      const group = document.querySelector('#ribbon-panels [data-panel="design"] .ribbon-group');
      if (group) { group.classList.remove('flash-highlight'); void group.offsetWidth; group.classList.add('flash-highlight'); }
    },
  }));
  return items;
}

let contextMenuPoint = { x: 0, y: 0 };

function showContextMenu(items, e) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  items.forEach((it) => menu.appendChild(it));
  menu.classList.remove('hidden');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = e.clientX, top = e.clientY;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function openContextMenu(e) {
  e.preventDefault();
  const elNode = e.target.closest('.sl-el');
  contextMenuPoint = getLogicalPoint(e);

  let items;
  if (elNode) {
    const id = elNode.dataset.id;
    if (!selection.includes(id)) {
      const clickedEl = findElement(getActiveSlide(), id);
      selection = (clickedEl && clickedEl.groupId)
        ? getActiveSlide().elements.filter(x => x.groupId === clickedEl.groupId).map(x => x.id)
        : [id];
      renderSelectionOverlay(); renderPropPanel();
    }
    const slide = getActiveSlide();
    const target = selection.length === 1 ? findElement(slide, id) : null;
    items = buildElementContextMenu(target);
  } else {
    items = buildEmptyCanvasContextMenu();
  }
  showContextMenu(items, e);
}

function buildSlideContextMenu(slideId) {
  const refresh = () => { if (sorterMode) renderSlideSorter(); };
  const items = [];
  items.push(cmItem({ icon: CM_ICONS.newslide, label: '新しいスライド', action: () => { selectSlide(slideId); addSlide(); refresh(); } }));
  items.push(cmItem({ icon: CM_ICONS.duplicate, label: 'スライドを複製', action: () => { duplicateSlideById(slideId); refresh(); } }));
  items.push(cmDivider());
  items.push(cmItem({ icon: CM_ICONS.delete, label: 'スライドを削除', disabled: deck.slides.length <= 1, action: () => { deleteSlideById(slideId); refresh(); } }));
  items.push(cmDivider());
  items.push(cmItem({
    icon: CM_ICONS.bg, label: '背景の書式設定...', action: () => {
      selectSlide(slideId);
      if (sorterMode) setViewMode('normal');
      document.querySelector('.ribbon-tab[data-tab="design"]').click();
      const group = document.querySelector('#ribbon-panels [data-panel="design"] .ribbon-group');
      if (group) { group.classList.remove('flash-highlight'); void group.offsetWidth; group.classList.add('flash-highlight'); }
    },
  }));
  return items;
}

function openSlideContextMenu(e) {
  const item = e.target.closest('.slide-thumb') || e.target.closest('.sorter-tile');
  if (!item) return;
  e.preventDefault();
  showContextMenu(buildSlideContextMenu(item.dataset.slideId), e);
}

function closeContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
}

function resetToNewDeck() {
  deck = createDeck();
  activeSlideId = deck.slides[0].id;
  selection = [];
  editingTextId = null;
  history = createHistory(deck);
  document.getElementById('deck-title').value = deck.title;
  renderCanvas();
  renderSlideListUI();
  renderPropPanel();
  scheduleSave();
}

// ---- ホーム画面 (起動時の「新規/最近使ったアイテム」画面) ----

function greetingText() {
  const h = new Date().getHours();
  if (h < 5) return 'こんばんは';
  if (h < 11) return 'おはようございます';
  if (h < 17) return 'こんにちは';
  return 'こんばんは';
}

function formatRelativeDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今日 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨日 ${time}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

function renderHomeScreen() {
  document.getElementById('home-greeting').textContent = greetingText();
  const list = document.getElementById('home-recent-list');
  const empty = document.getElementById('home-recent-empty');
  list.innerHTML = '';
  const index = getLibraryIndex().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  empty.classList.toggle('hidden', index.length > 0);

  index.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'home-recent-row';
    row.dataset.deckId = entry.id;

    const thumb = document.createElement('div');
    thumb.className = 'home-recent-thumb';
    const d = loadDeckById(entry.id);
    if (d && d.slides && d.slides[0]) {
      const inner = document.createElement('div');
      inner.className = 'home-recent-thumb-inner';
      thumb.appendChild(inner);
      renderSlideSurface(inner, d.slides[0], false);
      requestAnimationFrame(() => {
        const w = thumb.clientWidth;
        if (w) inner.style.transform = `scale(${w / SLIDE_W})`;
      });
    }

    const name = el('div', 'home-recent-name', escapeHtml(entry.title || '無題のプレゼンテーション'));
    const date = el('div', 'home-recent-date', formatRelativeDate(entry.updatedAt));
    const delBtn = document.createElement('button');
    delBtn.className = 'home-recent-del';
    delBtn.title = '削除';
    delBtn.dataset.action = 'delete';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';

    row.appendChild(thumb);
    row.appendChild(name);
    row.appendChild(date);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function openHomeScreen() {
  renderHomeScreen();
  document.getElementById('home-screen').classList.remove('hidden');
}

function closeHomeScreen() {
  document.getElementById('home-screen').classList.add('hidden');
}

function openDeckFromLibrary(id) {
  const loaded = loadDeckById(id);
  if (!loaded) { showToast('プレゼンテーションの読み込みに失敗しました'); return; }
  deck = loaded;
  activeSlideId = deck.slides[0].id;
  selection = [];
  editingTextId = null;
  history = createHistory(deck);
  document.getElementById('deck-title').value = deck.title || '無題のプレゼンテーション';
  renderCanvas();
  renderSlideListUI();
  renderPropPanel();
  zoomFit();
  closeHomeScreen();
}

// ---- リボンタブの切り替え(プログラムからも呼べる) ----

function activateRibbonTab(name) {
  document.querySelectorAll('.ribbon-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.ribbon-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
}

// ---- 描画タブ (ペン/蛍光ペン/消しゴム) ----

function setDrawMode(mode) {
  drawMode = mode || null;
  document.querySelectorAll('#ribbon-panels [data-panel="draw"] [data-draw-mode]').forEach((b) => {
    b.classList.toggle('active', (b.dataset.drawMode || '') === (drawMode || ''));
  });
  const stage = document.getElementById('canvas-stage');
  if (drawMode) stage.setAttribute('data-draw-mode', drawMode); else stage.removeAttribute('data-draw-mode');
}

function renderDrawPreview(points, isHighlighter) {
  const canvas = document.getElementById('slide-canvas');
  if (!drawPreviewSvg) {
    const svgNS = 'http://www.w3.org/2000/svg';
    drawPreviewSvg = document.createElementNS(svgNS, 'svg');
    drawPreviewSvg.setAttribute('viewBox', `0 0 ${SLIDE_W} ${SLIDE_H}`);
    drawPreviewSvg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:40;';
    const line = document.createElementNS(svgNS, 'polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', drawColor);
    line.setAttribute('stroke-width', isHighlighter ? drawWidth * 4 : drawWidth);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('opacity', isHighlighter ? 0.35 : 1);
    drawPreviewSvg.appendChild(line);
    canvas.appendChild(drawPreviewSvg);
  }
  drawPreviewSvg.querySelector('polyline').setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
}

function clearDrawPreview() {
  if (drawPreviewSvg) { drawPreviewSvg.remove(); drawPreviewSvg = null; }
}

function beginDrawStroke(e, mode) {
  e.preventDefault();
  const isHighlighter = mode === 'highlighter';
  const points = [getLogicalPoint(e)];
  renderDrawPreview(points, isHighlighter);

  function onMove(ev) {
    points.push(getLogicalPoint(ev));
    renderDrawPreview(points, isHighlighter);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    clearDrawPreview();
    if (points.length < 2) return;
    const el = createDrawEl(points.map(p => [p.x, p.y]), {
      stroke: drawColor,
      strokeWidth: isHighlighter ? drawWidth * 4 : drawWidth,
      opacity: isHighlighter ? 0.35 : 1,
    });
    addElementToActiveSlide(el);
    commit();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function eraseAtPoint(p) {
  const slide = getActiveSlide();
  const draws = slide.elements.filter(el => el.type === 'draw').sort((a, b) => b.zIndex - a.zIndex);
  const hit = draws.find(el => p.x >= el.x - 6 && p.x <= el.x + el.w + 6 && p.y >= el.y - 6 && p.y <= el.y + el.h + 6);
  if (hit) {
    slide.elements = slide.elements.filter(el => el.id !== hit.id);
    commit();
  }
}

function beginErase(e) {
  eraseAtPoint(getLogicalPoint(e));
  function onMove(ev) { eraseAtPoint(getLogicalPoint(ev)); }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ---- 画面切り替え / アニメーション タブの同期 ----

function syncTransitionTab() {
  const slide = getActiveSlide();
  const current = slide.transition || 'none';
  document.querySelectorAll('#ribbon-panels [data-panel="transitions"] [data-transition]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.transition === current);
  });
}

function syncAnimTab() {
  const btn = document.getElementById('btn-anim-toggle');
  const hint = document.getElementById('anim-hint');
  if (selection.length === 1) {
    const el = findElement(getActiveSlide(), selection[0]);
    btn.disabled = false;
    btn.classList.toggle('active', !!(el && el.animateIn));
    hint.textContent = el && el.animateIn ? 'フェードインが設定されています' : '要素の登場時にフェードインします';
  } else {
    btn.disabled = true;
    btn.classList.remove('active');
    hint.textContent = '要素を選択してください';
  }
}

// ---- 校閲タブ (コメント) ----

function renderCommentList() {
  const list = document.getElementById('comment-list');
  if (!list) return;
  const slide = getActiveSlide();
  const comments = slide.comments || [];
  list.innerHTML = '';
  comments.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'comment-item';
    const text = document.createElement('span');
    text.className = 'comment-text';
    text.textContent = c.text;
    const del = document.createElement('button');
    del.className = 'comment-del';
    del.title = '削除';
    del.textContent = '×';
    del.addEventListener('click', () => {
      slide.comments = (slide.comments || []).filter(x => x.id !== c.id);
      commit();
    });
    row.appendChild(text);
    row.appendChild(del);
    list.appendChild(row);
  });
}

function addComment() {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;
  const slide = getActiveSlide();
  if (!slide.comments) slide.comments = [];
  slide.comments.push({ id: uid(), text });
  input.value = '';
  commit();
}

// ---- 図形の書式 (コンテキストタブ) ----

const QUICK_STYLES = [
  { fill: '#2b2440', stroke: '#000000' },
  { fill: '#6c4ff2', stroke: '#4a2fd6' },
  { fill: '#ff7a45', stroke: '#c14a1c' },
  { fill: '#8c8c9c', stroke: '#5c5c6c' },
  { fill: '#ffb238', stroke: '#c47f00' },
  { fill: '#4fa3e3', stroke: '#1f6fae' },
  { fill: '#3aa876', stroke: '#1f7350' },
];

const SHAPE_DEFS = [
  { kind: 'rect', label: '四角形', svg: '<rect x="3" y="6" width="18" height="12"/>' },
  { kind: 'rounded-rect', label: '角丸四角形', svg: '<rect x="3" y="6" width="18" height="12" rx="4"/>' },
  { kind: 'ellipse', label: '楕円', svg: '<ellipse cx="12" cy="12" rx="9" ry="6"/>' },
  { kind: 'triangle', label: '三角形', svg: '<polygon points="12,4 21,20 3,20"/>' },
  { kind: 'right-triangle', label: '直角三角形', svg: '<polygon points="4,4 4,20 20,20"/>' },
  { kind: 'diamond', label: 'ひし形', svg: '<polygon points="12,3 21,12 12,21 3,12"/>' },
  { kind: 'parallelogram', label: '平行四辺形', svg: '<polygon points="8,5 21,5 16,19 3,19"/>' },
  { kind: 'trapezoid', label: '台形', svg: '<polygon points="8,5 16,5 21,19 3,19"/>' },
  { kind: 'pentagon', label: '五角形', svg: '<polygon points="12,3 21,9.5 17.5,20 6.5,20 3,9.5"/>' },
  { kind: 'hexagon', label: '六角形', svg: '<polygon points="7,3 17,3 22,12 17,21 7,21 2,12"/>' },
  { kind: 'octagon', label: '八角形', svg: '<polygon points="15.4,3.7 20.3,8.6 20.3,15.4 15.4,20.3 8.6,20.3 3.7,15.4 3.7,8.6 8.6,3.7"/>' },
  { kind: 'star', label: '星', svg: '<polygon points="12,2 14.8,9 22,9.3 16.3,14 18.2,21 12,17 5.8,21 7.7,14 2,9.3 9.2,9"/>' },
  { kind: 'star6', label: '六芒星', svg: '<polygon points="12,2 14.3,7.8 20.5,7 16.6,12 20.5,17 14.3,16.2 12,22 9.7,16.2 3.5,17 7.4,12 3.5,7 9.7,7.8"/>' },
  { kind: 'star8', label: '八芒星', svg: '<polygon points="12,3 13.7,7.8 18.4,5.6 16.2,10.3 21,12 16.2,13.7 18.4,18.4 13.7,16.2 12,21 10.3,16.2 5.6,18.4 7.8,13.7 3,12 7.8,10.3 5.6,5.6 10.3,7.8"/>' },
  { kind: 'heart', label: 'ハート', svg: '<path d="M12 21s-7-4.4-9.5-8.8C.5 8.8 2 5 5.5 5c2 0 3.5 1.3 4.5 3 1-1.7 2.5-3 4.5-3 3.5 0 5 3.8 3 7.2C19 16.6 12 21 12 21z"/>' },
  { kind: 'half-circle', label: '半円', svg: '<path d="M3 12a9 9 0 0 1 18 0z"/>' },
  { kind: 'cross', label: '十字', svg: '<polygon points="9,3 15,3 15,9 21,9 21,15 15,15 15,21 9,21 9,15 3,15 3,9 9,9"/>' },
  { kind: 'chevron', label: '矢羽根', svg: '<polygon points="3,4 13,4 21,12 13,20 3,20 9,12"/>' },
  { kind: 'arrow-block', label: '矢印(ブロック)', svg: '<polygon points="3,8.4 13.8,8.4 13.8,4.8 21,12 13.8,19.2 13.8,15.6 3,15.6"/>' },
  { kind: 'speech-bubble', label: '吹き出し', svg: '<polygon points="3,3 21,3 21,15.6 8.4,15.6 5.7,21 5.7,15.6 3,15.6"/>' },
];
const LINE_DEFS = [
  { kind: 'line', label: '直線', svg: '<line x1="4" y1="20" x2="20" y2="4"/>' },
  { kind: 'arrow', label: '矢印', svg: '<path d="M4 20 20 4"/><path d="M20 4v7M20 4h-7"/>' },
  { kind: 'double-arrow', label: '双方向矢印', svg: '<path d="M4 20 20 4"/><path d="M20 4v7M20 4h-7"/><path d="M4 20v-7M4 20h7"/>' },
];
const SHAPE_LIKE_TYPES = ['rect', 'ellipse', 'poly', 'line', 'arrow', 'double-arrow'];
const FMT_PALETTE = ['#000000', '#ffffff', '#e5484d', '#ff7a45', '#ffb238', '#3aa876', '#4fa3e3', '#6c4ff2', '#8c8c9c', '#2b2440', '#b8272c', '#c14a1c'];

function initQuickStyles() {
  const row = document.getElementById('quick-style-row');
  QUICK_STYLES.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = s.fill;
    b.style.borderColor = s.stroke;
    b.style.borderWidth = '2px';
    b.title = s.fill;
    b.addEventListener('click', () => {
      if (selection.length !== 1) return;
      const el = findElement(getActiveSlide(), selection[0]);
      if (!el) return;
      if ('fill' in el) el.fill = s.fill;
      if ('stroke' in el) el.stroke = s.stroke;
      quickRestyle(el);
      commit();
    });
    row.appendChild(b);
  });
}

function buildShapeIconSvg(def) {
  return `<svg viewBox="0 0 24 24">${def.svg}</svg>`;
}

function initFmtInsertGrid() {
  const grid = document.getElementById('fmt-insert-grid');
  const picks = ['rect', 'ellipse', 'triangle', 'diamond', 'line', 'arrow', 'star', 'rounded-rect'];
  const all = SHAPE_DEFS.concat(LINE_DEFS);
  picks.forEach((kind) => {
    const def = all.find(d => d.kind === kind);
    if (!def) return;
    const b = document.createElement('button');
    b.dataset.shape = kind;
    b.title = def.label;
    b.innerHTML = buildShapeIconSvg(def);
    b.addEventListener('click', () => addShape(kind));
    grid.appendChild(b);
  });
}

function initFmtChangeShapeGallery() {
  const menu = document.getElementById('menu-fmt-changeshape');
  SHAPE_DEFS.concat(LINE_DEFS).forEach((def) => {
    const b = document.createElement('button');
    b.title = def.label;
    b.innerHTML = buildShapeIconSvg(def);
    b.addEventListener('click', () => {
      closeDropdowns();
      if (selection.length !== 1) return;
      const el = findElement(getActiveSlide(), selection[0]);
      if (!el || !SHAPE_LIKE_TYPES.includes(el.type)) return;
      changeShapeType(el, def.kind);
      renderCanvas();
      commit();
    });
    menu.appendChild(b);
  });
}

function mkTextMenuButton(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { closeDropdowns(); onClick(); });
  return b;
}

function buildColorPalette(menuEl, onPick, extraButtons, alphaOpts) {
  menuEl.innerHTML = '';
  if (extraButtons) extraButtons.forEach(b => menuEl.appendChild(b));
  const grid = document.createElement('div');
  grid.className = 'fmt-color-palette';
  FMT_PALETTE.forEach((c) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => { closeDropdowns(); onPick(c); });
    grid.appendChild(b);
  });
  menuEl.appendChild(grid);

  if (alphaOpts) {
    const opacityRow = buildOpacityRow(
      () => { const e = alphaOpts.getEl(); return e ? e[alphaOpts.field] : '#000000'; },
      (c) => { const e = alphaOpts.getEl(); if (!e) return; e[alphaOpts.field] = c; alphaOpts.onLive(e); },
    );
    opacityRow.addEventListener('mousedown', (e) => e.stopPropagation());
    menuEl.appendChild(opacityRow);
    menuEl._syncOpacity = opacityRow._sync;
  }
}

function initFmtStyleMenus() {
  const fillEl = () => {
    if (selection.length !== 1) return null;
    const e = findElement(getActiveSlide(), selection[0]);
    return e && ('fill' in e) ? e : null;
  };
  buildColorPalette(document.getElementById('menu-fmt-fill'), (c) => {
    const el = fillEl();
    if (!el) return;
    delete el.fillGradient;
    el.fill = c; quickRestyle(el); commit();
  }, [mkTextMenuButton('塗りつぶしなし', () => {
    const el = fillEl();
    if (!el) return;
    delete el.fillGradient;
    el.fill = 'transparent'; quickRestyle(el); commit();
  })], { getEl: fillEl, field: 'fill', onLive: (e) => { quickRestyle(e); } });

  const strokeEl = () => {
    if (selection.length !== 1) return null;
    const e = findElement(getActiveSlide(), selection[0]);
    return e && ('stroke' in e) ? e : null;
  };
  buildColorPalette(document.getElementById('menu-fmt-stroke'), (c) => {
    const el = strokeEl();
    if (!el) return;
    el.stroke = c; if (!el.strokeWidth) el.strokeWidth = 2; quickRestyle(el); commit();
  }, [mkTextMenuButton('線なし', () => {
    const el = strokeEl();
    if (!el || !('strokeWidth' in el)) return;
    el.strokeWidth = 0; quickRestyle(el); commit();
  })], { getEl: strokeEl, field: 'stroke', onLive: (e) => { quickRestyle(e); } });

  const effectMenu = document.getElementById('menu-fmt-effect');
  effectMenu.appendChild(mkTextMenuButton('影を付ける / 消す', () => {
    if (selection.length !== 1) return;
    const el = findElement(getActiveSlide(), selection[0]);
    if (!el) return;
    el.shadow = !el.shadow;
    renderCanvas();
    commit();
  }));

  const textEl = () => {
    if (selection.length !== 1) return null;
    const e = findElement(getActiveSlide(), selection[0]);
    return e && e.type === 'text' ? e : null;
  };
  buildColorPalette(document.getElementById('menu-fmt-textfill'), (c) => {
    const el = textEl();
    if (!el) return;
    el.color = c; updateTextLive(el); commit();
  }, null, { getEl: textEl, field: 'color', onLive: (e) => { updateTextLive(e); } });

  buildColorPalette(document.getElementById('menu-fmt-textoutline'), (c) => {
    const el = textEl();
    if (!el) return;
    el.textStroke = c; renderCanvas(); commit();
  }, [mkTextMenuButton('輪郭なし', () => {
    const el = textEl();
    if (!el) return;
    el.textStroke = null; renderCanvas(); commit();
  })], { getEl: () => { const e = textEl(); return e && e.textStroke ? e : null; }, field: 'textStroke', onLive: () => renderCanvas() });

  const texteffectMenu = document.getElementById('menu-fmt-texteffect');
  texteffectMenu.appendChild(mkTextMenuButton('影を付ける / 消す', () => {
    if (selection.length !== 1) return;
    const el = findElement(getActiveSlide(), selection[0]);
    if (!el || el.type !== 'text') return;
    el.textShadow = !el.textShadow;
    renderCanvas();
    commit();
  }));
}

const WORDART_PRESETS = [
  { color: '#1a1a1a', bold: false, textShadow: false, textStroke: null },
  { color: '#6c4ff2', bold: true, textShadow: false, textStroke: null },
  { color: '#ffffff', bold: true, textShadow: true, textStroke: '#4a2fd6' },
  { color: '#ff7a45', bold: true, textShadow: true, textStroke: null },
];

function initWordArtRow() {
  const row = document.getElementById('wordart-row');
  WORDART_PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'wordart-swatch';
    b.style.color = p.color;
    b.style.background = p.color === '#ffffff' ? '#6c4ff2' : '#f3f1fa';
    if (p.textShadow) b.style.textShadow = '1px 2px 2px rgba(0,0,0,0.5)';
    if (p.textStroke) b.style.webkitTextStroke = `0.6px ${p.textStroke}`;
    b.textContent = 'A';
    b.addEventListener('click', () => {
      if (selection.length !== 1) return;
      const el = findElement(getActiveSlide(), selection[0]);
      if (!el || el.type !== 'text') return;
      el.color = p.color; el.bold = p.bold; el.textShadow = p.textShadow; el.textStroke = p.textStroke;
      renderCanvas();
      commit();
    });
    row.appendChild(b);
  });
}

function alignSelected(mode) {
  if (!selection.length) return;
  const slide = getActiveSlide();
  selection.forEach((id) => {
    const el = findElement(slide, id);
    if (!el) return;
    if (mode === 'left') el.x = 0;
    else if (mode === 'centerX') el.x = (SLIDE_W - el.w) / 2;
    else if (mode === 'right') el.x = SLIDE_W - el.w;
    else if (mode === 'top') el.y = 0;
    else if (mode === 'centerY') el.y = (SLIDE_H - el.h) / 2;
    else if (mode === 'bottom') el.y = SLIDE_H - el.h;
  });
  commit();
}

function groupSelected() {
  if (selection.length < 2) return;
  const gid = uid();
  const slide = getActiveSlide();
  selection.forEach((id) => { const el = findElement(slide, id); if (el) el.groupId = gid; });
  commit();
}

function ungroupSelected() {
  const slide = getActiveSlide();
  selection.forEach((id) => { const el = findElement(slide, id); if (el) delete el.groupId; });
  commit();
}

function rotateSelected(deg) {
  const slide = getActiveSlide();
  selection.forEach((id) => { const el = findElement(slide, id); if (el) el.rotation = ((el.rotation || 0) + deg + 360) % 360; });
  renderCanvas();
  commit();
}

function flipSelected(axis) {
  const slide = getActiveSlide();
  selection.forEach((id) => {
    const el = findElement(slide, id);
    if (!el) return;
    if (axis === 'h') el.flipH = !el.flipH; else el.flipV = !el.flipV;
  });
  renderCanvas();
  commit();
}

const FMT_TYPE_LABEL = { text: 'テキスト', rect: '四角形', ellipse: '楕円', poly: '図形', line: '直線', arrow: '矢印', 'double-arrow': '矢印', image: '画像', draw: '描画' };

function openObjectPane() {
  const menu = document.getElementById('menu-fmt-objpane');
  const slide = getActiveSlide();
  menu.innerHTML = '';
  const sorted = slide.elements.slice().sort((a, b) => b.zIndex - a.zIndex);
  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.className = 'prop-hint';
    empty.style.padding = '8px';
    empty.textContent = 'このスライドには要素がありません';
    menu.appendChild(empty);
    return;
  }
  sorted.forEach((el, i) => {
    const b = document.createElement('button');
    b.textContent = `${FMT_TYPE_LABEL[el.type] || el.type} ${sorted.length - i}`;
    if (selection.includes(el.id)) b.style.fontWeight = '700';
    b.addEventListener('click', () => {
      closeDropdowns();
      selection = [el.id];
      renderSelectionOverlay();
      renderPropPanel();
    });
    menu.appendChild(b);
  });
}

function toggleAltTextPopover() {
  const pop = document.getElementById('alttext-popover');
  const btn = document.getElementById('btn-fmt-alttext');
  if (!pop.classList.contains('hidden')) { pop.classList.add('hidden'); return; }
  if (selection.length !== 1) return;
  const el = findElement(getActiveSlide(), selection[0]);
  if (!el) return;
  const rect = btn.getBoundingClientRect();
  pop.style.left = rect.left + 'px';
  pop.style.top = (rect.bottom + 6) + 'px';
  document.getElementById('alttext-input').value = el.altText || '';
  pop.classList.remove('hidden');
}

// ---- 図形の結合 (統合・型抜き/合成・切り出し・重色合成・型抜き) ----

const MERGE_ABLE_TYPES = ['rect', 'ellipse', 'poly', 'image', 'text'];

function getElRotatedBBox(el) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const theta = (el.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const corners = [[0, 0], [el.w, 0], [el.w, el.h], [0, el.h]].map(([lx, ly]) => {
    const dx = lx - el.w / 2, dy = ly - el.h / 2;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function computeMergedBBox(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  elements.forEach((el) => {
    const b = getElRotatedBBox(el);
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  });
  const pad = 4;
  return { x: minX - pad, y: minY - pad, w: Math.max(1, (maxX - minX) + pad * 2), h: Math.max(1, (maxY - minY) + pad * 2) };
}

// 指定した図形のシルエットを、origin/scale で変換したキャンバス座標に塗る
function fillShapeSilhouette(ctx, el, originX, originY, scale, compositeOp, color) {
  ctx.save();
  ctx.globalCompositeOperation = compositeOp;
  const cx = (el.x + el.w / 2 - originX) * scale;
  const cy = (el.y + el.h / 2 - originY) * scale;
  ctx.translate(cx, cy);
  ctx.rotate((el.rotation || 0) * Math.PI / 180);
  ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
  const w = el.w * scale, h = el.h * scale;
  if (el.type === 'text') {
    // 文字は矩形の外形ではなく、実際に描画されるグリフの形をシルエットとして使う
    ctx.translate(-w / 2, -h / 2);
    const fontSize = el.fontSize * scale;
    ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700' : '400'} ${fontSize}px ${el.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left';
    ctx.fillStyle = color;
    const lines = wrapText(ctx, el.text || '', w);
    const lineHeight = fontSize * 1.3;
    const tx = el.align === 'center' ? w / 2 : el.align === 'right' ? w : 0;
    lines.forEach((line, i) => ctx.fillText(line, tx, i * lineHeight));
    ctx.restore();
    return;
  }
  ctx.beginPath();
  if (el.type === 'rect' || el.type === 'image') {
    const r = Math.min((el.cornerRadius || 0) * scale, w / 2, h / 2);
    if (r > 0 && ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, r);
    else ctx.rect(-w / 2, -h / 2, w, h);
  } else if (el.type === 'ellipse') {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (el.type === 'poly') {
    const pts = polyPoints(el.shapeKind).map(([x, y]) => [x * w - w / 2, y * h - h / 2]);
    pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function canvasHasContent(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 10) return true;
  return false;
}

function rasterizeSilhouette(elements, bbox, scale, mode) {
  const c = makeCanvas(bbox.w * scale, bbox.h * scale);
  const ctx = c.getContext('2d');
  if (mode === 'union') {
    elements.forEach((el) => fillShapeSilhouette(ctx, el, bbox.x, bbox.y, scale, 'source-over', '#000'));
  } else if (mode === 'combine') {
    elements.forEach((el, i) => fillShapeSilhouette(ctx, el, bbox.x, bbox.y, scale, i === 0 ? 'source-over' : 'xor', '#000'));
  } else if (mode === 'intersect') {
    fillShapeSilhouette(ctx, elements[0], bbox.x, bbox.y, scale, 'source-over', '#000');
    for (let i = 1; i < elements.length; i++) fillShapeSilhouette(ctx, elements[i], bbox.x, bbox.y, scale, 'destination-in', '#000');
  } else if (mode === 'subtract') {
    fillShapeSilhouette(ctx, elements[0], bbox.x, bbox.y, scale, 'source-over', '#000');
    for (let i = 1; i < elements.length; i++) fillShapeSilhouette(ctx, elements[i], bbox.x, bbox.y, scale, 'destination-out', '#000');
  }
  return c;
}

// 「切り出し」は重なりのパターンごとに図形を分割する必要がある。
// N個の図形に対し、空でない部分集合ごとに「その集合に含まれる図形すべての共通部分」から
// 「集合に含まれない図形との重なり」を除いた断片を求める(いわゆるベン図の全領域分解)。
// 2図形なら3断片(A単独/B単独/重なり)、3図形なら最大7断片になる。
function computeFragmentPieces(elements, bbox, scale) {
  const n = elements.length;
  const pieces = [];
  const total = 1 << n;
  for (let mask = 1; mask < total; mask++) {
    const c = makeCanvas(bbox.w * scale, bbox.h * scale);
    const ctx = c.getContext('2d');
    let first = true;
    let lowestInMask = -1;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        fillShapeSilhouette(ctx, elements[i], bbox.x, bbox.y, scale, first ? 'source-over' : 'destination-in', '#000');
        first = false;
        if (lowestInMask === -1) lowestInMask = i;
      }
    }
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) {
        fillShapeSilhouette(ctx, elements[i], bbox.x, bbox.y, scale, 'destination-out', '#000');
      }
    }
    // 図形の結合は「最初に選択した図形」の色を引き継ぐ慣習に合わせ、断片も含まれる図形の中で
    // もっとも早く選択されたものの色を採用する
    if (canvasHasContent(c)) pieces.push({ canvas: c, sourceEl: elements[lowestInMask] });
  }
  return pieces;
}

// 画像を「結合」の塗り(fillImage)として使うため、元の位置・サイズ・回転を
// 結合後の bbox 基準のローカル座標に変換して保持する(=画像は引き伸ばさず、
// 図形の形で切り抜かれたように見せる)
function buildFillImageFromEl(imgEl, bbox) {
  return {
    src: imgEl.src,
    x: imgEl.x - bbox.x, y: imgEl.y - bbox.y,
    w: imgEl.w, h: imgEl.h,
    rotation: imgEl.rotation || 0,
    flipH: !!imgEl.flipH, flipV: !!imgEl.flipV,
  };
}

function mergeStyleOverrides(sourceEl, bbox, zIndex) {
  if (sourceEl.type === 'image') {
    return { fill: '#6c4ff2', fillImage: buildFillImageFromEl(sourceEl, bbox), zIndex };
  }
  const colorSource = sourceEl.type === 'text' ? sourceEl.color : sourceEl.fill;
  const fillColor = (colorSource && colorSource !== 'transparent') ? colorSource : '#6c4ff2';
  return { fill: fillColor, zIndex };
}

function performShapeMerge(mode) {
  closeDropdowns();
  const slide = getActiveSlide();
  const elements = selection.map(id => findElement(slide, id)).filter(el => el && MERGE_ABLE_TYPES.includes(el.type));
  if (elements.length < 2) { showToast('図形の結合には図形・画像・テキストを2つ以上選択してください'); return; }

  const bbox = computeMergedBBox(elements);
  const scale = Math.min(4, Math.max(1, 700 / Math.max(bbox.w, bbox.h)));
  const idsToRemove = new Set(selection);

  if (mode === 'fragment') {
    if (elements.length > 6) { showToast('切り出しは図形6個までを選択してください'); return; }
    const pieces = computeFragmentPieces(elements, bbox, scale);
    if (!pieces.length) { showToast('重なりが見つからず、結合できませんでした'); return; }
    slide.elements = slide.elements.filter(e => !idsToRemove.has(e.id));
    const baseZ = nextZIndex(slide);
    const newIds = [];
    pieces.forEach((p, i) => {
      const overrides = mergeStyleOverrides(p.sourceEl, bbox, baseZ + i);
      const el = createMergedEl(bbox, p.canvas.toDataURL('image/png'), overrides);
      slide.elements.push(el);
      newIds.push(el.id);
    });
    selection = newIds;
  } else {
    const canvas = rasterizeSilhouette(elements, bbox, scale, mode);
    if (!canvasHasContent(canvas)) { showToast('結合結果が空になりました(図形が重なっていません)'); return; }
    const styleSource = elements[0];
    const overrides = mergeStyleOverrides(styleSource, bbox, nextZIndex(slide));
    slide.elements = slide.elements.filter(e => !idsToRemove.has(e.id));
    const newEl = createMergedEl(bbox, canvas.toDataURL('image/png'), overrides);
    slide.elements.push(newEl);
    selection = [newEl.id];
  }
  renderCanvas();
  commit();
}

function syncFormatTab() {
  const tabBtn = document.querySelector('.ribbon-tab[data-tab="format"]');
  if (!tabBtn) return;
  const wasHidden = tabBtn.classList.contains('hidden');
  const hasSel = selection.length >= 1;
  tabBtn.classList.toggle('hidden', !hasSel);
  if (hasSel && wasHidden) {
    activateRibbonTab('format');
  } else if (!hasSel && tabBtn.classList.contains('active')) {
    activateRibbonTab('home');
  }
  document.getElementById('alttext-popover').classList.add('hidden');
  if (!hasSel) return;

  const single = selection.length === 1 ? findElement(getActiveSlide(), selection[0]) : null;
  const fillDot = document.getElementById('fmt-fill-dot');
  const strokeDot = document.getElementById('fmt-stroke-dot');
  const textfillDot = document.getElementById('fmt-textfill-dot');
  const textoutlineDot = document.getElementById('fmt-textoutline-dot');
  const heightInput = document.getElementById('fmt-height-input');
  const widthInput = document.getElementById('fmt-width-input');

  if (single) {
    fillDot.style.background = (single.fill && single.fill !== 'transparent') ? single.fill : '#ffffff';
    strokeDot.style.background = single.stroke || '#000000';
    textfillDot.style.background = single.type === 'text' ? (single.color || '#000000') : '#cccccc';
    textoutlineDot.style.background = single.textStroke || '#cccccc';
    heightInput.value = pxToCm(single.h).toFixed(2);
    widthInput.value = pxToCm(single.w).toFixed(2);
    document.getElementById('btn-fmt-changeshape').disabled = !SHAPE_LIKE_TYPES.includes(single.type);
  } else {
    heightInput.value = '';
    widthInput.value = '';
    document.getElementById('btn-fmt-changeshape').disabled = true;
  }

  const slideForMerge = getActiveSlide();
  const mergeCandidates = selection.map(id => findElement(slideForMerge, id)).filter(e => e && MERGE_ABLE_TYPES.includes(e.type));
  document.getElementById('btn-fmt-merge').disabled = mergeCandidates.length < 2;
}

// ---- 初期化とイベント配線 ----

function isTypingContext() {
  const ae = document.activeElement;
  return ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
}

function initEvents() {
  document.getElementById('deck-title').value = deck.title;
  document.getElementById('deck-title').addEventListener('input', (e) => { deck.title = e.target.value; scheduleSave(); });

  document.getElementById('btn-add-slide').addEventListener('click', addSlide);
  document.getElementById('slide-list').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-action="delete-slide"]');
    if (delBtn) { deleteSlideById(delBtn.dataset.slideId); return; }
    const dupBtn = e.target.closest('[data-action="dup-slide"]');
    if (dupBtn) { duplicateSlideById(dupBtn.dataset.slideId); return; }
    const item = e.target.closest('.slide-thumb');
    if (item) selectSlide(item.dataset.slideId);
  });
  document.getElementById('slide-list').addEventListener('contextmenu', openSlideContextMenu);
  let dragSlideId = null;
  document.getElementById('slide-list').addEventListener('dragstart', (e) => {
    const item = e.target.closest('.slide-thumb');
    if (item) { dragSlideId = item.dataset.slideId; e.dataTransfer.effectAllowed = 'move'; }
  });
  document.getElementById('slide-list').addEventListener('dragover', (e) => {
    e.preventDefault();
    document.querySelectorAll('.slide-thumb.drop-before,.slide-thumb.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    const item = e.target.closest('.slide-thumb');
    if (item && item.dataset.slideId !== dragSlideId) {
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      item.classList.add(before ? 'drop-before' : 'drop-after');
    }
  });
  document.getElementById('slide-list').addEventListener('drop', (e) => {
    e.preventDefault();
    const item = e.target.closest('.slide-thumb');
    document.querySelectorAll('.slide-thumb.drop-before,.slide-thumb.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    if (item && dragSlideId && item.dataset.slideId !== dragSlideId) {
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      reorderSlide(dragSlideId, item.dataset.slideId, before);
    }
    dragSlideId = null;
  });

  document.getElementById('btn-add-text').addEventListener('click', addTextBox);
  document.getElementById('btn-add-shape').addEventListener('click', () => toggleDropdown('dd-shape'));
  document.getElementById('shape-menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-shape]');
    if (b) { addShape(b.dataset.shape); closeDropdowns(); }
  });
  document.getElementById('btn-add-image').addEventListener('click', () => document.getElementById('file-image').click());
  document.getElementById('file-image').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) handleImageFile(f);
    e.target.value = '';
  });

  document.getElementById('btn-export').addEventListener('click', () => toggleDropdown('dd-export'));
  document.getElementById('export-png').addEventListener('click', async () => {
    closeDropdowns();
    showToast('PNGを書き出しています…');
    await exportCurrentSlidePNG(deck, getActiveSlide());
  });
  document.getElementById('export-pdf').addEventListener('click', async () => {
    closeDropdowns();
    showToast('PDFを書き出しています…しばらくお待ちください');
    await exportDeckPDF(deck);
  });

  document.getElementById('btn-present').addEventListener('click', () => {
    const idx = deck.slides.findIndex(s => s.id === activeSlideId);
    Present.start(deck, idx);
  });

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  document.getElementById('zoom-in').addEventListener('click', () => { stageScale = Math.min(2.5, stageScale + 0.1); applyZoom(); });
  document.getElementById('zoom-out').addEventListener('click', () => { stageScale = Math.max(0.2, stageScale - 0.1); applyZoom(); });
  document.getElementById('zoom-fit').addEventListener('click', zoomFit);
  document.getElementById('zoom-in-ribbon').addEventListener('click', () => { stageScale = Math.min(2.5, stageScale + 0.1); applyZoom(); });
  document.getElementById('zoom-out-ribbon').addEventListener('click', () => { stageScale = Math.max(0.2, stageScale - 0.1); applyZoom(); });
  document.getElementById('zoom-fit-ribbon').addEventListener('click', zoomFit);

  // ---- リボンタブ切り替え ----
  document.getElementById('ribbon-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.ribbon-tab');
    if (!tab) return;
    activateRibbonTab(tab.dataset.tab);
  });

  // ---- ホームタブ: スライド/編集/重なり順 ----
  document.getElementById('btn-add-slide-ribbon').addEventListener('click', addSlide);
  document.getElementById('btn-dup-ribbon').addEventListener('click', () => {
    if (selection.length) duplicateSelected(); else duplicateSlideById(activeSlideId);
  });
  document.getElementById('btn-del-ribbon').addEventListener('click', () => {
    if (selection.length) deleteSelected(); else deleteSlideById(activeSlideId);
  });
  document.getElementById('btn-front-ribbon').addEventListener('click', () => { if (selection.length >= 1) setLayerOrder('front'); });
  document.getElementById('btn-back-ribbon').addEventListener('click', () => { if (selection.length >= 1) setLayerOrder('back'); });

  // ---- デザインタブ: 背景色 ----
  const bgSwatchColors = ['#ffffff', '#f4f2fb', '#fdf6e3', '#e9f3ff', '#eafaf1', '#fdecec', '#fdf0f7', '#2b2440', '#0b1220'];
  const swatchRow = document.getElementById('bg-swatches');
  bgSwatchColors.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => {
      getActiveSlide().background = { type: 'color', value: c };
      document.getElementById('slide-canvas').style.background = c;
      document.getElementById('bg-color-input').value = c;
      commit();
    });
    swatchRow.appendChild(b);
  });
  const bgColorInput = document.getElementById('bg-color-input');
  bgColorInput.addEventListener('input', () => {
    getActiveSlide().background = { type: 'color', value: bgColorInput.value };
    document.getElementById('slide-canvas').style.background = bgColorInput.value;
  });
  bgColorInput.addEventListener('change', () => commit());

  // ---- ホームタブ: クリップボード ----
  document.getElementById('btn-cut-ribbon').addEventListener('click', cutSelected);
  document.getElementById('btn-copy-ribbon').addEventListener('click', copySelected);
  document.getElementById('btn-paste-ribbon').addEventListener('click', pasteClipboard);

  // ---- 描画タブ ----
  document.getElementById('draw-color-input').addEventListener('input', (e) => { drawColor = e.target.value; });
  document.getElementById('draw-width-input').addEventListener('input', (e) => { drawWidth = Number(e.target.value) || 3; });
  document.querySelectorAll('#ribbon-panels [data-panel="draw"] [data-draw-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setDrawMode(btn.dataset.drawMode || null));
  });

  // ---- 画面切り替えタブ ----
  document.querySelectorAll('#ribbon-panels [data-panel="transitions"] [data-transition]').forEach((btn) => {
    btn.addEventListener('click', () => {
      getActiveSlide().transition = btn.dataset.transition;
      commit();
    });
  });

  // ---- アニメーションタブ ----
  document.getElementById('btn-anim-toggle').addEventListener('click', () => {
    if (selection.length !== 1) return;
    const el = findElement(getActiveSlide(), selection[0]);
    if (!el) return;
    el.animateIn = !el.animateIn;
    commit();
  });

  // ---- スライドショータブ ----
  document.getElementById('btn-present-from-start').addEventListener('click', () => Present.start(deck, 0));
  document.getElementById('btn-present-from-current').addEventListener('click', () => {
    const idx = deck.slides.findIndex(s => s.id === activeSlideId);
    Present.start(deck, idx);
  });

  // ---- 記録タブ ----
  document.getElementById('btn-record-present').addEventListener('click', () => {
    const idx = deck.slides.findIndex(s => s.id === activeSlideId);
    Present.start(deck, idx, { record: true });
  });

  // ---- 校閲タブ ----
  document.getElementById('btn-comment-add').addEventListener('click', addComment);
  document.getElementById('comment-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addComment(); }
  });

  // ---- 表示タブ: グリッド線 ----
  document.getElementById('grid-toggle').addEventListener('change', (e) => {
    document.getElementById('grid-overlay').classList.toggle('hidden', !e.target.checked);
  });

  // ---- スライド一覧表示 ----
  document.getElementById('btn-normal-view').addEventListener('click', () => setViewMode('normal'));
  document.getElementById('btn-sorter-view').addEventListener('click', () => setViewMode('sorter'));

  const sorterGrid = document.getElementById('slide-sorter-grid');
  sorterGrid.addEventListener('contextmenu', openSlideContextMenu);
  sorterGrid.addEventListener('click', (e) => {
    if (e.target.closest('#sorter-add-btn')) { addSlide(); renderSlideSorter(); return; }
    const dupBtn = e.target.closest('[data-action="dup"]');
    if (dupBtn) { duplicateSlideById(dupBtn.closest('.sorter-tile').dataset.slideId); renderSlideSorter(); return; }
    const delBtn = e.target.closest('[data-action="del"]');
    if (delBtn) { deleteSlideById(delBtn.closest('.sorter-tile').dataset.slideId); renderSlideSorter(); return; }
    const tile = e.target.closest('.sorter-tile');
    if (tile && tile.dataset.slideId !== activeSlideId) {
      activeSlideId = tile.dataset.slideId;
      selection = []; editingTextId = null;
      renderSlideListUI();
      renderSlideSorter();
    }
  });
  sorterGrid.addEventListener('dblclick', (e) => {
    const tile = e.target.closest('.sorter-tile');
    if (!tile) return;
    activeSlideId = tile.dataset.slideId;
    selection = []; editingTextId = null;
    setViewMode('normal');
    renderCanvas(); renderSlideListUI(); renderPropPanel(); zoomFit();
  });
  let sorterDragId = null;
  sorterGrid.addEventListener('dragstart', (e) => {
    const tile = e.target.closest('.sorter-tile');
    if (tile) { sorterDragId = tile.dataset.slideId; e.dataTransfer.effectAllowed = 'move'; }
  });
  sorterGrid.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.querySelectorAll('.sorter-tile.drop-before,.sorter-tile.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    const tile = e.target.closest('.sorter-tile');
    if (tile && tile.dataset.slideId !== sorterDragId) {
      const rect = tile.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      tile.classList.add(before ? 'drop-before' : 'drop-after');
    }
  });
  sorterGrid.addEventListener('drop', (e) => {
    e.preventDefault();
    const tile = e.target.closest('.sorter-tile');
    document.querySelectorAll('.sorter-tile.drop-before,.sorter-tile.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    if (tile && sorterDragId && tile.dataset.slideId !== sorterDragId) {
      const rect = tile.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      reorderSlide(sorterDragId, tile.dataset.slideId, before);
      renderSlideSorter();
    }
    sorterDragId = null;
  });

  // ---- 図形の書式 (コンテキストタブ) ----
  initQuickStyles();
  initFmtInsertGrid();
  initFmtChangeShapeGallery();
  initFmtStyleMenus();
  initWordArtRow();

  document.getElementById('btn-fmt-textbox').addEventListener('click', addTextBox);

  document.getElementById('menu-fmt-front2').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-layer]');
    if (!b) return;
    closeDropdowns();
    if (selection.length >= 1) setLayerOrder(b.dataset.layer);
  });
  document.getElementById('menu-fmt-back2').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-layer]');
    if (!b) return;
    closeDropdowns();
    if (selection.length >= 1) setLayerOrder(b.dataset.layer);
  });
  document.getElementById('menu-fmt-align').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-align]');
    if (!b) return;
    closeDropdowns();
    alignSelected(b.dataset.align);
  });
  document.getElementById('menu-fmt-group').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-group]');
    if (!b) return;
    closeDropdowns();
    if (b.dataset.group === 'group') groupSelected(); else ungroupSelected();
  });
  document.getElementById('menu-fmt-rotate').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rotate], button[data-flip]');
    if (!b) return;
    closeDropdowns();
    if (b.dataset.rotate) rotateSelected(Number(b.dataset.rotate));
    else flipSelected(b.dataset.flip);
  });
  document.getElementById('menu-fmt-merge').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-merge]');
    if (!b) return;
    performShapeMerge(b.dataset.merge);
  });

  document.getElementById('btn-fmt-objpane').addEventListener('click', () => {
    const wasOpen = document.getElementById('dd-fmt-objpane').classList.contains('open');
    if (!wasOpen) openObjectPane();
    toggleDropdown('dd-fmt-objpane');
  });

  // その他の 図形の書式 タブ用ドロップダウンを一括で開閉できるようにする
  document.querySelectorAll('#ribbon-panels [data-panel="format"] .dropdown').forEach((dd) => {
    if (dd.id === 'dd-fmt-objpane') return;
    const btn = dd.querySelector(':scope > button');
    if (btn) btn.addEventListener('click', () => toggleDropdown(dd.id));
  });
  document.getElementById('btn-fmt-alttext').addEventListener('click', (e) => { e.stopPropagation(); toggleAltTextPopover(); });
  document.getElementById('alttext-input').addEventListener('input', (e) => {
    if (selection.length !== 1) return;
    const el = findElement(getActiveSlide(), selection[0]);
    if (el) el.altText = e.target.value;
  });
  document.getElementById('alttext-input').addEventListener('blur', () => { scheduleSave(); historyPush(history, deck); });

  document.getElementById('fmt-height-input').addEventListener('change', (e) => {
    if (selection.length !== 1) return;
    const el = findElement(getActiveSlide(), selection[0]);
    if (!el) return;
    const cm = parseFloat(e.target.value);
    if (!isFinite(cm) || cm <= 0) return;
    el.h = Math.max(MIN_SIZE, cmToPx(cm));
    repositionElementNode(el);
    commit();
  });
  document.getElementById('fmt-width-input').addEventListener('change', (e) => {
    if (selection.length !== 1) return;
    const el = findElement(getActiveSlide(), selection[0]);
    if (!el) return;
    const cm = parseFloat(e.target.value);
    if (!isFinite(cm) || cm <= 0) return;
    el.w = Math.max(MIN_SIZE, cmToPx(cm));
    repositionElementNode(el);
    commit();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#alttext-popover') && !e.target.closest('#btn-fmt-alttext')) {
      document.getElementById('alttext-popover').classList.add('hidden');
    }
    if (!e.target.closest('.dropdown')) closeDropdowns();
    if (!e.target.closest('#context-menu')) closeContextMenu();
  });
  document.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('blur', closeContextMenu);

  const canvas = document.getElementById('slide-canvas');
  canvas.addEventListener('contextmenu', openContextMenu);
  canvas.addEventListener('mousedown', (e) => {
    if (drawMode === 'pen' || drawMode === 'highlighter') { beginDrawStroke(e, drawMode); return; }
    if (drawMode === 'eraser') { beginErase(e); return; }
    if (editingTextId && !e.target.closest(`.sl-el[data-id="${editingTextId}"] .sl-text-inner`)) {
      commitTextEdit();
    }
    const handle = e.target.closest('.handle');
    if (handle) {
      if (handle.dataset.handle === 'rotate') beginRotateDrag(e, handle.dataset.id);
      else beginResizeDrag(e, handle.dataset.id, handle.dataset.handle);
      return;
    }
    const elNode = e.target.closest('.sl-el');
    if (elNode) {
      const id = elNode.dataset.id;
      if (id === editingTextId) return;
      if (e.shiftKey) {
        selection = selection.includes(id) ? selection.filter(x => x !== id) : selection.concat(id);
        renderSelectionOverlay();
        renderPropPanel();
        return;
      }
      const clickedEl = findElement(getActiveSlide(), id);
      if (clickedEl && clickedEl.groupId && !selection.includes(id)) {
        selection = getActiveSlide().elements.filter(x => x.groupId === clickedEl.groupId).map(x => x.id);
        renderSelectionOverlay();
        renderPropPanel();
      }
      beginMoveDrag(e, id);
      return;
    }
    beginMarquee(e);
  });
  canvas.addEventListener('dblclick', (e) => {
    const elNode = e.target.closest('.sl-el-text');
    if (!elNode) return;
    editingTextId = elNode.dataset.id;
    selection = [editingTextId];
    const clickX = e.clientX, clickY = e.clientY;
    renderCanvas();
    renderPropPanel();
    requestAnimationFrame(() => {
      const node = document.querySelector(`#slide-canvas .sl-el[data-id="${editingTextId}"] .sl-text-inner`);
      if (node) { node.focus(); placeCaretAtPoint(node, clickX, clickY); }
    });
  });

  document.getElementById('canvas-scroll').addEventListener('mousedown', (e) => {
    if (e.target.closest('#slide-canvas')) return;
    if (editingTextId) commitTextEdit();
    if (!selection.length) return;
    selection = [];
    renderSelectionOverlay();
    renderPropPanel();
  });

  document.getElementById('btn-menu').addEventListener('click', () => openHomeScreen());
  document.getElementById('btn-new-ribbon').addEventListener('click', () => openHomeScreen());
  document.getElementById('btn-home-close').addEventListener('click', () => closeHomeScreen());
  document.getElementById('home-new-blank').addEventListener('click', () => {
    resetToNewDeck();
    closeHomeScreen();
  });
  document.getElementById('home-recent-list').addEventListener('click', (e) => {
    const row = e.target.closest('.home-recent-row');
    if (!row) return;
    const id = row.dataset.deckId;
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) {
      e.stopPropagation();
      if (confirm('このプレゼンテーションを削除しますか?\n(この操作は取り消せません)')) {
        deleteDeckFromLibrary(id);
        renderHomeScreen();
      }
      return;
    }
    openDeckFromLibrary(id);
  });

  document.getElementById('btn-file-save').addEventListener('click', () => {
    exportDeckAsFile(deck);
    showToast('編集可能なファイルとして保存しました');
  });
  document.getElementById('btn-file-open').addEventListener('click', () => {
    document.getElementById('file-open-project').click();
  });
  document.getElementById('file-open-project').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm('ファイルを開きますか?\n(現在編集中の内容は上書きされます)')) return;
    try {
      const text = await f.text();
      const loaded = JSON.parse(text);
      if (!loaded || !Array.isArray(loaded.slides) || !loaded.slides.length) throw new Error('invalid deck');
      deck = loaded;
      activeSlideId = deck.slides[0].id;
      selection = [];
      editingTextId = null;
      history = createHistory(deck);
      document.getElementById('deck-title').value = deck.title || '無題のプレゼンテーション';
      renderCanvas();
      renderSlideListUI();
      renderPropPanel();
      zoomFit();
      scheduleSave();
      showToast('ファイルを読み込みました');
    } catch (err) {
      showToast('ファイルの読み込みに失敗しました(形式が正しくありません)');
    }
  });

  document.getElementById('btn-file-export-png').addEventListener('click', async () => {
    showToast('PNGを書き出しています…');
    await exportCurrentSlidePNG(deck, getActiveSlide());
  });
  document.getElementById('btn-file-export-pdf').addEventListener('click', async () => {
    showToast('PDFを書き出しています…しばらくお待ちください');
    await exportDeckPDF(deck);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('context-menu').classList.contains('hidden')) { closeContextMenu(); return; }
      if (drawMode) { setDrawMode(null); return; }
      if (editingTextId) { commitTextEdit(); return; }
      if (selection.length) { selection = []; renderSelectionOverlay(); renderPropPanel(); }
      return;
    }
    if (isTypingContext()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
      else if (e.key.toLowerCase() === 'c') { copySelected(); }
      else if (e.key.toLowerCase() === 'v') { pasteClipboard(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); deleteSelected(); }
    else if (e.key.startsWith('Arrow') && selection.length) { e.preventDefault(); nudgeSelected(e.key, e.shiftKey); }
  });

  document.addEventListener('paste', (e) => {
    if (isTypingContext()) return;
    if (!document.getElementById('home-screen').classList.contains('hidden')) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageFile(file);
        return;
      }
    }
  });

  window.addEventListener('resize', () => zoomFit());
  window.addEventListener('pagehide', () => saveDeck(deck));
}

function toggleDropdown(id) {
  const dropdown = document.getElementById(id);
  const wasOpen = dropdown.classList.contains('open');
  closeDropdowns();
  if (wasOpen) return;
  dropdown.classList.add('open');
  const btn = dropdown.querySelector('button');
  const menu = dropdown.querySelector('.dropdown-menu');
  if (menu._syncOpacity) menu._syncOpacity();
  const btnRect = btn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = btnRect.left;
  let top = btnRect.bottom + 6;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (left < 8) left = 8;
  if (top + menuRect.height > window.innerHeight - 8) top = btnRect.top - menuRect.height - 6;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}
function closeDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(n => n.classList.remove('open'));
}

function init() {
  initEvents();
  renderCanvas();
  renderSlideListUI();
  renderPropPanel();
  zoomFit();
  openHomeScreen();
}

document.addEventListener('DOMContentLoaded', init);
