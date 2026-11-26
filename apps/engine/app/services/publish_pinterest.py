"""Pinterest publish contract for the internal upload API.

Wire contract (multipart/form-data, ``POST /api/upload-content``):
``provider=pinterest``, ``video`` (file), ``title``, ``description``,
``boardId`` (one board for the whole batch — a schedule carries exactly
one ``pinterest_board_id``), ``aiLabel`` (true|false), repeated
``pinterestAccountIds`` fields (Pinterest user ids), optional
``coverImageUrl``.

Kept out of ``upload_publisher`` (which imports the provider contract from here) so that
module stays under the file-size cap; it owns only the Pinterest types,
validation and multipart fields.
"""

from __future__ import annotations

from dataclasses import dataclass

PINTEREST_PROVIDER: str = "pinterest"
PINTEREST_TITLE_MAX_LENGTH: int = 100
PINTEREST_DESCRIPTION_MAX_LENGTH: int = 800


@dataclass
class PinterestMetadata:
    """Fields required by the internal route for a Pinterest video Pin."""

    title: str
    description: str
    board_id: str
    account_ids: tuple[str, ...]
    ai_label: bool = False

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


def validate_pinterest_metadata(pinterest: PinterestMetadata | None) -> None:
    """Raise ValueError when the Pinterest metadata violates the route contract."""
    if pinterest is None:
        raise ValueError("pinterest provider requires pinterest metadata")
    if not pinterest.account_ids:
        raise ValueError("pinterest publish requires at least one account id")
    if not pinterest.board_id.strip():
        raise ValueError("pinterest publish requires a board id")
    if len(pinterest.title) > PINTEREST_TITLE_MAX_LENGTH:
        raise ValueError(
            "pinterest title exceeds "
            f"{PINTEREST_TITLE_MAX_LENGTH} characters"
        )
    if len(pinterest.description) > PINTEREST_DESCRIPTION_MAX_LENGTH:
        raise ValueError(
            "pinterest description exceeds "
            f"{PINTEREST_DESCRIPTION_MAX_LENGTH} characters"
        )


def pinterest_fields(metadata: PinterestMetadata) -> list[tuple[str, str]]:
    """Multipart fields (file excluded) for a Pinterest request."""
    return [
        ("provider", PINTEREST_PROVIDER),
        ("title", metadata.title),
        ("description", metadata.description),
        ("boardId", metadata.board_id),
        ("aiLabel", "true" if metadata.ai_label else "false"),
        *(("pinterestAccountIds", account_id) for account_id in metadata.account_ids),
    ]
