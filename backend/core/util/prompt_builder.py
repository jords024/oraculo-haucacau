"""
prompt_builder.py — Direção de Arte Fotográfica & Cinematográfica v5
Aplica composição vertical e hierarquia de zonas para texto sem travar em ilustrações ou arte digital 3D.
"""

# ── CÂMERA & FORMATO ──────────────────────────────────────────────────────────
_CAMERA = (
    "Vertical portrait orientation, 4:5 ratio, 1080x1350 pixels. "
    "Cinematic photography fused with mystical organic psychedelic bio-luminescence, hyper-realistic 35mm lens, raw skin texture, feminine grace, and sacred botanical presence. "
)

_GRADE = (
    "Harmonious biophilic color palette: Laranja HauCacau (#F05B00) solar warmth colliding with mystical Teal/Turquoise (#18B0AC) glows and deep Navy shadows (#0F1F3F). "
    "Ethereal aura, luminous energy waves, fluid atmospheric mist, and rich organic textures. "
    "ZONE RULE: main subject and visual detail live in the TOP 60% of the frame. "
    "The BOTTOM 40% of the frame transitions smoothly into pitch black dark shadow for high-contrast text legibility. "
)

_RESTRICTIONS = (
    " Absolutely no text, letters, words, numbers or readable symbols anywhere in the generated photo. "
    "No watermarks. No logos. No fake 3D render look, no cartoon graphics. "
)


def build_prompt(slide_prompt: str, preset: str = "dramatico", slide_idx: int = 1) -> str:
    """
    Constrói prompts fotográficos de alta fidelidade baseados no Preset visual ativo.
    """
    import re

    # PRESET: CRIATIVO FORA DA CAIXA (EDITORIAL MÍSTICO EM PAPEL)
    if preset == "criativo_papel" or preset == "editorial_paper":
        if slide_idx == 1:
            return (
                "High-end editorial studio photography of a serene mystical woman with closed eyes, "
                "long voluminous dark wavy hair adorned with subtle golden stardust and bioluminescent teal touches, "
                "wearing natural organic cream linen, photorealistic 35mm portrait, soft warm rim lighting, "
                "clean bright neutral off-white background, Vogue esoteric luxury magazine cover style, high fashion portrait. "
                "Absolutely no text, no letters, no words, no logos, no 3D cartoon render."
            )
        else:
            return (
                "A breathtaking surreal fine art portal painting of ethereal flowing feminine energy waves in vibrant "
                "warm amber gold and turquoise teal, soft concentric rings of luminous mist surrounding a serene meditating silhouette, "
                "high-end museum gallery painting, centered square composition, soft ethereal colors. "
                "Absolutely no text, no letters, no words, no logos, no 3D cartoon render."
            )

    # PRESET: REALISTA (CHIAROSCURO / DRAMÁTICO)
    p = slide_prompt.strip() if slide_prompt else ""
    redundant = [
        r"vertical composition,?\s*portrait orientation[.,]?",
        r"square format[.,]?",
        r"portrait orientation[.,]?",
        r"\bno text\b[.,]?",
        r"no watermarks?[.,]?",
        r"no logos?[.,]?",
    ]
    for pattern in redundant:
        p = re.sub(pattern, "", p, flags=re.IGNORECASE).strip()

    p = p.rstrip(". ")
    if not p:
        p = "Serene mystical human presence in deep meditation, golden solar light breaking through cosmic darkness"

    return _CAMERA + p + ". " + _GRADE + _RESTRICTIONS
