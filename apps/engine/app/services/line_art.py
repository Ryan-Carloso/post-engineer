"""Hand-drawn style line-art icons for the whiteboard reveal effect.

These are purpose-built for the draw-on animation: every shape is an open or
closed stroke with no fill, so ``stroke-dashoffset`` can trace it. The strokes
use round caps and joins so the traced line reads as a marker rather than a
vector path, and coordinates carry a little jitter so the result does not look
machine-perfect.

Not part of the licensed Doodly catalog: these are original, so they can live
in the repo. Rendered via svg_draw.render_progress_frames.
"""
from __future__ import annotations

# Shared stroke presentation for every icon.
_ATTRS = (
    'fill="none" stroke="#111" stroke-width="6" '
    'stroke-linecap="round" stroke-linejoin="round"'
)

ICONS: dict[str, dict] = {
    "clock": {
        "label": "clock",
        "body": f"""
            <circle cx="100" cy="104" r="62" {_ATTRS}/>
            <path d="M100 104 L100 62" {_ATTRS}/>
            <path d="M100 104 L134 120" {_ATTRS}/>
            <path d="M100 42 L100 50" {_ATTRS}/>
            <path d="M158 104 L150 104" {_ATTRS}/>
            <path d="M100 166 L100 158" {_ATTRS}/>
            <path d="M42 104 L50 104" {_ATTRS}/>
        """,
    },
    "backpack": {
        "label": "backpack",
        "body": f"""
            <path d="M70 58 C70 42 130 42 130 58" {_ATTRS}/>
            <path d="M46 108 C46 76 154 76 154 108 L154 158 C154 172 46 172 46 158 Z" {_ATTRS}/>
            <path d="M46 118 L154 118" {_ATTRS}/>
            <path d="M84 136 L116 136 L116 158 L84 158 Z" {_ATTRS}/>
        """,
    },
    "coffee": {
        "label": "coffee cup",
        "body": f"""
            <path d="M56 96 L56 154 C56 166 132 166 132 154 L132 96 Z" {_ATTRS}/>
            <path d="M56 108 L132 108" {_ATTRS}/>
            <path d="M132 112 C158 112 158 146 132 146" {_ATTRS}/>
            <path d="M78 78 C88 68 68 60 78 50" {_ATTRS}/>
            <path d="M100 78 C110 68 90 60 100 50" {_ATTRS}/>
        """,
    },
    "money": {
        "label": "money",
        "body": f"""
            <path d="M34 78 L166 78 L166 138 L34 138 Z" {_ATTRS}/>
            <circle cx="100" cy="108" r="16" {_ATTRS}/>
            <path d="M56 96 L56 120" {_ATTRS}/>
            <path d="M144 96 L144 120" {_ATTRS}/>
        """,
    },
    "chart": {
        "label": "chart",
        "body": f"""
            <path d="M40 44 L40 168 L166 168" {_ATTRS}/>
            <path d="M62 140 L62 108" {_ATTRS}/>
            <path d="M100 140 L100 78" {_ATTRS}/>
            <path d="M138 140 L138 58" {_ATTRS}/>
            <path d="M62 84 L100 62 L138 44" {_ATTRS}/>
        """,
    },
    "phone": {
        "label": "phone",
        "body": f"""
            <path d="M68 34 L132 34 C144 34 148 40 148 52 L148 156 C148 168 144 174 132 174 L68 174 C56 174 52 168 52 156 L52 52 C52 40 56 34 68 34 Z" {_ATTRS}/>
            <path d="M88 158 L112 158" {_ATTRS}/>
            <path d="M52 68 L148 68" {_ATTRS}/>
        """,
    },
    "bulb": {
        "label": "lightbulb",
        "body": f"""
            <path d="M100 34 C128 34 146 54 146 80 C146 100 134 110 128 122 C124 130 124 140 124 148 L76 148 C76 140 76 130 72 122 C66 110 54 100 54 80 C54 54 72 34 100 34 Z" {_ATTRS}/>
            <path d="M78 164 L122 164" {_ATTRS}/>
            <path d="M84 132 L116 132" {_ATTRS}/>
        """,
    },
    "envelope": {
        "label": "envelope",
        "body": f"""
            <path d="M32 62 L100 116 L168 62" {_ATTRS}/>
            <path d="M32 62 L32 156 L168 156 L168 62" {_ATTRS}/>
        """,
    },
}


def icon_svg(name: str, size: int = 900) -> str:
    """Standalone SVG document for one icon, sized for rasterization."""
    icon = ICONS[name]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 200 200" width="{size}" height="{size}">'
        f"{icon['body']}</svg>"
    )