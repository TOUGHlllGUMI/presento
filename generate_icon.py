"""Presento アプリアイコン生成スクリプト。外部素材を使わず Pillow だけで描画する。"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ACCENT = (108, 79, 242, 255)      # #6c4ff2
ACCENT_DARK = (74, 47, 214, 255)  # #4a2fd6
ACCENT_LIGHT = (150, 122, 255, 255)
WHITE = (255, 255, 255, 255)
INK = (40, 30, 70, 255)
SUPERSAMPLE = 4


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_base(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # 背景の斜めグラデーション(左上→右下)。numpy でベクトル計算して高速化。
    xs, ys = np.meshgrid(np.arange(size), np.arange(size))
    t = (xs + ys) / (2.0 * size)
    grad_arr = (t * 255).astype(np.uint8)
    grad = Image.fromarray(grad_arr, mode='L')
    grad = grad.filter(ImageFilter.GaussianBlur(size * 0.02))

    bg = Image.new('RGBA', (size, size), ACCENT)
    bg_dark = Image.new('RGBA', (size, size), ACCENT_DARK)
    bg = Image.composite(bg_dark, bg, grad)
    return img, bg


def draw_icon(size, maskable=False):
    img, bg = make_base(size)
    mask = Image.new('L', (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    corner = size * (0.0 if maskable else 0.225)
    mdraw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner, fill=255)
    img = Image.composite(bg, img, mask)

    draw = ImageDraw.Draw(img)

    # セーフティマージン (maskable はより内側に寄せる)
    pad = size * (0.24 if maskable else 0.16)

    card_w = size - pad * 2
    card_h = card_w * 0.66
    card_x0 = pad
    card_y0 = (size - card_h) / 2 + size * 0.01
    card_x1 = card_x0 + card_w
    card_y1 = card_y0 + card_h

    # カードの影
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sr = size * 0.035
    sdraw.rounded_rectangle(
        [card_x0, card_y0 + size * 0.028, card_x1, card_y1 + size * 0.028],
        radius=sr, fill=(20, 10, 50, 110)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.02))
    img = Image.alpha_composite(img, shadow)
    draw = ImageDraw.Draw(img)

    # スライドカード本体 (少し傾ける)
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(card)
    cdraw.rounded_rectangle([card_x0, card_y0, card_x1, card_y1], radius=sr, fill=WHITE)

    # タイトルバー(アクセント色)
    bar_h = card_h * 0.24
    cdraw.rounded_rectangle(
        [card_x0, card_y0, card_x1, card_y0 + bar_h * 1.6],
        radius=sr, fill=ACCENT_LIGHT
    )
    cdraw.rectangle([card_x0, card_y0 + bar_h * 0.9, card_x1, card_y0 + bar_h * 1.6], fill=ACCENT_LIGHT)
    cdraw.rounded_rectangle([card_x0, card_y0, card_x1, card_y1], radius=sr, outline=None)
    # 上記だとタイトルバー下端が角丸を壊すので、白カードでもう一度クリップし直す
    clip = Image.new('L', (size, size), 0)
    cldraw = ImageDraw.Draw(clip)
    cldraw.rounded_rectangle([card_x0, card_y0, card_x1, card_y1], radius=sr, fill=255)
    card = Image.composite(card, Image.new('RGBA', (size, size), (0, 0, 0, 0)), clip)

    # 本文の線(テキストのダミー)
    cdraw2 = ImageDraw.Draw(card)
    line_y = card_y0 + card_h * 0.56
    line_h = card_h * 0.09
    gap = card_h * 0.14
    line_x0 = card_x0 + card_w * 0.09
    for i, wfrac in enumerate([0.55, 0.38]):
        y0 = line_y + i * gap
        cdraw2.rounded_rectangle(
            [line_x0, y0, line_x0 + card_w * wfrac, y0 + line_h],
            radius=line_h / 2, fill=(214, 206, 245, 255)
        )

    img = Image.alpha_composite(img, card)
    draw = ImageDraw.Draw(img)

    # 再生バッジ(右下)
    badge_r = size * 0.155
    bx = card_x1 - badge_r * 0.35
    by = card_y1 - badge_r * 0.15
    bshadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bsdraw = ImageDraw.Draw(bshadow)
    bsdraw.ellipse([bx - badge_r, by - badge_r + size * 0.02, bx + badge_r, by + badge_r + size * 0.02], fill=(20, 10, 50, 120))
    bshadow = bshadow.filter(ImageFilter.GaussianBlur(size * 0.015))
    img = Image.alpha_composite(img, bshadow)
    draw = ImageDraw.Draw(img)
    draw.ellipse([bx - badge_r, by - badge_r, bx + badge_r, by + badge_r], fill=WHITE)
    draw.ellipse([bx - badge_r + size * 0.012, by - badge_r + size * 0.012, bx + badge_r - size * 0.012, by + badge_r - size * 0.012], fill=ACCENT)
    tri = badge_r * 0.62
    cx0, cy0 = bx - tri * 0.42, by - tri * 0.58
    p1 = (cx0, cy0)
    p2 = (cx0, cy0 + tri * 1.16)
    p3 = (cx0 + tri * 1.05, cy0 + tri * 0.58)
    draw.polygon([p1, p2, p3], fill=WHITE)

    return img


def render(size, maskable=False, supersample=SUPERSAMPLE):
    big = draw_icon(size * supersample, maskable=maskable)
    return big.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(here, 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    icon512 = render(512, maskable=False)
    icon512.save(os.path.join(icons_dir, 'icon-512.png'))
    icon192 = render(192, maskable=False)
    icon192.save(os.path.join(icons_dir, 'icon-192.png'))
    maskable512 = render(512, maskable=True)
    maskable512.save(os.path.join(icons_dir, 'icon-maskable-512.png'))

    assets_dir = os.path.join(here, 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    render(1024, maskable=False, supersample=2).save(os.path.join(assets_dir, 'logo.png'))

    print('icons generated')
