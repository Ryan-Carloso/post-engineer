"""Read the JSON array out of a model reply.

Models explain themselves around the list they were asked for, and the
commentary often holds stray brackets ("Sure [as asked]: [1, 3]"): every "["
is tried as a start until one decodes to a list.
"""

import json
import re
from typing import Optional


def first_json_array(text: Optional[str]) -> Optional[list]:
    """The first JSON array in `text`, or None when there is none."""
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\[", text or ""):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except ValueError:
            continue
        if isinstance(value, list):
            return value
    return None
