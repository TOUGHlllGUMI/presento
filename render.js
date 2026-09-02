// 表示層: state.js のデータから DOM / Canvas2D への描画のみを行う。

function elStyleCommon(el) {
  const flipX = el.flipH ? -1 : 1;
  const flipY = el.flipV ? -1 : 1;
  return `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`
    + `transform:rotate(${el.rotation || 0}deg) scale(${flipX},${flipY});z-index:${el.zIndex};`;
}

function buildElementNode(el, editable) {
  const node = document.createElement('div');
  node.className = 'sl-el sl-el-' + el.type;
  node.dataset.id = el.id;
  node.style.cssText = elStyleCommon(el);

  if (el.type === 'text') {
    const inner = document.createElement('div');
    inner.className = 'sl-text-inner';
    inner.contentEditable = editable ? 'true' : 'false';
    inner.spellcheck = false;
    inner.style.cssText =
      `font-family:${el.fontFamily};font-size:${el.fontSize}px;color:${el.color};`
      + `font-weight:${el.bold ? '700' : '400'};font-style:${el.italic ? 'italic' : 'normal'};`
      + `text-decoration:${el.underline ? 'underline' : 'none'};text-align:${el.align};`
      + `background:${el.fill && el.fill !== 'transparent' ? el.fill : 'transparent'};`
      + (el.textStroke ? `-webkit-text-stroke:1px ${el.textStroke};` : '')
      + (el.textShadow ? `text-shadow:2px 3px 4px rgba(0,0,0,0.45);` : '');
    inner.textContent = el.text;
    node.appendChild(inner);
  } else if (el.type === 'rect') {
    node.style.background = el.fill;
    node.style.border = el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : 'none';
    node.style.borderRadius = (el.cornerRadius || 0) + 'px';
  } else if (el.type === 'ellipse') {
    node.style.background = el.fill;
    node.style.border = el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : 'none';
    node.style.borderRadius = '50%';
  } else if (el.type === 'line' || el.type === 'arrow' || el.type === 'double-arrow') {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${el.w} ${Math.max(el.h, 1)}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
    const midY = el.h / 2;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', 0); line.setAttribute('y1', midY);
    line.setAttribute('x2', el.w); line.setAttribute('y2', midY);
    line.setAttribute('stroke', el.stroke);
    line.setAttribute('stroke-width', el.strokeWidth);
    line.setAttribute('stroke-linecap', 'round');
    const needsEnd = el.type === 'arrow' || el.type === 'double-arrow';
    const needsStart = el.type === 'double-arrow';
    if (needsEnd || needsStart) {
      const defs = document.createElementNS(svgNS, 'defs');
      const mkMarker = (idSuffix, atStart) => {
        const marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', 'arrowhead-' + el.id + idSuffix);
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', atStart ? '3' : '7');
        marker.setAttribute('refY', '5');
        marker.setAttribute('orient', atStart ? 'auto-start-reverse' : 'auto');
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', 'M0,0 L10,5 L0,10 Z');
        path.setAttribute('fill', el.stroke);
        marker.appendChild(path);
        return marker;
      };
      if (needsEnd) defs.appendChild(mkMarker('-e', false));
      if (needsStart) defs.appendChild(mkMarker('-s', true));
      svg.appendChild(defs);
      if (needsEnd) line.setAttribute('marker-end', `url(#arrowhead-${el.id}-e)`);
      if (needsStart) line.setAttribute('marker-start', `url(#arrowhead-${el.id}-s)`);
    }
    svg.appendChild(line);
    node.appendChild(svg);
  } else if (el.type === 'poly') {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${el.w} ${el.h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
    const pts = polyPoints(el.shapeKind).map(([x, y]) => `${x * el.w},${y * el.h}`).join(' ');
    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', el.fill && el.fill !== 'transparent' ? el.fill : 'none');
    poly.setAttribute('stroke', el.strokeWidth > 0 ? el.stroke : 'none');
    poly.setAttribute('stroke-width', el.strokeWidth || 0);
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
    node.appendChild(svg);
  } else if (el.type === 'draw') {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${el.w} ${el.h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
    const pts = el.points.map(([x, y]) => `${x},${y}`).join(' ');
    const line = document.createElementNS(svgNS, 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', el.stroke);
    line.setAttribute('stroke-width', el.strokeWidth);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('opacity', el.opacity != null ? el.opacity : 1);
    svg.appendChild(line);
    node.appendChild(svg);
  } else if (el.type === 'image') {
    const img = document.createElement('img');
    img.src = el.src;
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;object-fit:fill;pointer-events:none;';
    node.appendChild(img);
  } else if (el.type === 'merge') {
    node.style.background = el.fill;
    const maskUrl = `url("${el.maskDataUrl}")`;
    node.style.webkitMaskImage = maskUrl;
    node.style.maskImage = maskUrl;
    node.style.webkitMaskSize = '100% 100%';
    node.style.maskSize = '100% 100%';
    node.style.webkitMaskRepeat = 'no-repeat';
    node.style.maskRepeat = 'no-repeat';
  }
  if (el.shadow) node.style.filter = 'drop-shadow(2px 4px 6px rgba(0,0,0,0.4))';
  return node;
}

function renderSlideSurface(container, slide, editable) {
  container.innerHTML = '';
  const bg = slide.background;
  container.style.background = bg.type === 'image' ? `url("${bg.value}") center/cover no-repeat` : bg.value;
  const sorted = slide.elements.slice().sort((a, b) => a.zIndex - b.zIndex);
  for (const el of sorted) {
    container.appendChild(buildElementNode(el, editable));
  }
}

function renderSlideList(deck, activeSlideId, listEl) {
  listEl.innerHTML = '';
  deck.slides.forEach((slide, i) => {
    const item = document.createElement('div');
    item.className = 'slide-thumb' + (slide.id === activeSlideId ? ' active' : '');
    item.dataset.slideId = slide.id;
    item.draggable = true;

    const num = document.createElement('div');
    num.className = 'thumb-num';
    num.textContent = i + 1;

    const frame = document.createElement('div');
    frame.className = 'thumb-frame';
    const inner = document.createElement('div');
    inner.className = 'thumb-inner';
    frame.appendChild(inner);
    renderSlideSurface(inner, slide, false);

    const dup = document.createElement('button');
    dup.className = 'thumb-dup';
    dup.title = '複製';
    dup.dataset.action = 'dup-slide';
    dup.dataset.slideId = slide.id;
    dup.innerHTML = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>';

    const del = document.createElement('button');
    del.className = 'thumb-del';
    del.title = '削除';
    del.dataset.action = 'delete-slide';
    del.dataset.slideId = slide.id;
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';

    item.appendChild(num);
    item.appendChild(frame);
    item.appendChild(dup);
    item.appendChild(del);
    listEl.appendChild(item);
  });
}

// ---- Canvas2D 描画 (書き出し用) ----

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para === '') { lines.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawElementToCanvas(ctx, el, scale) {
  ctx.save();
  const cx = (el.x + el.w / 2) * scale;
  const cy = (el.y + el.h / 2) * scale;
  ctx.translate(cx, cy);
  ctx.rotate((el.rotation || 0) * Math.PI / 180);
  ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
  ctx.translate(-el.w * scale / 2, -el.h * scale / 2);
  const w = el.w * scale, h = el.h * scale;
  if (el.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetX = 2 * scale;
    ctx.shadowOffsetY = 4 * scale;
  }

  if (el.type === 'rect' || el.type === 'ellipse') {
    ctx.beginPath();
    if (el.type === 'rect') {
      const r = Math.min((el.cornerRadius || 0) * scale, w / 2, h / 2);
      if (r > 0 && ctx.roundRect) ctx.roundRect(0, 0, w, h, r);
      else ctx.rect(0, 0, w, h);
    } else {
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    }
    if (el.fill && el.fill !== 'transparent') { ctx.fillStyle = el.fill; ctx.fill(); }
    if (el.strokeWidth > 0) { ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeWidth * scale; ctx.stroke(); }
  } else if (el.type === 'merge') {
    if (el._maskImg) {
      ctx.fillStyle = el.fill;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(el._maskImg, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  } else if (el.type === 'poly') {
    const pts = polyPoints(el.shapeKind).map(([x, y]) => [x * w, y * h]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
    if (el.fill && el.fill !== 'transparent') { ctx.fillStyle = el.fill; ctx.fill(); }
    if (el.strokeWidth > 0) { ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeWidth * scale; ctx.lineJoin = 'round'; ctx.stroke(); }
  } else if (el.type === 'draw') {
    ctx.globalAlpha = el.opacity != null ? el.opacity : 1;
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    el.points.forEach(([px, py], i) => {
      const sx = px * scale, sy = py * scale;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (el.type === 'line' || el.type === 'arrow' || el.type === 'double-arrow') {
    const midY = h / 2;
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth * scale;
    ctx.lineCap = 'round';
    const ah = 10 * scale;
    const startX = el.type === 'double-arrow' ? ah * 0.9 : 0;
    const endX = (el.type === 'arrow' || el.type === 'double-arrow') ? w - ah * 0.9 : w;
    ctx.beginPath();
    ctx.moveTo(startX, midY);
    ctx.lineTo(endX, midY);
    ctx.stroke();
    if (el.type === 'arrow' || el.type === 'double-arrow') {
      ctx.beginPath();
      ctx.moveTo(w, midY);
      ctx.lineTo(w - ah, midY - ah * 0.6);
      ctx.lineTo(w - ah, midY + ah * 0.6);
      ctx.closePath();
      ctx.fillStyle = el.stroke;
      ctx.fill();
    }
    if (el.type === 'double-arrow') {
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(ah, midY - ah * 0.6);
      ctx.lineTo(ah, midY + ah * 0.6);
      ctx.closePath();
      ctx.fillStyle = el.stroke;
      ctx.fill();
    }
  } else if (el.type === 'text') {
    if (el.fill && el.fill !== 'transparent') { ctx.fillStyle = el.fill; ctx.fillRect(0, 0, w, h); }
    const fontSize = el.fontSize * scale;
    ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700' : '400'} ${fontSize}px ${el.fontFamily}`;
    ctx.fillStyle = el.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left';
    const lines = wrapText(ctx, el.text || '', w);
    const lineHeight = fontSize * 1.3;
    const tx = el.align === 'center' ? w / 2 : el.align === 'right' ? w : 0;
    if (el.textShadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 4 * scale;
      ctx.shadowOffsetX = 2 * scale;
      ctx.shadowOffsetY = 3 * scale;
    }
    lines.forEach((line, i) => {
      ctx.fillText(line, tx, i * lineHeight);
      if (el.textStroke) {
        ctx.strokeStyle = el.textStroke;
        ctx.lineWidth = Math.max(1, scale);
        ctx.strokeText(line, tx, i * lineHeight);
      }
      if (el.underline) {
        const metrics = ctx.measureText(line);
        let lx = 0;
        if (el.align === 'center') lx = w / 2 - metrics.width / 2;
        else if (el.align === 'right') lx = w - metrics.width;
        ctx.beginPath();
        ctx.moveTo(lx, i * lineHeight + fontSize * 1.05);
        ctx.lineTo(lx + metrics.width, i * lineHeight + fontSize * 1.05);
        ctx.strokeStyle = el.color;
        ctx.lineWidth = Math.max(1, fontSize * 0.05);
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

function drawSlideToCanvas(canvas, slide, w, h) {
  const ctx = canvas.getContext('2d');
  canvas.width = w; canvas.height = h;
  const scale = w / SLIDE_W;
  ctx.clearRect(0, 0, w, h);
  const bg = slide.background;
  if (bg.type === 'image' && bg.image) {
    ctx.drawImage(bg.image, 0, 0, w, h);
  } else {
    ctx.fillStyle = bg.value || '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  const sorted = slide.elements.slice().sort((a, b) => a.zIndex - b.zIndex);
  for (const el of sorted) {
    if (el.type === 'image') {
      if (el._img) {
        ctx.save();
        const cx = (el.x + el.w / 2) * scale, cy = (el.y + el.h / 2) * scale;
        ctx.translate(cx, cy);
        ctx.rotate((el.rotation || 0) * Math.PI / 180);
        ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
        if (el.shadow) {
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = 8 * scale;
          ctx.shadowOffsetX = 2 * scale;
          ctx.shadowOffsetY = 4 * scale;
        }
        ctx.drawImage(el._img, -el.w * scale / 2, -el.h * scale / 2, el.w * scale, el.h * scale);
        ctx.restore();
      }
    } else {
      drawElementToCanvas(ctx, el, scale);
    }
  }
}

function preloadImages(slide) {
  const promises = [];
  for (const el of slide.elements) {
    if (el.type === 'image' && el.src) {
      promises.push(new Promise(resolve => {
        const img = new Image();
        img.onload = () => { el._img = img; resolve(); };
        img.onerror = () => resolve();
        img.src = el.src;
      }));
    }
    if (el.type === 'merge' && el.maskDataUrl) {
      promises.push(new Promise(resolve => {
        const img = new Image();
        img.onload = () => { el._maskImg = img; resolve(); };
        img.onerror = () => resolve();
        img.src = el.maskDataUrl;
      }));
    }
  }
  if (slide.background.type === 'image' && slide.background.value) {
    promises.push(new Promise(resolve => {
      const img = new Image();
      img.onload = () => { slide.background.image = img; resolve(); };
      img.onerror = () => resolve();
      img.src = slide.background.value;
    }));
  }
  return Promise.all(promises);
}
