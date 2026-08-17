"""
compose_util.py — Motor de composição v2
Suporta: bold inline, alinhamento esquerdo, film grain, vignette,
         gradiente longo, layout texto-pesado, 6 presets visuais.

Marcação de texto:
  **texto**  → negrito (Franklin Gothic Heavy)
  *texto*    → itálico (Franklin Gothic HeavyItalic)
  texto      → regular (Inter Regular)

Layouts:
  fullbleed   — imagem de fundo + gradiente + texto embaixo (centralizado)
  dramatico   — imagem de fundo + grain + gradiente longo + texto ESQUERDA grande
  etereo      — imagem quente + gradiente suave + texto ESQUERDA itálico
  text_only   — fundo escuro cósmico + texto ESQUERDA pesado (sem imagem real)
  card        — imagem no card superior + texto embaixo

Design Presets:
  manuscrito_sagrado      — dourado antigo, warm
  cinematografico         — azul elétrico, sci
  cinematografico_crimson — vermelho confronto
  esoterico_minimalista   — roxo violeta
  dramatico               — preto intenso, grain, ouro
  etereo_luminoso         — âmbar luminoso, suave
"""

import random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from io import BytesIO
from pathlib import Path

W, H        = 1080, 1350
MARGIN_C    = 92    # margem para texto centralizado
MARGIN_L    = 84    # margem esquerda para texto left-aligned
MARGIN_R    = 84    # margem direita
MAX_TW_C    = W - MARGIN_C * 2   # 920px centralizado
MAX_TW_L    = W - MARGIN_L - MARGIN_R  # 936px left

from core.util.fonts import get_fonts as _get_fonts
_FONTS   = _get_fonts()
F_HEAVY  = _FONTS["heavy"]
F_HEAVY_IT = _FONTS["heavy_it"]
F_BOLD   = _FONTS["bold"]
F_REGULAR = _FONTS["regular"]
F_MARK   = _FONTS["mark"]


# ── DESIGN PRESETS ────────────────────────────────────────────────────────────

PRESETS = {

    "manuscrito_sagrado": {
        "bg"              : (8,   6,   4,  255),
        "title_color"     : (255, 255, 255, 255),
        "body_color"      : (240, 232, 208, 255),
        "bold_color"      : (255, 255, 255, 255),
        "italic_color"    : (230, 215, 175, 255),
        "watermark_color" : (180, 150,  60, 200),
        "card_bg"         : (12,  10,   6,  255),
        "card_border"     : (201, 160,  53, 100),
        "gradient_tint"   : (30,  18,   2),
        "gradient_start"  : 0.36,
        "gradient_max"    : 238,
        "title_px"        : 76,
        "title_min_px"    : 36,
        "body_px"         : 40,
        "body_min_px"     : 30,
        "film_grain"      : False,
        "vignette"        : True,
    },

    "cinematografico": {
        "bg"              : (4,   4,   8,  255),
        "title_color"     : (255, 255, 255, 255),
        "body_color"      : (210, 225, 248, 255),
        "bold_color"      : (255, 255, 255, 255),
        "italic_color"    : (180, 210, 255, 255),
        "watermark_color" : (80, 130, 220, 160),
        "card_bg"         : (6,   6,  14,  255),
        "card_border"     : (26,  110, 255,  90),
        "gradient_tint"   : (2,   4,  22),
        "gradient_start"  : 0.38,
        "gradient_max"    : 240,
        "title_px"        : 76,
        "title_min_px"    : 36,
        "body_px"         : 40,
        "body_min_px"     : 30,
        "film_grain"      : False,
        "vignette"        : True,
    },

    "cinematografico_crimson": {
        "bg"              : (6,   2,   2,  255),
        "title_color"     : (255, 255, 255, 255),
        "body_color"      : (245, 220, 220, 255),
        "bold_color"      : (255, 255, 255, 255),
        "italic_color"    : (255, 190, 190, 255),
        "watermark_color" : (180,  60,  60, 180),
        "card_bg"         : (12,   4,   4,  255),
        "card_border"     : (139,   0,   0,  90),
        "gradient_tint"   : (28,   4,   4),
        "gradient_start"  : 0.62,  # preserva 62% da pintura intacta (era 0.42)
        "gradient_max"    : 220,   # menos opaco — arte respira (era 255)
        "title_px"        : 84,
        "title_min_px"    : 38,
        "body_px"         : 38,
        "body_min_px"     : 28,
        "film_grain"      : False,  # grain não combina com pintura (era True)
        "vignette"        : True,
    },

    "esoterico_minimalista": {
        "bg"              : (10,   8,  20,  255),
        "title_color"     : (255, 255, 255, 255),
        "body_color"      : (218, 200, 240, 255),
        "bold_color"      : (255, 255, 255, 255),
        "italic_color"    : (200, 170, 240, 255),
        "watermark_color" : (160, 110, 220, 180),
        "card_bg"         : (16,  10,  28,  255),
        "card_border"     : (140,  80, 220,  80),
        "gradient_tint"   : (8,    2,  18),   # tint mais escuro/frio
        "gradient_start"  : 0.30,             # começa mais cedo (era 0.38)
        "gradient_max"    : 252,              # mais opaco na base (era 238)
        "title_px"        : 72,
        "title_min_px"    : 34,
        "body_px"         : 38,
        "body_min_px"     : 29,
        "film_grain"      : False,
        "vignette"        : True,
    },

    # ── NOVA VARIAÇÃO 1 — DRAMÁTICO ───────────────────────────────────────────
    "criativo_papel": {
        "bg"              : (248, 246, 240, 255),
        "title_color"     : (24,   30,  56, 255),
        "body_color"      : (24,   30,  56, 255),
        "bold_color"      : (24,   30,  56, 255),
        "italic_color"    : (80,   85, 110, 255),
        "watermark_color" : (110, 115, 135, 230),
        "card_bg"         : (248, 246, 240, 255),
        "card_border"     : (190, 140,  70, 160),
        "accent_gold"     : (205, 145,  60, 255),
        "accent_teal"     : (24,  176, 172, 160),
        "title_px"        : 54,
        "title_min_px"    : 44,
        "body_px"         : 42,
        "body_min_px"     : 36,
        "is_light"        : True,
    },
    "dramatico": {
        "bg"              : (4,   2,   2,  255),
        "title_color"     : (255, 255, 255, 255),
        "body_color"      : (235, 228, 218, 255),
        "bold_color"      : (255, 248, 220, 255),
        "italic_color"    : (255, 235, 190, 255),
        "watermark_color" : (240,  91,   0, 200),
        "card_bg"         : (8,   4,   2,  255),
        "card_border"     : (180, 130,  40,  80),
        "gradient_tint"   : (18,   6,   2),
        "gradient_start"  : 0.38,
        "gradient_max"    : 248,
        "title_px"        : 84,
        "title_min_px"    : 42,
        "body_px"         : 40,
        "body_min_px"     : 28,
        "film_grain"      : True,
        "vignette"        : True,
    },

    # ── NOVA VARIAÇÃO 2 — ETÉREO LUMINOSO ────────────────────────────────────
    "etereo_luminoso": {
        "bg"              : (6,   4,   2,  255),
        "title_color"     : (255, 255, 255, 255),
        "body_color"      : (248, 240, 225, 255),
        "bold_color"      : (255, 255, 255, 255),
        "italic_color"    : (255, 245, 210, 255),
        "watermark_color" : (220, 190, 100, 160),
        "card_bg"         : (10,   6,   2,  255),
        "card_border"     : (200, 160,  60,  70),
        "gradient_tint"   : (24,  10,   2),
        "gradient_start"  : 0.40,
        "gradient_max"    : 235,
        "title_px"        : 76,
        "title_min_px"    : 38,
        "body_px"         : 40,
        "body_min_px"     : 28,
        "film_grain"      : False,
        "vignette"        : True,
    },
}

DEFAULT_PRESET = "manuscrito_sagrado"


def get_preset(name: str) -> dict:
    return PRESETS.get(name, PRESETS[DEFAULT_PRESET])


# ── FONT UTILITIES ────────────────────────────────────────────────────────────

def load_font(path, size):
    try:    return ImageFont.truetype(path, max(size, 10))
    except: return ImageFont.load_default()


# ── INLINE MARKUP PARSER ─────────────────────────────────────────────────────

def parse_markup(text: str):
    """
    Parseia **bold**, *italic* e texto normal.
    Retorna lista de (segment_text, style) onde style é 'bold'|'italic'|'normal'.
    """
    segments = []
    i = 0
    while i < len(text):
        if text[i:i+2] == "**":
            end = text.find("**", i + 2)
            if end != -1:
                segments.append((text[i+2:end], "bold"))
                i = end + 2
                continue
        if text[i] == "*" and (i == 0 or text[i-1] != "*"):
            end = text.find("*", i + 1)
            if end != -1 and text[end:end+2] != "**":
                segments.append((text[i+1:end], "italic"))
                i = end + 1
                continue
        # acumula texto normal
        j = i + 1
        while j < len(text):
            if text[j:j+2] == "**" or (text[j] == "*" and text[j:j+2] != "**"):
                break
            j += 1
        segments.append((text[i:j], "normal"))
        i = j
    return segments


def seg_font(style: str, size: int):
    if style == "bold":
        return load_font(F_HEAVY, size)
    if style == "italic":
        return load_font(F_HEAVY_IT, size)
    return load_font(F_REGULAR, size)


def measure_segment(draw, text, style, size):
    f  = seg_font(style, size)
    bb = draw.textbbox((0, 0), text, font=f)
    return bb[2] - bb[0], bb[3] - bb[1]


# ── WORD WRAP (com suporte a markup) ─────────────────────────────────────────

def wrap_markup_lines(draw, raw_line: str, size: int, max_w: int):
    """
    Recebe uma linha com markup (**bold**, *italic*), retorna lista de linhas
    onde cada linha é [(segment_text, style), ...] e cabe em max_w pixels.
    Evita orphans: se a última linha tiver só 1 palavra curta, puxa uma
    palavra da linha anterior para companhia.
    """
    segments = parse_markup(raw_line)

    # Expande em palavras preservando estilo
    words = []
    for seg_text, style in segments:
        for w in seg_text.split(" "):
            if w:
                words.append((w + " ", style))

    lines  = []
    cur_ln = []
    cur_w  = 0

    for word, style in words:
        ww, _ = measure_segment(draw, word, style, size)
        if cur_w + ww > max_w and cur_ln:
            lines.append(cur_ln)
            cur_ln = [(word, style)]
            cur_w  = ww
        else:
            cur_ln.append((word, style))
            cur_w += ww

    if cur_ln:
        lines.append(cur_ln)

    # Anti-orphan: se última linha tem só 1 segmento curto (<= 8 chars),
    # move a última palavra da linha anterior para ela
    if len(lines) >= 2:
        last = lines[-1]
        last_text = "".join(t for t, _ in last).strip()
        if len(last_text) <= 8 and len(lines[-2]) > 1:
            moved = lines[-2].pop()
            lines[-1] = [moved] + lines[-1]

    return lines


def line_px_height(draw, size: int) -> int:
    f  = load_font(F_REGULAR, size)
    bb = draw.textbbox((0, 0), "Ag", font=f)
    return bb[3] - bb[1]


# ── RENDER MARKUP BLOCK ───────────────────────────────────────────────────────

def render_markup_block(draw, raw_text: str, size: int, x0: int, y: float,
                        preset: dict, ls=1.55, align="left", max_w=None):
    """
    Renderiza bloco de texto com markup. Retorna y final.
    align: 'left' | 'center'
    """
    if max_w is None:
        max_w = MAX_TW_L if align == "left" else MAX_TW_C

    lh = line_px_height(draw, size) * ls

    for raw_line in raw_text.split("\n"):
        wrapped = wrap_markup_lines(draw, raw_line, size, max_w)
        if not wrapped:
            y += lh * 0.5
            continue
        for ln_segs in wrapped:
            # calcula largura total da linha para centralizar se necessário
            total_w = sum(measure_segment(draw, t, s, size)[0] for t, s in ln_segs)
            if align == "center":
                cx = (W - total_w) // 2
            else:
                cx = x0

            xc = cx
            for seg_text, style in ln_segs:
                col = (preset.get("bold_color")   if style == "bold"
                       else preset.get("italic_color") if style == "italic"
                       else preset.get("body_color"))
                f  = seg_font(style, size)
                # sombra leve
                draw.text((xc + 2, y + 2), seg_text, font=f, fill=(0, 0, 0, 120))
                draw.text((xc,     y),     seg_text, font=f, fill=col)
                sw, _ = measure_segment(draw, seg_text, style, size)
                xc += sw
            y += lh

    return y


# ── TÍTULO (sem markup, sempre pesado) ───────────────────────────────────────

def render_title(draw, title: str, size: int, x0: int, y: float,
                 color, ls=1.22, align="left", max_w=None):
    """Renderiza título em Franklin Gothic Heavy, auto-wrapping."""
    if max_w is None:
        max_w = MAX_TW_L if align == "left" else MAX_TW_C

    f  = load_font(F_HEAVY, size)
    lh = line_px_height(draw, size) * ls

    all_lines = []
    for raw_line in title.split("\n"):
        words = raw_line.split(" ")
        cur   = ""
        for w in words:
            test = (cur + " " + w).strip()
            bb   = draw.textbbox((0, 0), test, font=f)
            if (bb[2] - bb[0]) > max_w and cur:
                all_lines.append(cur)
                cur = w
            else:
                cur = test
        if cur:
            all_lines.append(cur)

    for ln in all_lines:
        bb = draw.textbbox((0, 0), ln, font=f)
        lw = bb[2] - bb[0]
        if align == "center":
            x = (W - lw) // 2
        else:
            x = x0
        draw.text((x + 2, y + 2), ln, font=f, fill=(0, 0, 0, 150))
        draw.text((x,     y),     ln, font=f, fill=color)
        y += lh

    return y


def fit_title_size(draw, title: str, start_px: int, min_px: int,
                   align="left", max_w=None):
    """Reduz fonte se alguma palavra individual ultrapassar MAX_TW, permitindo auto-wrap em 2+ linhas."""
    if max_w is None:
        max_w = MAX_TW_L if align == "left" else MAX_TW_C
    for sz in range(start_px, min_px - 1, -2):
        f = load_font(F_HEAVY, sz)
        too_wide = False
        for word in title.split():
            bb = draw.textbbox((0, 0), word, font=f)
            if (bb[2] - bb[0]) > max_w:
                too_wide = True
                break
        if not too_wide:
            return sz
    return min_px


# ── GRADIENTE ─────────────────────────────────────────────────────────────────

def dark_gradient(img, preset: dict):
    ov     = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d      = ImageDraw.Draw(ov)
    _, h   = img.size
    start  = preset.get("gradient_start", 0.38)
    amax   = preset.get("gradient_max",   240)
    tint   = preset.get("gradient_tint",  (0, 0, 0))
    sy     = int(h * start)

    for y in range(sy, h):
        p = (y - sy) / (h - sy)
        a = int(amax * p ** 0.55)
        r = min(tint[0] + int((1 - p) * 8), 32)
        g = min(tint[1] + int((1 - p) * 8), 24)
        b = min(tint[2] + int((1 - p) * 8), 38)
        d.line([(0, y), (W, y)], fill=(r, g, b, a))

    return Image.alpha_composite(img.convert("RGBA"), ov)


# ── VIGNETTE ──────────────────────────────────────────────────────────────────

def add_vignette(img, strength=0.40):
    """
    Desativado. Retorna imagem intacta sem borrões escuros nas bordas.
    """
    return img


# ── EDGE BLACKOUT ─────────────────────────────────────────────────────────────

def fill_edges_black(img, side_width=320, top_width=104):
    """
    Desativado. Função legada usada para remover bordas brancas do Gemini.
    Retorna a imagem intacta (sem as grandes manchas pretas nas laterais).
    """
    return img


# ── FILM GRAIN ────────────────────────────────────────────────────────────────

def add_film_grain(img, intensity=18):
    """Adiciona ruído cinematográfico analógico."""
    arr    = np.array(img.convert("RGBA"), dtype=np.int16)
    noise  = np.random.randint(-intensity, intensity + 1,
                               arr.shape[:2], dtype=np.int16)
    for c in range(3):
        arr[:, :, c] = np.clip(arr[:, :, c] + noise, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


# ── WATERMARKS ────────────────────────────────────────────────────────────────

def _watermarks(draw, color, pos="top_left", x=None, y=None, text=None):
    if pos == "hidden":
        return

    mark = text.strip() if text is not None and str(text).strip() != "" else None
    if not mark:
        mark = "@HAUCACAU"
        try:
            branding_path = Path(__file__).parent.parent.parent / "dashboard" / "data" / "branding.json"
            if branding_path.exists():
                import json
                with open(branding_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    mark = data.get("logoText", "@HAUCACAU")
        except Exception:
            pass

    fm   = load_font(F_MARK, 28)
    
    # Coordenadas padrão baseadas na posição
    default_x = MARGIN_L
    default_y = 48
    
    if pos == "top_right":
        default_x = W - MARGIN_R - 180
        default_y = 48
    elif pos == "bottom_left":
        default_x = MARGIN_L
        default_y = H - 80
    elif pos == "bottom_right":
        default_x = W - MARGIN_R - 180
        default_y = H - 80
        
    final_x = int(x) if x is not None and str(x).strip() != "" else default_x
    final_y = int(y) if y is not None and str(y).strip() != "" else default_y
    draw.text((final_x, final_y), mark, font=fm, fill=color)


# ── DARK COSMIC BG (para text_only) ──────────────────────────────────────────

def make_cosmic_bg(preset: dict, img_bytes=None):
    """
    Cria fundo escuro para layout text_only.
    Se img_bytes fornecido, usa como textura muito escurecida.
    """
    bg_color = preset.get("bg", (6, 4, 10, 255))
    base = Image.new("RGBA", (W, H), bg_color)

    if img_bytes:
        try:
            tex = Image.open(BytesIO(img_bytes)).convert("RGBA").resize((W, H), Image.LANCZOS)
            # blend muito escuro — imagem é só textura
            dark = Image.new("RGBA", (W, H), (0, 0, 0, 195))
            tex  = Image.alpha_composite(tex, dark)
            base = Image.alpha_composite(base, tex)
        except:
            pass

    # ruído sutil de textura
    arr   = np.array(base, dtype=np.int16)
    noise = np.random.randint(-6, 7, arr.shape[:2], dtype=np.int16)
    for c in range(3):
        arr[:, :, c] = np.clip(arr[:, :, c] + noise, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


# ── LAYOUTS ───────────────────────────────────────────────────────────────────

def compose_fullbleed(img_bytes, title, body, preset: dict, title_y=None, body_y=None, watermark_pos="top_left", watermark_x=None, watermark_y=None, watermark_text=None):
    """Layout fullbleed: imagem full + gradiente + texto LEFT embaixo + linha de acento Laranja HauCacau."""
    p   = preset
    bg  = Image.open(BytesIO(img_bytes)).convert("RGBA").resize((W, H), Image.LANCZOS)
    bg  = fill_edges_black(bg)
    bg  = dark_gradient(bg, p)
    if p.get("vignette"):
        bg = add_vignette(bg)
    if p.get("film_grain"):
        bg = add_film_grain(bg)

    draw = ImageDraw.Draw(bg)
    _watermarks(draw, p["watermark_color"], pos=watermark_pos, x=watermark_x, y=watermark_y, text=watermark_text)

    t_start = max(p["title_px"], 84)
    t_min   = p["title_min_px"]
    b_sz    = p["body_px"]
    gap     = 22

    t_sz = fit_title_size(draw, title, t_start, t_min, align="left")

    def calc_heights(ts, bs):
        lht = line_px_height(draw, ts) * 1.12
        lhb = line_px_height(draw, bs) * 1.55
        nt  = sum(len(wrap_markup_lines(draw, ln, ts, MAX_TW_L)) or 1
                  for ln in title.split("\n"))
        nb  = sum(len(wrap_markup_lines(draw, ln, bs, MAX_TW_L)) or 1
                  for ln in body.split("\n"))
        return int(nt * lht), int(nb * lhb)

    th, bh = calc_heights(t_sz, b_sz)

    BOTTOM_PAD  = 72
    Y_MIN       = int(H * 0.58)
    custom_y    = int(title_y) if (title_y is not None and str(title_y).strip() != "") else None
    effective_y_min = custom_y if (custom_y is not None and custom_y < Y_MIN) else Y_MIN
    MAX_TEXT_H  = H - effective_y_min - BOTTOM_PAD

    while (th + bh + gap) > MAX_TEXT_H and b_sz > p["body_min_px"]:
        b_sz -= 1
        _, bh = calc_heights(t_sz, b_sz)
    while (th + bh + gap) > MAX_TEXT_H and t_sz > t_min:
        t_sz -= 2
        th, bh = calc_heights(t_sz, b_sz)

    if title_y is not None and str(title_y).strip() != "":
        y = int(title_y)
    else:
        y_raw = H - th - bh - gap - BOTTOM_PAD
        y     = max(y_raw, Y_MIN)

    rendered_title_y_end = render_title(draw, title, t_sz, MARGIN_L, y, p["title_color"],
                                        ls=1.12, align="left")
    
    # Linha de acento Laranja HauCacau (#F05B00)
    accent_y = rendered_title_y_end + 12
    draw.rectangle([MARGIN_L, accent_y, MARGIN_L + 120, accent_y + 5], fill=(240, 91, 0, 255))

    final_body_y = int(body_y) if body_y is not None and str(body_y).strip() != "" else (accent_y + 22)
    render_markup_block(draw, body, b_sz, MARGIN_L, final_body_y, p,
                        ls=1.55, align="left")
    return bg.convert("RGB")


def compose_dramatico(img_bytes, title, body, preset: dict, title_y=None, body_y=None, watermark_pos="top_left", watermark_x=None, watermark_y=None, watermark_text=None):
    """
    Variação 1 — DRAMÁTICO (Estilo HauCacau Oficial)
    Imagem full + grain + gradiente extra-longo + texto ESQUERDA + linha Laranja HauCacau.
    """
    p   = preset
    bg  = Image.open(BytesIO(img_bytes)).convert("RGBA").resize((W, H), Image.LANCZOS)
    bg  = fill_edges_black(bg)
    bg  = dark_gradient(bg, p)
    if p.get("vignette"):
        bg = add_vignette(bg, strength=0.30)
    if p.get("film_grain"):
        bg = add_film_grain(bg, intensity=16)

    draw = ImageDraw.Draw(bg)
    _watermarks(draw, p["watermark_color"], pos=watermark_pos, x=watermark_x, y=watermark_y, text=watermark_text)

    t_sz = fit_title_size(draw, title, max(p["title_px"], 84), p["title_min_px"], align="left")
    b_sz = p["body_px"]
    gap  = 26

    def calc_heights_d(ts, bs):
        lht = line_px_height(draw, ts) * 1.12
        lhb = line_px_height(draw, bs) * 1.55
        nt  = sum(len(wrap_markup_lines(draw, ln, ts, MAX_TW_L)) or 1
                  for ln in title.split("\n"))
        nb  = sum(len(wrap_markup_lines(draw, ln, bs, MAX_TW_L)) or 1
                  for ln in body.split("\n"))
        return int(nt * lht), int(nb * lhb)

    th, bh = calc_heights_d(t_sz, b_sz)

    BOTTOM_PAD  = 72
    Y_MIN       = int(H * 0.58)
    custom_y    = int(title_y) if (title_y is not None and str(title_y).strip() != "") else None
    effective_y_min = custom_y if (custom_y is not None and custom_y < Y_MIN) else Y_MIN
    MAX_TEXT_H  = H - effective_y_min - BOTTOM_PAD

    while (th + bh + gap) > MAX_TEXT_H and b_sz > p["body_min_px"]:
        b_sz -= 1
        _, bh = calc_heights_d(t_sz, b_sz)
    while (th + bh + gap) > MAX_TEXT_H and t_sz > p["title_min_px"]:
        t_sz -= 2
        th, bh = calc_heights_d(t_sz, b_sz)

    if title_y is not None and str(title_y).strip() != "":
        y = int(title_y)
    else:
        y_raw = H - th - bh - gap - BOTTOM_PAD
        y     = max(y_raw, Y_MIN)

    rendered_title_y_end = render_title(draw, title, t_sz, MARGIN_L, y, p["title_color"],
                                        ls=1.12, align="left")
    
    # Linha de acento Laranja HauCacau (#F05B00)
    accent_y = rendered_title_y_end + 12
    draw.rectangle([MARGIN_L, accent_y, MARGIN_L + 120, accent_y + 5], fill=(240, 91, 0, 255))

    final_body_y = int(body_y) if body_y is not None and str(body_y).strip() != "" else (accent_y + 22)
    render_markup_block(draw, body, b_sz, MARGIN_L, final_body_y, p,
                        ls=1.55, align="left")
    return bg.convert("RGB")


def compose_etereo(img_bytes, title, body, preset: dict, title_y=None, body_y=None, watermark_pos="top_left", watermark_x=None, watermark_y=None, watermark_text=None):
    """
    Variação 2 — ETÉREO LUMINOSO
    Imagem quente + gradiente muito suave + texto ESQUERDA + itálico no body.
    Para ESPÍRITO, MENTE.
    """
    p   = preset
    bg  = Image.open(BytesIO(img_bytes)).convert("RGBA").resize((W, H), Image.LANCZOS)
    bg  = fill_edges_black(bg)           # elimina bordas brancas da API
    bg  = dark_gradient(bg, p)
    if p.get("vignette"):
        bg = add_vignette(bg, strength=0.45)

    draw = ImageDraw.Draw(bg)
    _watermarks(draw, p["watermark_color"], pos=watermark_pos, x=watermark_x, y=watermark_y, text=watermark_text)

    t_sz = fit_title_size(draw, title, p["title_px"], p["title_min_px"], align="left")
    b_sz = p["body_px"]

    lh_t  = line_px_height(draw, t_sz) * 1.20
    lh_b  = line_px_height(draw, b_sz) * 1.60
    n_t   = sum(len(wrap_markup_lines(draw, ln, t_sz, MAX_TW_L)) or 1
                for ln in title.split("\n"))
    n_b   = sum(len(wrap_markup_lines(draw, ln, b_sz, MAX_TW_L)) or 1
                for ln in body.split("\n"))
    th    = int(n_t * lh_t)
    bh    = int(n_b * lh_b)
    gap   = 28
    if title_y is not None and str(title_y).strip() != "":
        y = int(title_y)
    else:
        y = H - th - bh - gap - 90

    rendered_title_y_end = render_title(draw, title, t_sz, MARGIN_L, y, p["title_color"],
                                        ls=1.20, align="left")
    final_body_y = int(body_y) if body_y is not None and str(body_y).strip() != "" else max(1030, rendered_title_y_end + gap)
    render_markup_block(draw, body, b_sz, MARGIN_L, final_body_y, p,
                        ls=1.60, align="left")
    return bg.convert("RGB")


def compose_text_only(img_bytes, title, body, preset: dict, title_y=None, body_y=None, watermark_pos="top_left", watermark_x=None, watermark_y=None, watermark_text=None):
    """
    Layout TEXTO PESADO — quando há muito texto, sem imagem real.
    Fundo escuro cósmico (img_bytes vira textura suave se fornecido).
    Texto ocupa TODA a altura com padding generoso. Left-aligned.
    Usa parágrafos com espaçamento entre blocos.
    """
    p    = preset
    bg   = make_cosmic_bg(p, img_bytes)
    if p.get("vignette"):
        bg = add_vignette(bg, strength=0.35)

    draw = ImageDraw.Draw(bg)
    _watermarks(draw, p["watermark_color"], pos=watermark_pos, x=watermark_x, y=watermark_y, text=watermark_text)

    # Barra vermelha vertical à esquerda (detalhe de design da referência)
    bar_x = MARGIN_L
    bar_y1 = int(H * 0.30)
    bar_y2 = bar_y1 + 56
    draw.rectangle([bar_x, bar_y1, bar_x + 4, bar_y2], fill=(180, 40, 40, 230))

    # No text_only o título é grande (herói visual)
    t_sz  = min(p["title_px"] + 6, 88)
    t_min = p["title_min_px"]
    b_sz  = p["body_px"]
    b_min = p["body_min_px"]

    t_sz = fit_title_size(draw, title, t_sz, t_min, align="left")

    PAD_TOP   = int(title_y) if title_y is not None and str(title_y).strip() != "" else int(H * 0.34)
    PAD_BOT   = 80
    avail_h   = H - PAD_TOP - PAD_BOT
    x0        = MARGIN_L
    y         = float(PAD_TOP)

    # Título
    if title.strip():
        y = render_title(draw, title, t_sz, x0, y, p["title_color"],
                         ls=1.18, align="left")
        y += line_px_height(draw, t_sz) * 0.9   # espaço após título

    if body_y is not None and str(body_y).strip() != "":
        y = float(body_y)

    # Body: cada \n\n vira parágrafo com espaço extra
    paragraphs = body.split("\n\n")
    for i, para in enumerate(paragraphs):
        para = para.strip()
        if not para:
            continue
        y = render_markup_block(draw, para, b_sz, x0, y, p,
                                ls=1.60, align="left")
        # espaço entre parágrafos
        if i < len(paragraphs) - 1:
            y += line_px_height(draw, b_sz) * 0.85

    return bg.convert("RGB")


def compose_card(img_bytes, title, body, preset: dict, title_y=None, body_y=None, watermark_pos="top_left", watermark_x=None, watermark_y=None, watermark_text=None):
    """Layout card: imagem arredondada no topo + texto embaixo."""
    p      = preset
    canvas = Image.new("RGBA", (W, H), p["card_bg"])
    if p.get("vignette"):
        canvas = add_vignette(canvas, strength=0.25)

    draw = ImageDraw.Draw(canvas)
    _watermarks(draw, p["watermark_color"], pos=watermark_pos, x=watermark_x, y=watermark_y, text=watermark_text)

    cw, ch, cx, cy = 940, 556, (W - 940) // 2, 126
    card = Image.open(BytesIO(img_bytes)).convert("RGBA").resize((cw, ch), Image.LANCZOS)
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw, ch], radius=16, fill=255)
    card.putalpha(mask)
    draw.rounded_rectangle([cx-2, cy-2, cx+cw+2, cy+ch+2],
                           radius=18, outline=p["card_border"], width=2)
    canvas.paste(card, (cx, cy), card)

    ty   = cy + ch + 36
    custom_y = int(title_y) if (title_y is not None and str(title_y).strip() != "") else None
    avail = H - (custom_y if custom_y is not None else ty) - 52
    t_sz  = fit_title_size(draw, title, p["title_px"], p["title_min_px"], align="center")
    b_sz  = p["body_px"]

    lh_t  = line_px_height(draw, t_sz) * 1.18
    lh_b  = line_px_height(draw, b_sz) * 1.55
    n_t   = sum(len(wrap_markup_lines(draw, ln, t_sz, MAX_TW_L)) or 1
                for ln in title.split("\n"))
    n_b   = sum(len(wrap_markup_lines(draw, ln, b_sz, MAX_TW_L)) or 1
                for ln in body.split("\n"))
    th    = int(n_t * lh_t)
    bh    = int(n_b * lh_b)
    gap   = 20

    # auto-reduz se não cabe
    while th + gap + bh > avail and b_sz > p["body_min_px"]:
        b_sz -= 1
        lh_b  = line_px_height(draw, b_sz) * 1.55
        bh    = int(n_b * lh_b)

    y = float(title_y) if title_y is not None and str(title_y).strip() != "" else float(ty)
    rendered_title_y_end = render_title(draw, title, t_sz, MARGIN_L, y, p["title_color"],
                                        ls=1.18, align="center")
    final_body_y = int(body_y) if body_y is not None and str(body_y).strip() != "" else (rendered_title_y_end + gap)
    render_markup_block(draw, body, b_sz, MARGIN_L, final_body_y, p,
                        ls=1.55, align="center")
    return canvas.convert("RGB")


def make_coldpressed_paper_canvas():
    base = np.full((H, W, 3), [248, 245, 238], dtype=np.float32)
    np.random.seed(42)
    fine_grain = np.random.normal(0, 4.0, (H, W, 3))
    fiber_mask = (np.random.rand(H, W, 1) > 0.992) * np.random.uniform(8.0, 18.0, (H, W, 1))
    y_coords = np.arange(H).reshape(H, 1, 1)
    page_lines = (np.sin(y_coords * 0.14) > 0.6) * np.random.uniform(1.2, 3.5, (H, W, 1))
    paper = np.clip(base - fiber_mask - page_lines + fine_grain, 0, 255).astype(np.uint8)
    img = Image.fromarray(paper, "RGB")
    
    vignette = Image.new("L", (W, H), 0)
    v_draw = ImageDraw.Draw(vignette)
    v_draw.rectangle([0, 0, W, H], fill=255)
    v_draw.rectangle([80, 80, W - 80, H - 80], fill=0)
    vignette = vignette.filter(ImageFilter.GaussianBlur(radius=90))
    tint = Image.new("RGB", (W, H), (232, 225, 212))
    return Image.composite(tint, img, vignette)

def draw_seed_of_life_geom(draw, cx, cy, r=120, color=(195, 145, 75, 140)):
    import math
    for angle in range(0, 360, 60):
        rad = math.radians(angle)
        ox = cx + r * math.cos(rad)
        oy = cy + r * math.sin(rad)
        draw.ellipse([ox - r, oy - r, ox + r, oy + r], outline=color, width=2)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=2)

def draw_cacao_sacred_symbol(draw, cx, cy, size=160):
    import math
    color = (24, 30, 56, 170)
    gold = (205, 145, 60, 180)
    p1 = (cx, cy - size)
    p2 = (cx + size * 0.866, cy + size * 0.5)
    p3 = (cx - size * 0.866, cy + size * 0.5)
    draw.polygon([p1, p2, p3], outline=gold, width=2)
    p4 = (cx, cy + size)
    p5 = (cx + size * 0.866, cy - size * 0.5)
    p6 = (cx - size * 0.866, cy - size * 0.5)
    draw.polygon([p4, p5, p6], outline=gold, width=2)
    draw.ellipse([cx - 40, cy - 65, cx + 40, cy + 65], outline=color, width=2)
    draw.ellipse([cx - 22, cy - 65, cx + 22, cy + 65], outline=color, width=1)
    draw.line([(cx, cy - 65), (cx, cy + 65)], fill=color, width=1)

def wrap_words_bound(draw, text, font, max_w=840):
    words = text.split(" ")
    lines, curr = [], []
    for w in words:
        test = " ".join(curr + [w])
        bbox = draw.textbbox((0, 0), test, font=font)
        if (bbox[2] - bbox[0]) <= max_w:
            curr.append(w)
        else:
            if curr: lines.append(" ".join(curr))
            curr = [w]
    if curr: lines.append(" ".join(curr))
    return lines

def compose_editorial_paper(img_bytes, title, body, preset: dict, title_y=None, body_y=None, watermark_pos="top_left", watermark_x=None, watermark_y=None, watermark_text=None, slide_idx=1):
    """
    MOTOR OFICIAL: EDITORIAL MÍSTICO EM PAPEL (HauCacau Criativo Fora da Caixa)
    - S1: Recorte da Deusa Mística + Círculo Celestial Sagrado + Selo Biologia Sagrada + Título em Caixa Baixa com Grifo Ouro/Teal.
    - S2 / S5: Texto Puro Editorial Centralizado com Espaçamento Dinâmico Perfeito.
    - S3: Gravura Ancestral de Cacau + Merkabah em Nanquim Dourado.
    - S4 / S7: Portal Fine Art Flutuante com Sombra Suave.
    """
    bg = make_coldpressed_paper_canvas()
    draw = ImageDraw.Draw(bg, "RGBA")
    
    font_title = ImageFont.truetype(F_BOLD, 54)
    font_body = ImageFont.truetype(F_BOLD, 48)
    font_body_reg = ImageFont.truetype(F_REGULAR, 40)
    font_eyebrow = ImageFont.truetype(F_BOLD, 20)
    font_sub = ImageFont.truetype(F_REGULAR, 18)
    font_badge = ImageFont.truetype(F_BOLD, 15)
    
    DEEP_INDIGO = (24, 30, 56, 255)
    HAU_GOLD = (205, 145, 60, 255)
    HAU_GOLD_MUTED = (190, 140, 70, 160)
    TEAL_MIST = (24, 176, 172, 160)
    
    # ── SLIDE 1 (HOOK: COLAGEM MÍSTICA & DEUSA SAGRADA) ──────────────────────
    if slide_idx == 1:
        # Header Left
        draw.text((96, 76), "HAUCACAU", font=font_eyebrow, fill=(110, 115, 135, 240))
        draw.line([(96, 108), (210, 108)], fill=HAU_GOLD_MUTED, width=2)
        
        # Title (Left-aligned, Lowercase, with Double Underline)
        clean_title = title.lower() if title else "e se o seu cansaço não for falta de esforço..."
        lines = wrap_words_bound(draw, clean_title, font_title, max_w=760)
        cur_y = 150
        for line in lines:
            draw.text((96, cur_y), line, font=font_title, fill=DEEP_INDIGO)
            cur_y += 68
            
        # Double Underline under the last line of title
        if lines:
            last_line = lines[-1]
            l_bbox = draw.textbbox((96, cur_y - 68), last_line, font=font_title)
            lw = l_bbox[2] - l_bbox[0]
            uy = cur_y - 4
            draw.rectangle([96, uy, 96 + lw, uy + 3], fill=HAU_GOLD)
            draw.rectangle([96, uy + 6, 96 + (lw * 0.45), uy + 8], fill=TEAL_MIST)
            
        # Sacred Celestial Ring & Badge (Right side, lower down so NO collision)
        ring_cx, ring_cy = 840, 590
        draw_seed_of_life_geom(draw, ring_cx, ring_cy, r=115, color=(205, 155, 75, 120))
        
        # Badge "BIOLOGIA SAGRADA"
        badge_text = "BIOLOGIA SAGRADA"
        b_bbox = draw.textbbox((0, 0), badge_text, font=font_badge)
        bw = b_bbox[2] - b_bbox[0]
        bx = ring_cx - (bw // 2) - 14
        by = ring_cy - 150
        draw.rounded_rectangle([bx, by, bx + bw + 28, by + 32], radius=16, outline=HAU_GOLD_MUTED, width=1)
        draw.text((bx + 14, by + 7), badge_text, font=font_badge, fill=DEEP_INDIGO)
        
        # Woman Cutout / Foreground Silhouette
        if img_bytes:
            try:
                raw = Image.open(BytesIO(img_bytes)).convert("RGBA")
                arr = np.array(raw).astype(np.float32)
                # Soft luminance transparency against bright background
                lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
                alpha = np.clip((250 - lum) * 3.5, 0, 255).astype(np.uint8)
                raw.putalpha(Image.fromarray(alpha, "L"))
                
                # Resize and paste in bottom left
                target_w = 780
                target_h = int(raw.size[1] * (target_w / raw.size[0]))
                raw_scaled = raw.resize((target_w, target_h), Image.LANCZOS)
                
                bg.paste(raw_scaled, (60, H - target_h + 30), raw_scaled)
            except Exception:
                pass
                
        # Footer
        draw.text((820, 1250), "@HAUCACAU", font=font_eyebrow, fill=DEEP_INDIGO)
        draw.text((820, 1278), "ESTADO DE PRESENÇA", font=font_sub, fill=(140, 145, 165, 230))
        return bg.convert("RGB")

    # ── SLIDE 2 / TEXT ONLY (TEXTO PURO EDITORIAL CENTRALIZADO) ──────────────
    if not img_bytes or slide_idx in [2, 5, 8]:
        # Header Center
        h_text = "HAUCACAU"
        h_bbox = draw.textbbox((0, 0), h_text, font=font_eyebrow)
        hw = h_bbox[2] - h_bbox[0]
        hx = (W - hw) // 2
        draw.text((hx, 90), h_text, font=font_eyebrow, fill=(110, 115, 135, 240))
        draw.line([(hx - 10, 122), (hx + hw + 10, 122)], fill=HAU_GOLD_MUTED, width=2)
        
        cur_y = 240
        # Title paragraph
        if title:
            lines = wrap_words_bound(draw, title.lower(), font_body, max_w=840)
            for l in lines:
                l_bbox = draw.textbbox((0, 0), l, font=font_body)
                lw = l_bbox[2] - l_bbox[0]
                draw.text(((W - lw) // 2, cur_y), l, font=font_body, fill=DEEP_INDIGO)
                cur_y += 66
            cur_y += 48
            
        # Body paragraph (with generous gap so NEVER overlaps)
        if body:
            lines = wrap_words_bound(draw, body.lower(), font_body_reg, max_w=840)
            for l in lines:
                l_bbox = draw.textbbox((0, 0), l, font=font_body_reg)
                lw = l_bbox[2] - l_bbox[0]
                draw.text(((W - lw) // 2, cur_y), l, font=font_body_reg, fill=(70, 75, 95, 255))
                cur_y += 58
                
        # Footer
        draw.text(((W - 140) // 2, 1220), "@HAUCACAU", font=font_eyebrow, fill=DEEP_INDIGO)
        draw.text(((W - 200) // 2, 1248), "ESTADO DE PRESENÇA", font=font_sub, fill=(140, 145, 165, 230))
        return bg.convert("RGB")

    # ── SLIDE 3 (GRAVURA BOTÂNICA / GEOMETRIA SAGRADA) ───────────────────────
    if slide_idx == 3:
        h_text = "HAUCACAU"
        h_bbox = draw.textbbox((0, 0), h_text, font=font_eyebrow)
        hw = h_bbox[2] - h_bbox[0]
        hx = (W - hw) // 2
        draw.text((hx, 90), h_text, font=font_eyebrow, fill=(110, 115, 135, 240))
        draw.line([(hx - 10, 122), (hx + hw + 10, 122)], fill=HAU_GOLD_MUTED, width=2)
        
        cur_y = 170
        if title:
            for l in wrap_words_bound(draw, title.lower(), font_title, max_w=840):
                l_bbox = draw.textbbox((0, 0), l, font=font_title)
                lw = l_bbox[2] - l_bbox[0]
                draw.text(((W - lw) // 2, cur_y), l, font=font_title, fill=DEEP_INDIGO)
                cur_y += 68
            cur_y += 30
            
        if body:
            for l in wrap_words_bound(draw, body.lower(), font_body_reg, max_w=840):
                l_bbox = draw.textbbox((0, 0), l, font=font_body_reg)
                lw = l_bbox[2] - l_bbox[0]
                draw.text(((W - lw) // 2, cur_y), l, font=font_body_reg, fill=(70, 75, 95, 255))
                cur_y += 56
                
        draw_cacao_sacred_symbol(draw, cx=540, cy=860, size=160)
        draw.text(((W - 140) // 2, 1220), "@HAUCACAU", font=font_eyebrow, fill=DEEP_INDIGO)
        draw.text(((W - 200) // 2, 1248), "ESTADO DE PRESENÇA", font=font_sub, fill=(140, 145, 165, 230))
        return bg.convert("RGB")

    # ── SLIDE 4 / PORTAL FINE ART (CARD FLUTUANTE CENTRALIZADO) ──────────────
    h_text = "HAUCACAU"
    h_bbox = draw.textbbox((0, 0), h_text, font=font_eyebrow)
    hw = h_bbox[2] - h_bbox[0]
    hx = (W - hw) // 2
    draw.text((hx, 90), h_text, font=font_eyebrow, fill=(110, 115, 135, 240))
    draw.line([(hx - 10, 122), (hx + hw + 10, 122)], fill=HAU_GOLD_MUTED, width=2)
    
    cur_y = 160
    if title:
        for l in wrap_words_bound(draw, title.lower(), font_title, max_w=840):
            l_bbox = draw.textbbox((0, 0), l, font=font_title)
            lw = l_bbox[2] - l_bbox[0]
            draw.text(((W - lw) // 2, cur_y), l, font=font_title, fill=DEEP_INDIGO)
            cur_y += 68
            
    if img_bytes:
        try:
            art = Image.open(BytesIO(img_bytes)).convert("RGBA")
            w, h = art.size
            card_sz = 600
            crop_box = (int(w * 0.1), int(h * 0.1), int(w * 0.9), int(h * 0.9))
            art_crop = art.crop(crop_box).resize((card_sz, card_sz), Image.LANCZOS)
            
            card_x = (W - card_sz) // 2
            card_y = 490
            
            shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            s_draw = ImageDraw.Draw(shadow)
            s_draw.rectangle([card_x + 10, card_y + 16, card_x + card_sz + 10, card_y + card_sz + 16], fill=(20, 25, 45, 55))
            shadow = shadow.filter(ImageFilter.GaussianBlur(radius=26))
            bg.paste(shadow, (0, 0), shadow)
            
            mask = Image.new("L", (card_sz, card_sz), 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, card_sz, card_sz], radius=16, fill=255)
            bg.paste(art_crop, (card_x, card_y), mask)
            draw.rounded_rectangle([card_x, card_y, card_x + card_sz, card_y + card_sz], radius=16, outline=HAU_GOLD_MUTED, width=1)
        except Exception:
            pass
            
    draw.text(((W - 140) // 2, 1220), "@HAUCACAU", font=font_eyebrow, fill=DEEP_INDIGO)
    draw.text(((W - 200) // 2, 1248), "ESTADO DE PRESENÇA", font=font_sub, fill=(140, 145, 165, 230))
    return bg.convert("RGB")


# ── COMPOSE HAUCACAU IDENTIDADE OFICIAL (MINIMALISTA & SENSÍVEL) ───────────────

def compose_haucacau_identidade(img_bytes, title, body, p, title_y=None, body_y=None,
                                watermark_pos="top_left", watermark_x=None, watermark_y=None,
                                watermark_text=None, slide_idx=1):
    """
    Novo Motor Editorial HauCacau:
    - 1080x1350 px (4:5 vertical)
    - Respiração nobre, sensibilidade poética, zero poluição visual.
    - S1: Capa noturna Índigo (#191F3F) + aura suave turquesa (#4EB8AC) + silhueta suave + tipografia sensível + lineworks dourados.
    - S2 a S9: Linho creme respirando (#F6F3ED) ou Índigo com casamento tipográfico e botânica refinada.
    - S10: CTA oficial com triângulo Hau e conversão tribal.
    """
    is_dark = (slide_idx == 1 or slide_idx % 2 != 0)
    
    DEEP_INDIGO = (25, 31, 63, 255)       # #191F3F
    WARM_CREAM  = (246, 243, 237, 255)   # #F6F3ED
    HAU_GOLD    = (205, 145, 60, 255)     # #CD913C
    HAU_SOLAR   = (247, 161, 0, 255)      # #F7A100
    TEXT_WHITE  = (245, 245, 245, 255)
    TEXT_DARK   = (28, 32, 48, 255)
    
    if is_dark:
        bg = Image.new("RGBA", (W, H), DEEP_INDIGO)
        if img_bytes:
            try:
                raw_art = Image.open(BytesIO(img_bytes)).convert("RGBA").resize((W, H), Image.LANCZOS)
                bg = Image.blend(bg, raw_art, alpha=0.42)
            except Exception:
                pass
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        g_draw = ImageDraw.Draw(glow)
        g_draw.ellipse([W//2 - 350, H//2 - 350, W//2 + 350, H//2 + 350], fill=(78, 184, 172, 35))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=120))
        bg = Image.alpha_composite(bg, glow)
    else:
        bg = Image.new("RGBA", (W, H), WARM_CREAM)
        
    # Micro-textura orgânica
    noise = np.random.normal(0, 3, (H, W)).astype(np.int16)
    arr = np.array(bg).astype(np.int16)
    for c in range(3):
        arr[:, :, c] = np.clip(arr[:, :, c] + noise, 0, 255)
    bg = Image.fromarray(arr.astype(np.uint8), "RGBA")
    draw = ImageDraw.Draw(bg, "RGBA")
    
    # Fontes
    font_eyebrow = ImageFont.truetype(F_BOLD, 22)
    font_sub     = ImageFont.truetype(F_REGULAR, 17)
    font_bold    = ImageFont.truetype(F_BOLD, 52)
    font_reg     = ImageFont.truetype(F_REGULAR, 34)
    font_italic  = ImageFont.truetype(F_HEAVY_IT, 48)
    
    # 1. Header Minimalista Centralizado
    h_text = "HAUCACAU"
    h_bbox = draw.textbbox((0, 0), h_text, font=font_eyebrow)
    hw = h_bbox[2] - h_bbox[0]
    hx = (W - hw) // 2
    draw.text((hx, 90), h_text, font=font_eyebrow, fill=HAU_GOLD)
    draw.line([(hx - 12, 122), (hx + hw + 12, 122)], fill=HAU_GOLD, width=1)
    
    # 2. Linework Botânico Elegante nos Cantos
    for angle in [15, 35, 55, 75]:
        rad = math.radians(angle)
        dx = math.cos(rad) * 160
        dy = math.sin(rad) * 200
        col = (205, 145, 60, 110) if is_dark else (140, 125, 100, 85)
        # Top Left / Right
        draw.line([(60, 60), (60 + dx, 60 + dy)], fill=col, width=2)
        # Bottom Right / Left
        col_br = (78, 184, 172, 90) if is_dark else (140, 125, 100, 85)
        draw.line([(W - 60, H - 120), (W - 60 - dx, H - 120 - dy)], fill=col_br, width=2)
        
    # 3. Tipografia com Respiro Nobre
    cur_y = 440 if slide_idx == 1 else 380
    
    if title:
        title_lines = wrap_words_bound(draw, title.lower(), font_bold, max_w=840)
        for l in title_lines:
            l_bbox = draw.textbbox((0, 0), l, font=font_bold)
            lw = l_bbox[2] - l_bbox[0]
            draw.text(((W - lw) // 2, cur_y), l, font=font_bold, fill=TEXT_WHITE if is_dark else TEXT_DARK)
            cur_y += 70
        cur_y += 24
        
    if body:
        # Se contiver itálico ou frase de virada
        lines = wrap_words_bound(draw, body.lower(), font_italic if slide_idx == 1 else font_reg, max_w=840)
        for l in lines:
            f_use = font_italic if slide_idx == 1 else font_reg
            l_bbox = draw.textbbox((0, 0), l, font=f_use)
            lw = l_bbox[2] - l_bbox[0]
            fill_col = HAU_SOLAR if (is_dark and slide_idx == 1) else (HAU_GOLD if slide_idx == 1 else (TEXT_WHITE if is_dark else (90, 95, 110, 240)))
            draw.text(((W - lw) // 2, cur_y), l, font=f_use, fill=fill_col)
            cur_y += 62
            
    # 4. Monograma Sagrado Hau & Footer
    cx, cy = W // 2, 1200
    size = 24
    h_tri = size * (math.sqrt(3) / 2)
    p1 = (cx, cy - h_tri * (2/3))
    p2 = (cx - size / 2, cy + h_tri * (1/3))
    p3 = (cx + size / 2, cy + h_tri * (1/3))
    draw.line([p1, p2, p3, p1], fill=HAU_GOLD, width=2)
    draw.arc([cx - size/3, cy - size/6, cx + size/3, cy + h_tri/3], start=0, end=180, fill=HAU_GOLD, width=2)
    
    footer_text = "@haucacau · estado de presença"
    f_bbox = draw.textbbox((0, 0), footer_text, font=font_sub)
    fw = f_bbox[2] - f_bbox[0]
    draw.text(((W - fw) // 2, 1235), footer_text, font=font_sub, fill=(180, 185, 205, 220) if is_dark else (120, 120, 130, 220))
    
    return bg.convert("RGB")


# ── PUBLIC API ────────────────────────────────────────────────────────────────

def compose(img_bytes, title, body, layout="fullbleed", preset_name=DEFAULT_PRESET,
            title_y=None, body_y=None, watermark_pos="top_left", watermark_x=None, watermark_y=None,
            title_px=None, body_px=None, watermark_text=None, slide_idx=1):
    """
    layout:
      'fullbleed'           — clássico centralizado (todos os presets)
      'identidade_oficial'  — novo padrão sensível e minimalista oficial HauCacau (1080x1350)
      'editorial_paper'     — papel artesanal + colagem mística (HauCacau Criativo)
      'dramatico'           — esquerda + grain + 35mm Caravaggio (HauCacau Realista)
      'etereo'              — esquerda + suave + itálico
      'text_only'           — texto pesado sem imagem real
      'card'                — card arredondado + texto
    """
    p = get_preset(preset_name).copy()
    
    if title_px is not None and str(title_px).strip() != "":
        p["title_px"] = int(title_px)
    if body_px is not None and str(body_px).strip() != "":
        p["body_px"] = int(body_px)

    if layout == "identidade_oficial" or preset_name == "identidade_oficial":
        return compose_haucacau_identidade(img_bytes, title, body, p, title_y, body_y, watermark_pos, watermark_x, watermark_y, watermark_text, slide_idx=slide_idx)
    if layout == "editorial_paper" or preset_name == "criativo_papel":
        return compose_editorial_paper(img_bytes, title, body, p, title_y, body_y, watermark_pos, watermark_x, watermark_y, watermark_text, slide_idx=slide_idx)
    if layout == "dramatico":
        return compose_dramatico(img_bytes, title, body, p, title_y, body_y, watermark_pos, watermark_x, watermark_y, watermark_text)
    if layout == "etereo":
        return compose_etereo(img_bytes, title, body, p, title_y, body_y, watermark_pos, watermark_x, watermark_y, watermark_text)
    if layout == "text_only":
        return compose_text_only(img_bytes, title, body, p, title_y, body_y, watermark_pos, watermark_x, watermark_y, watermark_text)
    if layout == "card":
        return compose_card(img_bytes, title, body, p, title_y, body_y, watermark_pos, watermark_x, watermark_y, watermark_text)

    return compose_fullbleed(img_bytes, title, body, p, title_y, body_y, watermark_pos, watermark_x, watermark_y, watermark_text)

