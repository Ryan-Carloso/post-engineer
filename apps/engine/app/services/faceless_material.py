"""Faceless material selection for video creation.

Two modes, chosen per post by the caller (never a site-wide default):

- "broll": the previous stock cascade (pexels, pixabay, coverr).
- "svg": only the R2 SVG catalog. No stock provider is ever queried in
  this mode, so a segment can never leak a stock clip into an
  illustration-only video. If the catalog yields nothing at all, the
  caller falls back to a single neutral clip from the shared neutral
  renderer (material_verification.render_neutral_clip) instead of
  failing the task or reaching for stock.
"""

# The only source the svg mode ever queries: the catalog search in
# svg_material, keyed "svg" in material._build_search_videos.
SVG_SOURCE_ORDER = ["svg"]


def svg_source_order() -> list:
    """Source order for svg mode: catalog only, never stock."""
    return list(SVG_SOURCE_ORDER)
