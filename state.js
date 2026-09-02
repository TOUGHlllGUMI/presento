// ロジック層: DOM に触れない純粋なデータモデル操作。editor.js から呼ばれる。

const SLIDE_W = 960;
const SLIDE_H = 540;
const STORAGE_KEY = 'presento.deck.v1';
const PX_PER_CM = SLIDE_W / 33.867; // 16:9スライド(33.867cm x 19.05cm)を基準にした換算

function pxToCm(px) { return px / PX_PER_CM; }
function cmToPx(cm) { return cm * PX_PER_CM; }

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function createDefaultTextEl(overrides) {
  return Object.assign({
    id: uid(),
    type: 'text',
    x: 180, y: 220, w: 600, h: 100,
    rotation: 0,
    zIndex: 1,
    text: 'テキストを入力',
    fontFamily: "'Zen Kaku Gothic New', 'Noto Sans JP', sans-serif",
    fontSize: 32,
    color: '#1a1a1a',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    fill: 'transparent',
  }, overrides || {});
}

const POLY_SHAPES = new Set([
  'triangle', 'right-triangle', 'diamond', 'parallelogram', 'trapezoid',
  'pentagon', 'hexagon', 'star', 'star6', 'heart', 'cross', 'chevron',
]);
const LINE_SHAPES = new Set(['line', 'arrow', 'double-arrow']);

function polyPoints(shapeKind) {
  const pts = (arr) => arr;
  switch (shapeKind) {
    case 'triangle': return pts([[0.5, 0], [1, 1], [0, 1]]);
    case 'right-triangle': return pts([[0, 0], [0, 1], [1, 1]]);
    case 'diamond': return pts([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case 'parallelogram': return pts([[0.28, 0], [1, 0], [0.72, 1], [0, 1]]);
    case 'trapezoid': return pts([[0.22, 0], [0.78, 0], [1, 1], [0, 1]]);
    case 'chevron': return pts([[0, 0], [0.65, 0], [1, 0.5], [0.65, 1], [0, 1], [0.35, 0.5]]);
    case 'cross': return pts([
      [0.36, 0], [0.64, 0], [0.64, 0.36], [1, 0.36], [1, 0.64], [0.64, 0.64],
      [0.64, 1], [0.36, 1], [0.36, 0.64], [0, 0.64], [0, 0.36], [0.36, 0.36],
    ]);
    case 'pentagon': return regularPolygon(5, -90);
    case 'hexagon': return regularPolygon(6, 0);
    case 'star': return starPoints(5, 0.42);
    case 'star6': return starPoints(6, 0.5);
    case 'heart': return heartPoints();
    default: return pts([[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

function regularPolygon(n, offsetDeg) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + (offsetDeg * Math.PI / 180) - Math.PI / 2;
    pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return pts;
}

function starPoints(n, innerRatio) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return pts;
}

function heartPoints() {
  const pts = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = (Math.PI * 2 * i) / steps;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([x, y]);
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return pts.map(([x, y]) => [(x - minX) / (maxX - minX), (y - minY) / (maxY - minY)]);
}

function createShapeEl(shapeType, overrides) {
  const base = {
    id: uid(),
    type: shapeType,
    x: 300, y: 170, w: 300, h: 220,
    rotation: 0,
    zIndex: 1,
    fill: '#6c4ff2',
    stroke: '#4a2fd6',
    strokeWidth: 2,
  };
  if (LINE_SHAPES.has(shapeType)) {
    base.w = 360; base.h = 4;
    base.fill = 'transparent';
    base.stroke = '#1a1a1a';
    base.strokeWidth = 3;
  } else if (POLY_SHAPES.has(shapeType)) {
    base.type = 'poly';
    base.shapeKind = shapeType;
    if (shapeType === 'heart') base.fill = '#e5484d', base.stroke = '#b8272c';
  }
  return Object.assign(base, overrides || {});
}

// 位置・サイズ・色などは維持したまま、図形の種類だけを変更する
function changeShapeType(el, newShapeType) {
  if (LINE_SHAPES.has(newShapeType)) {
    el.type = newShapeType;
    delete el.shapeKind;
    delete el.cornerRadius;
  } else if (POLY_SHAPES.has(newShapeType)) {
    el.type = 'poly';
    el.shapeKind = newShapeType;
    delete el.cornerRadius;
  } else if (newShapeType === 'rect' || newShapeType === 'rounded-rect') {
    el.type = 'rect';
    el.cornerRadius = newShapeType === 'rounded-rect' ? 24 : 0;
    delete el.shapeKind;
  } else if (newShapeType === 'ellipse') {
    el.type = 'ellipse';
    delete el.shapeKind;
    delete el.cornerRadius;
  }
  if (el.fill === undefined) el.fill = '#6c4ff2';
  if (el.stroke === undefined) el.stroke = '#4a2fd6';
  if (el.strokeWidth === undefined) el.strokeWidth = 2;
}

function createImageEl(dataUrl, w, h, overrides) {
  const maxW = SLIDE_W * 0.6;
  const maxH = SLIDE_H * 0.6;
  let dw = w, dh = h;
  const scale = Math.min(maxW / dw, maxH / dh, 1);
  dw = Math.round(dw * scale);
  dh = Math.round(dh * scale);
  return Object.assign({
    id: uid(),
    type: 'image',
    x: Math.round((SLIDE_W - dw) / 2),
    y: Math.round((SLIDE_H - dh) / 2),
    w: dw, h: dh,
    rotation: 0,
    zIndex: 1,
    src: dataUrl,
  }, overrides || {});
}

// 図形の結合(統合・型抜き/合成・切り出し・重色合成・型抜き)の結果として生成される、
// マスク画像(シルエット)+塗りつぶし色で構成される再着色可能な図形
function createMergedEl(bbox, maskDataUrl, overrides) {
  return Object.assign({
    id: uid(),
    type: 'merge',
    x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h,
    rotation: 0,
    zIndex: 1,
    fill: '#6c4ff2',
    maskDataUrl,
  }, overrides || {});
}

// rawPoints: [[x,y], ...] in slide-absolute logical coordinates
function createDrawEl(rawPoints, overrides) {
  const xs = rawPoints.map(p => p[0]), ys = rawPoints.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 4;
  const x = minX - pad, y = minY - pad;
  const w = Math.max(maxX - minX + pad * 2, 1);
  const h = Math.max(maxY - minY + pad * 2, 1);
  const points = rawPoints.map(([px, py]) => [px - x, py - y]);
  return Object.assign({
    id: uid(),
    type: 'draw',
    x, y, w, h,
    rotation: 0,
    zIndex: 1,
    points,
    stroke: '#e5484d',
    strokeWidth: 3,
    opacity: 1,
  }, overrides || {});
}

function createSlide(overrides) {
  return Object.assign({
    id: uid(),
    background: { type: 'color', value: '#ffffff' },
    elements: [],
  }, overrides || {});
}

function createDeck() {
  return {
    id: uid(),
    title: '無題のプレゼンテーション',
    slides: [createSlide()],
  };
}

function nextZIndex(slide) {
  return slide.elements.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1;
}

function findSlide(deck, slideId) {
  return deck.slides.find(s => s.id === slideId) || null;
}

function findElement(slide, elId) {
  return slide ? (slide.elements.find(e => e.id === elId) || null) : null;
}

// ---- 永続化 (複数プレゼンテーションを保存できるライブラリ形式) ----

const LIBRARY_INDEX_KEY = 'presento.library.index';
const LIBRARY_DECK_PREFIX = 'presento.library.deck.';

function getLibraryIndex() {
  try {
    const raw = localStorage.getItem(LIBRARY_INDEX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function setLibraryIndex(list) {
  try { localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify(list)); } catch (e) { /* 保存容量オーバー等は無視 */ }
}

function saveDeck(deck) {
  try {
    if (!deck.id) deck.id = uid();
    localStorage.setItem(LIBRARY_DECK_PREFIX + deck.id, JSON.stringify(deck));
    const index = getLibraryIndex().filter(e => e.id !== deck.id);
    index.unshift({ id: deck.id, title: deck.title || '無題のプレゼンテーション', updatedAt: Date.now() });
    setLibraryIndex(index);
    localStorage.removeItem(STORAGE_KEY); // 旧バージョン(単一保存)の名残を掃除
    return true;
  } catch (e) {
    return false;
  }
}

function loadDeckById(id) {
  try {
    const raw = localStorage.getItem(LIBRARY_DECK_PREFIX + id);
    if (!raw) return null;
    const deck = JSON.parse(raw);
    if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) return null;
    if (!deck.id) deck.id = id;
    return deck;
  } catch (e) {
    return null;
  }
}

function deleteDeckFromLibrary(id) {
  try {
    localStorage.removeItem(LIBRARY_DECK_PREFIX + id);
    setLibraryIndex(getLibraryIndex().filter(e => e.id !== id));
  } catch (e) { /* ignore */ }
}

// 直近に更新されたプレゼンテーションを読み込む。ライブラリが空なら旧バージョン
// (単一デッキ保存)からの移行を試みる。
function loadDeck() {
  const index = getLibraryIndex().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const entry of index) {
    const d = loadDeckById(entry.id);
    if (d) return d;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const legacy = JSON.parse(raw);
      if (legacy && Array.isArray(legacy.slides) && legacy.slides.length) {
        if (!legacy.id) legacy.id = uid();
        return legacy;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ---- Undo/Redo 履歴管理 ----

function createHistory(initialDeck) {
  return {
    stack: [JSON.stringify(initialDeck)],
    index: 0,
  };
}

function historyPush(history, deck) {
  const snap = JSON.stringify(deck);
  if (history.stack[history.index] === snap) return;
  history.stack = history.stack.slice(0, history.index + 1);
  history.stack.push(snap);
  if (history.stack.length > 100) history.stack.shift();
  history.index = history.stack.length - 1;
}

function historyUndo(history) {
  if (history.index <= 0) return null;
  history.index -= 1;
  return JSON.parse(history.stack[history.index]);
}

function historyRedo(history) {
  if (history.index >= history.stack.length - 1) return null;
  history.index += 1;
  return JSON.parse(history.stack[history.index]);
}
