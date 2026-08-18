#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pipeline_haucacau.py — Pipeline completo HauCacau
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Orquestra: copywriter → revisor → canalizador visual → geração de imagem → composição

USO:
    python core/agentes/pipeline_haucacau.py
    python core/agentes/pipeline_haucacau.py --data '{"tema":"...","universo":2,"avatar":"B"}'

Saída (JSON lines para stdout):
    {"type":"start",  "total":11, "titulo":"..."}
    {"type":"slide",  "num":1, "estado":"GANCHO", "status":"gerando"}
    {"type":"slide",  "num":1, "estado":"GANCHO", "status":"ok", "file":"..."}
    {"type":"done",   "id":"hau-carrossel-46", "dir":"...", "total_ok":10}
    {"type":"error",  "msg":"..."}
"""

import os, sys, json, argparse, re, time, random
from pathlib import Path
from datetime import date

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

IS_WIN = sys.platform == "win32"

def _print(data: dict):
    print(json.dumps(data, ensure_ascii=False), flush=True)

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower().strip())[:40]

def run_pipeline(tema: str, universo: int = 2, avatar: str = "A",
                 ancora: str = "", headless: bool = True):

    from core.agentes.copywriter_haucacau import gerar_copy_haucacau

    # ── 1. Gera copy ──────────────────────────────────────────────────────────
    _print({"type": "log", "msg": "Gerando copy..."})
    try:
        data = gerar_copy_haucacau(tema, universo, avatar, ancora)
    except Exception as e:
        _print({"type": "error", "msg": f"Copywriter falhou: {e}"})
        return

    titulo   = data.get("titulo_carrossel", tema)
    slides   = data.get("slides", [])
    carousel_id = f"hau-{date.today().strftime('%Y%m%d')}-{_slug(titulo)}"

    _print({"type": "start", "total": len(slides), "titulo": titulo, "id": carousel_id})

    # ── 2. Cria diretório de saída ────────────────────────────────────────────
    if IS_WIN:
        out_dir = ROOT / "carousels" / carousel_id
    else:
        out_dir = Path("/tmp") / carousel_id
    out_dir.mkdir(parents=True, exist_ok=True)

    # Salva copy JSON
    (out_dir / "copy.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ── 3. Gera imagens e compõe slides ──────────────────────────────────────
    total_ok = 0
    for slide in slides:
        num     = slide["num"]
        estado  = slide["estado"]
        layout  = slide.get("layout", "fullbleed")
        prompt  = slide.get("prompt_imagem")

        _print({"type": "slide", "num": num, "estado": estado, "status": "gerando"})

        try:
            slide_file = compor_slide(slide, out_dir, num)
            _print({"type": "slide", "num": num, "estado": estado,
                    "status": "ok", "file": str(slide_file)})
            total_ok += 1
        except Exception as e:
            _print({"type": "slide", "num": num, "estado": estado,
                    "status": "erro", "msg": str(e)})

        time.sleep(random.uniform(1.5, 3))

    # ── 4. Registra no dashboard ──────────────────────────────────────────────
    if IS_WIN:
        try:
            _registrar(carousel_id, titulo, data, out_dir)
        except Exception as e:
            _print({"type": "log", "msg": f"Registro local falhou: {e}"})

    _print({"type": "done", "id": carousel_id, "dir": str(out_dir), "total_ok": total_ok})


def compor_slide(slide: dict, out_dir: Path, num: int) -> Path:
    """Gera a imagem e compõe o slide com o motor oficial HauCacau."""
    from io import BytesIO
    from core.util.compose_util import compose

    W, H = 1080, 1350
    layout = slide.get("layout", "identidade_oficial")
    titulo = slide.get("titulo", "")
    corpo  = slide.get("corpo", "")

    img_bytes = None
    prompt = slide.get("prompt_imagem")
    if prompt and layout != "text_only" and num == 1:
        try:
            img = _gerar_imagem(prompt, W, H)
            buf = BytesIO()
            img.save(buf, format="JPEG")
            img_bytes = buf.getvalue()
        except Exception as e:
            _print({"type": "log", "msg": f"  Imagem S{num}: {e}"})

    final_img = compose(img_bytes, titulo, corpo, layout="identidade_oficial", preset_name="identidade_oficial", slide_idx=num)
    out = out_dir / f"slide_{num:02d}.jpg"
    final_img.save(str(out), "JPEG", quality=95)
    return out


def _gerar_imagem(prompt: str, w: int, h: int):
    """Gera imagem via OpenAI DALL-E 3."""
    import base64
    from io import BytesIO
    from PIL import Image
    from openai import OpenAI

    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise ValueError("OPENAI_API_KEY não encontrada")

    client = OpenAI(api_key=key)
    r = client.images.generate(
        model="dall-e-3",
        prompt=f"{prompt}\n\nStyle: warm editorial photography, amber and terracotta tones, no text, Instagram 4:5 format",
        size="1024x1024",
        quality="standard",
        n=1,
        response_format="b64_json",
    )
    img_data = base64.b64decode(r.data[0].b64_json)
    return Image.open(BytesIO(img_data))


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines, current = [], ""
    for w in words:
        if len(current) + len(w) + 1 <= width:
            current += (" " if current else "") + w
        else:
            if current: lines.append(current)
            current = w
    if current: lines.append(current)
    return lines or [""]


def _find_font(fd: Path, names: list[str]):
    for name in names:
        p = fd / name
        if p.exists():
            return p
    return None


def _registrar(carousel_id: str, titulo: str, data: dict, out_dir: Path):
    """Registra o carrossel no carousels.json do dashboard."""
    import uuid
    carousel_file = ROOT / "dashboard" / "data" / "carousels.json"
    try:
        carousels = json.loads(carousel_file.read_text(encoding="utf-8"))
        if isinstance(carousels, dict):
            carousels = list(carousels.values())
    except Exception:
        carousels = []

    slides_data = data.get("slides", [])
    entry = {
        "id":          carousel_id,
        "projeto":     "haucacau",
        "titulo":      titulo,
        "universo":    data.get("universo", 2),
        "avatar":      data.get("avatar", "A"),
        "cta_palavra": data.get("cta_palavra", ""),
        "caption":     data.get("caption", ""),
        "status":      "gerado",
        "slides":      [
            {"num": s["num"], "estado": s["estado"],
             "titulo": s["titulo"], "arquivo": f"slide_{s['num']:02d}.png"}
            for s in slides_data
        ],
        "dir":         str(out_dir),
        "criado_em":   date.today().isoformat(),
    }
    carousels.append(entry)
    carousel_file.write_text(json.dumps(carousels, ensure_ascii=False, indent=2), encoding="utf-8")


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pipeline HauCacau")
    parser.add_argument("--data", type=str, help="JSON com tema, universo, avatar, ancora")
    args = parser.parse_args()

    if args.data:
        params = json.loads(args.data)
        run_pipeline(
            tema=params.get("tema", ""),
            universo=int(params.get("universo", 2)),
            avatar=params.get("avatar", "A"),
            ancora=params.get("ancora", ""),
        )
    else:
        print("\n  Pipeline HauCacau")
        print("  " + "─" * 38)
        tema     = input("  Tema: ").strip()
        universo = int(input("  Universo (1-6, default 2): ").strip() or "2")
        avatar   = input("  Avatar (A/B/C/D, default A): ").strip().upper() or "A"
        ancora   = input("  Âncora (opcional): ").strip()
        run_pipeline(tema, universo, avatar, ancora)
