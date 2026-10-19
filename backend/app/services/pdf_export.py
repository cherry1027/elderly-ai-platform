"""Deterministic, in-memory autobiography PDF rendering for Day 6."""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from io import BytesIO
from pathlib import Path
import re
from threading import RLock
import unicodedata

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import HRFlowable, PageBreak, Paragraph, SimpleDocTemplate, Spacer

from app.core.errors import APIError


MAX_TITLE_LENGTH = 120
MAX_CONTENT_LENGTH = 20_000
MAX_FILENAME_LENGTH = 100
MAX_PDF_BYTES = 2_000_000
MAX_PAGES = 100

_ASSET_DIRECTORY = Path(__file__).resolve().parents[1] / "assets" / "fonts"
_REGULAR_FONT_PATH = _ASSET_DIRECTORY / "DejaVuSerif.ttf"
_BOLD_FONT_PATH = _ASSET_DIRECTORY / "DejaVuSerif-Bold.ttf"
_REGULAR_FONT = "MemyDejaVuSerif"
_BOLD_FONT = "MemyDejaVuSerifBold"

_INK = colors.HexColor("#24332D")
_MUTED_INK = colors.HexColor("#5D685F")
_CREAM = colors.HexColor("#FBF6EA")
_SAGE = colors.HexColor("#718B79")
_PALE_SAGE = colors.HexColor("#DDE7DD")
_COPPER = colors.HexColor("#B67B55")

_RENDER_LOCK = RLock()
_FONTS_READY = False
_SUPPORTED_CODEPOINTS: frozenset[int] = frozenset()


@dataclass(frozen=True)
class PdfDocument:
    data: bytes
    page_count: int
    filename: str


def _invalid_request() -> APIError:
    return APIError(422, "PDF_INVALID_REQUEST", "PDF export request is invalid.")


def _unsupported_character() -> APIError:
    return APIError(
        422,
        "PDF_UNSUPPORTED_CHARACTER",
        "The draft contains a character that cannot be exported safely.",
    )


def _render_failed() -> APIError:
    return APIError(
        503,
        "PDF_GENERATION_FAILED",
        "The PDF could not be generated safely.",
    )


def _ensure_fonts() -> None:
    global _FONTS_READY, _SUPPORTED_CODEPOINTS
    if _FONTS_READY:
        return
    try:
        regular = TTFont(_REGULAR_FONT, str(_REGULAR_FONT_PATH))
        bold = TTFont(_BOLD_FONT, str(_BOLD_FONT_PATH))
        pdfmetrics.registerFont(regular)
        pdfmetrics.registerFont(bold)
        pdfmetrics.registerFontFamily(
            "MemyDejaVuSerifFamily",
            normal=_REGULAR_FONT,
            bold=_BOLD_FONT,
            italic=_REGULAR_FONT,
            boldItalic=_BOLD_FONT,
        )
        _SUPPORTED_CODEPOINTS = frozenset(regular.face.charToGlyph).intersection(
            bold.face.charToGlyph
        )
    except Exception:
        raise _render_failed() from None
    _FONTS_READY = True


def _validate_text(value: str, *, allow_newlines: bool) -> None:
    for character in value:
        if character == "\n" and allow_newlines:
            continue
        category = unicodedata.category(character)
        if (
            category.startswith("C")
            or category in {"Zl", "Zp"}
            or ord(character) not in _SUPPORTED_CODEPOINTS
        ):
            raise _unsupported_character()


def _validate_request(
    *,
    title: str,
    content: str,
    language: str,
    draft_version: int,
    draft_revision: int,
    include_title_page: bool,
    include_page_numbers: bool,
) -> None:
    if (
        not isinstance(title, str)
        or title != title.strip()
        or not 1 <= len(title) <= MAX_TITLE_LENGTH
        or not isinstance(content, str)
        or len(content) > MAX_CONTENT_LENGTH
        or language not in {"en", "sv"}
        or type(draft_version) is not int
        or not 1 <= draft_version <= 2_147_483_647
        or type(draft_revision) is not int
        or not 1 <= draft_revision <= 2_147_483_647
        or type(include_title_page) is not bool
        or type(include_page_numbers) is not bool
    ):
        raise _invalid_request()
    if not content.strip():
        raise APIError(422, "PDF_EMPTY_DRAFT", "A non-empty saved draft is required.")
    _validate_text(title, allow_newlines=False)
    _validate_text(content, allow_newlines=True)


def _safe_filename(title: str, draft_version: int, draft_revision: int) -> str:
    substitutions = str.maketrans(
        {
            "å": "a",
            "ä": "a",
            "ö": "o",
            "Å": "A",
            "Ä": "A",
            "Ö": "O",
            "ø": "o",
            "Ø": "O",
            "æ": "ae",
            "Æ": "AE",
        }
    )
    normalized = unicodedata.normalize("NFKD", title.translate(substitutions))
    ascii_title = normalized.encode("ascii", "ignore").decode("ascii").casefold()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title).strip("-") or "story"
    suffix = f"-v{draft_version}-r{draft_revision}.pdf"
    maximum_slug = MAX_FILENAME_LENGTH - len("memy-") - len(suffix)
    slug = slug[:maximum_slug].rstrip("-") or "story"
    return f"memy-{slug}{suffix}"


def _styles(title_length: int) -> dict[str, ParagraphStyle]:
    if title_length > 90:
        cover_title_size, cover_title_leading = 19, 24
    elif title_length > 60:
        cover_title_size, cover_title_leading = 22, 27
    else:
        cover_title_size, cover_title_leading = 27, 33
    return {
        "brand": ParagraphStyle(
            "MemyBrand",
            fontName=_BOLD_FONT,
            fontSize=12,
            leading=15,
            textColor=_SAGE,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_title": ParagraphStyle(
            "MemyCoverTitle",
            fontName=_BOLD_FONT,
            fontSize=cover_title_size,
            leading=cover_title_leading,
            textColor=_INK,
            alignment=TA_CENTER,
            splitLongWords=True,
            spaceAfter=16,
        ),
        "cover_subtitle": ParagraphStyle(
            "MemyCoverSubtitle",
            fontName=_REGULAR_FONT,
            fontSize=14,
            leading=20,
            textColor=_MUTED_INK,
            alignment=TA_CENTER,
            spaceAfter=10,
        ),
        "title": ParagraphStyle(
            "MemyStoryTitle",
            fontName=_BOLD_FONT,
            fontSize=22,
            leading=28,
            textColor=_INK,
            alignment=TA_LEFT,
            splitLongWords=True,
            spaceAfter=8,
        ),
        "chapter": ParagraphStyle(
            "MemyChapter",
            fontName=_BOLD_FONT,
            fontSize=12,
            leading=16,
            textColor=_SAGE,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "metadata": ParagraphStyle(
            "MemyMetadata",
            fontName=_REGULAR_FONT,
            fontSize=10.5,
            leading=15,
            textColor=_MUTED_INK,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "notice": ParagraphStyle(
            "MemyNotice",
            fontName=_REGULAR_FONT,
            fontSize=10.5,
            leading=15,
            textColor=_MUTED_INK,
            backColor=_PALE_SAGE,
            borderColor=_SAGE,
            borderWidth=0.5,
            borderPadding=8,
            borderRadius=3,
            alignment=TA_LEFT,
            spaceBefore=6,
            spaceAfter=18,
        ),
        "body": ParagraphStyle(
            "MemyBody",
            fontName=_REGULAR_FONT,
            fontSize=14.5,
            leading=21,
            textColor=_INK,
            alignment=TA_LEFT,
            splitLongWords=True,
            allowWidows=0,
            allowOrphans=0,
            spaceAfter=13,
        ),
    }


def _localized_text(language: str, draft_version: int, draft_revision: int) -> dict[str, str]:
    if language == "sv":
        return {
            "subtitle": "En personlig livsberättelse",
            "chapter": "Min berättelse",
            "metadata": f"Utkast version {draft_version} - revision {draft_revision}",
            "notice": (
                "Utvecklingsexport med simulerad text - manuella ändringar, om sådana "
                "finns, har inte faktagranskats oberoende."
            ),
            "page": "Sida",
        }
    return {
        "subtitle": "A personal life story",
        "chapter": "My story",
        "metadata": f"Draft version {draft_version} - revision {draft_revision}",
        "notice": (
            "Development mock export - manual edits, if any, have not been "
            "independently fact-verified."
        ),
        "page": "Page",
    }


def _paragraph_text(value: str) -> str:
    return escape(value, quote=False).replace("\n", "<br/>")


def _story_flowables(
    *,
    title: str,
    content: str,
    localized: dict[str, str],
    include_title_page: bool,
) -> list:
    styles = _styles(len(title))
    story: list = []
    escaped_title = _paragraph_text(title)

    if include_title_page:
        cover_spacer = 18 * mm if len(title) > 90 else 27 * mm if len(title) > 60 else 37 * mm
        story.extend(
            [
                Spacer(1, cover_spacer),
                Paragraph("MEMY AI", styles["brand"]),
                HRFlowable(
                    width="28%",
                    thickness=1.5,
                    color=_COPPER,
                    hAlign="CENTER",
                    spaceBefore=2,
                    spaceAfter=18,
                ),
                Paragraph(escaped_title, styles["cover_title"]),
                Paragraph(localized["subtitle"], styles["cover_subtitle"]),
                Spacer(1, 10 * mm),
                Paragraph(localized["metadata"], styles["cover_subtitle"]),
                Spacer(1, 5 * mm),
                Paragraph(localized["notice"], styles["notice"]),
                PageBreak(),
            ]
        )
        story.append(Paragraph(localized["chapter"], styles["title"]))
    else:
        story.extend(
            [
                Paragraph(escaped_title, styles["title"]),
                Paragraph(localized["chapter"], styles["chapter"]),
            ]
        )

    story.extend(
        [
            Paragraph(localized["metadata"], styles["metadata"]),
            Paragraph(localized["notice"], styles["notice"]),
            HRFlowable(
                width="100%",
                thickness=0.7,
                color=_COPPER,
                spaceBefore=0,
                spaceAfter=16,
            ),
        ]
    )

    pending_empty_paragraph = False
    for paragraph in content.split("\n\n"):
        if not paragraph:
            pending_empty_paragraph = True
            continue
        if pending_empty_paragraph:
            story.append(Spacer(1, 10))
            pending_empty_paragraph = False
        story.append(Paragraph(_paragraph_text(paragraph), styles["body"]))
    return story


class PdfRenderer:
    renderer_version = "memy_pdf_v1"

    def render(
        self,
        *,
        title: str,
        content: str,
        language: str,
        draft_version: int,
        draft_revision: int,
        include_title_page: bool = True,
        include_page_numbers: bool = True,
    ) -> PdfDocument:
        with _RENDER_LOCK:
            _ensure_fonts()
            _validate_request(
                title=title,
                content=content,
                language=language,
                draft_version=draft_version,
                draft_revision=draft_revision,
                include_title_page=include_title_page,
                include_page_numbers=include_page_numbers,
            )
            localized = _localized_text(language, draft_version, draft_revision)
            buffer = BytesIO()
            document = SimpleDocTemplate(
                buffer,
                pagesize=A5,
                leftMargin=23 * mm,
                rightMargin=23 * mm,
                topMargin=22 * mm,
                bottomMargin=23 * mm,
                title=title,
                author="Memy AI",
                subject=(
                    f"Development mock story export, version {draft_version}, "
                    f"revision {draft_revision}"
                ),
                creator=f"Memy AI {self.renderer_version}",
            )

            def make_canvas(*args, **kwargs):
                kwargs["invariant"] = 1
                kwargs["pageCompression"] = 1
                return pdf_canvas.Canvas(*args, **kwargs)

            def decorate_page(canvas, _document) -> None:
                page_width, page_height = A5
                page_index = canvas.getPageNumber()
                is_cover = include_title_page and page_index == 1
                canvas.saveState()
                canvas.setFillColor(_CREAM)
                canvas.rect(0, 0, page_width, page_height, stroke=0, fill=1)
                if not is_cover:
                    canvas.setStrokeColor(_SAGE)
                    canvas.setLineWidth(0.65)
                    canvas.line(23 * mm, page_height - 13 * mm, page_width - 23 * mm, page_height - 13 * mm)
                    if include_page_numbers:
                        body_page = page_index - 1 if include_title_page else page_index
                        canvas.setFillColor(_MUTED_INK)
                        canvas.setFont(_REGULAR_FONT, 10.5)
                        canvas.drawCentredString(
                            page_width / 2,
                            11 * mm,
                            f"{localized['page']} {body_page}",
                        )
                canvas.restoreState()

            try:
                document.build(
                    _story_flowables(
                        title=title,
                        content=content,
                        localized=localized,
                        include_title_page=include_title_page,
                    ),
                    onFirstPage=decorate_page,
                    onLaterPages=decorate_page,
                    canvasmaker=make_canvas,
                )
                data = buffer.getvalue()
                page_count = document.page
            except APIError:
                raise
            except Exception:
                raise _render_failed() from None

            if (
                not data.startswith(b"%PDF-")
                or not 1 <= page_count <= MAX_PAGES
                or len(data) > MAX_PDF_BYTES
            ):
                raise _render_failed()
            return PdfDocument(
                data=data,
                page_count=page_count,
                filename=_safe_filename(title, draft_version, draft_revision),
            )


__all__ = ["PdfDocument", "PdfRenderer"]
