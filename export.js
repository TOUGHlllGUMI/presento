// 書き出し層: Canvas2D 描画結果を PNG / 自前生成 PDF としてダウンロードする。

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// deck をそのまま JSON.stringify すると、書き出し処理中に一時的に付与される
// _img/_maskImg (プリロード済み Image オブジェクト) が紛れ込むことがあるため、
// 保存前に取り除いたクリーンな複製を作る。
function sanitizeDeckForSave(deck) {
  const clone = JSON.parse(JSON.stringify(deck));
  clone.slides.forEach((slide) => {
    slide.elements.forEach((el) => {
      delete el._img;
      delete el._maskImg;
    });
    if (slide.background) delete slide.background.image;
  });
  return clone;
}

function safeFileName(name) {
  return (name || 'presento').replace(/[\\/:*?"<>|]/g, '_').trim() || 'presento';
}

function exportDeckAsFile(deck) {
  const clean = sanitizeDeckForSave(deck);
  const json = JSON.stringify(clean, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(deck.title)}.presento.json`);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function exportCurrentSlidePNG(deck, slide) {
  await preloadImages(slide);
  const canvas = document.getElementById('export-canvas');
  drawSlideToCanvas(canvas, slide, 1920, 1080);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const idx = deck.slides.findIndex(s => s.id === slide.id) + 1;
  downloadBlob(blob, `${deck.title || 'presento'}_slide${idx}.png`);
}

// ---- 最小限の自前 PDF ジェネレータ (画像埋め込みのみ対応) ----

function buildPdfFromJpegPages(pages) {
  const enc = new TextEncoder();
  const parts = [];
  let pos = 0;
  const offsets = [];

  function push(data) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(bytes);
    pos += bytes.length;
  }
  function beginObj(num) {
    offsets[num] = pos;
    push(`${num} 0 obj\n`);
  }

  const n = pages.length;
  const totalObjs = 2 + n * 3; // 1 catalog, 2 pages, then page/image/content per slide

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  beginObj(2);
  push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>\nendobj\n`);

  pages.forEach((p, i) => {
    const pageNum = 3 + i * 3;
    const imgNum = 4 + i * 3;
    const contentNum = 5 + i * 3;
    const w = p.w, h = p.h;

    beginObj(pageNum);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] `
      + `/Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`
    );

    beginObj(imgNum);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.pw} /Height ${p.ph} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
    );
    push(p.jpeg);
    push('\nendstream\nendobj\n');

    const stream = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    beginObj(contentNum);
    push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  const xrefStart = pos;
  push(`xref\n0 ${totalObjs + 1}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i <= totalObjs; i++) {
    push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  }
  push(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(parts, { type: 'application/pdf' });
}

async function saveElementAsImage(el) {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(el.w * scale));
  c.height = Math.max(1, Math.round(el.h * scale));
  const ctx = c.getContext('2d');
  if (el.type === 'image') {
    const img = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = el.src;
    });
    if (img) ctx.drawImage(img, 0, 0, c.width, c.height);
  } else {
    const flat = Object.assign({}, el, { x: 0, y: 0, rotation: 0 });
    drawElementToCanvas(ctx, flat, scale);
  }
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  downloadBlob(blob, `${el.type}_${el.id}.png`);
}

async function exportDeckPDF(deck) {
  const canvas = document.getElementById('export-canvas');
  const pw = 1920, ph = 1080;
  const pages = [];
  for (const slide of deck.slides) {
    await preloadImages(slide);
    drawSlideToCanvas(canvas, slide, pw, ph);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const jpeg = dataUrlToBytes(dataUrl);
    pages.push({ jpeg, pw, ph, w: 960, h: 540 });
  }
  const blob = buildPdfFromJpegPages(pages);
  downloadBlob(blob, `${deck.title || 'presento'}.pdf`);
}
