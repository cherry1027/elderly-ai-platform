"""Standalone, offline tests for the Day 6 autobiography PDF renderer."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import re

from pypdf import PdfReader
import pytest

from app.core.errors import APIError
import app.services.pdf_export as pdf_export
from app.services.pdf_export import PdfDocument, PdfRenderer
from scripts.build_pdf_samples import build_samples


def render(
    *,
    title: str = "My Life Story",
    content: str = "I moved to Malmö and felt a little nervous.",
    language: str = "en",
    draft_version: int = 2,
    draft_revision: int = 3,
    include_title_page: bool = True,
    include_page_numbers: bool = True,
) -> PdfDocument:
    return PdfRenderer().render(
        title=title,
        content=content,
        language=language,
        draft_version=draft_version,
        draft_revision=draft_revision,
        include_title_page=include_title_page,
        include_page_numbers=include_page_numbers,
    )


def reader(document: PdfDocument) -> PdfReader:
    return PdfReader(BytesIO(document.data))


def extracted_pages(document: PdfDocument) -> list[str]:
    return [(page.extract_text() or "") for page in reader(document).pages]


def assert_error(call, code: str) -> None:
    with pytest.raises(APIError) as raised:
        call()
    assert raised.value.status_code == 422
    assert raised.value.code == code
    assert raised.value.message


def test_swedish_pdf_is_valid_selectable_and_paginated_after_cover() -> None:
    document = render(
        title="Mitt liv, min berättelse",
        content=(
            "Jag växte upp i Göteborg med utsikt över sjön.\n\n"
            "Jag flyttade senare till Malmö och kände mig både lugn och stolt."
        ),
        language="sv",
    )
    pdf = reader(document)
    pages = extracted_pages(document)

    assert document.data.startswith(b"%PDF-")
    assert document.page_count == len(pdf.pages) >= 2
    assert len(document.data) <= 2_000_000
    assert "Mitt liv, min berättelse" in re.sub(r"\s+", " ", pages[0])
    assert "Göteborg" in "\n".join(pages)
    assert "sjön" in "\n".join(pages)
    assert "Malmö" in "\n".join(pages)
    assert "Sida" not in pages[0]
    assert "Sida 1" in pages[1]
    assert "faktagranskats" in "\n".join(pages)


def test_english_pdf_without_cover_or_page_numbers_is_single_readable_page() -> None:
    document = render(
        content="I grew up near the sea.\n\nMy name is Anna.",
        include_title_page=False,
        include_page_numbers=False,
    )
    pages = extracted_pages(document)

    assert document.page_count == 1
    assert "My Life Story" in pages[0]
    assert "My story" in pages[0]
    assert "I grew up near the sea." in pages[0]
    assert "Page 1" not in pages[0]
    assert "Development mock export" in pages[0]
    assert "Draft version 2 - revision 3" in pages[0]


def test_renderer_is_byte_deterministic_and_reports_matching_page_count() -> None:
    first = render()
    second = render()

    assert first == second
    assert first.page_count == len(reader(first).pages)
    assert reader(first).metadata.creation_date is not None


def test_embeds_bundled_unicode_font_and_uses_large_body_text() -> None:
    document = render(include_title_page=False)
    pdf = reader(document)
    font_names: list[str] = []
    embedded_font_files = 0
    content_streams = b""

    for page in pdf.pages:
        content_streams += page.get_contents().get_data()
        fonts = page["/Resources"].get("/Font", {})
        for font_reference in fonts.values():
            font = font_reference.get_object()
            font_names.append(str(font.get("/BaseFont", "")))
            direct_descriptor = font.get("/FontDescriptor")
            if direct_descriptor is not None:
                descriptor = direct_descriptor.get_object()
                if descriptor.get("/FontFile2") is not None:
                    embedded_font_files += 1
            descendants = font.get("/DescendantFonts", [])
            for descendant_reference in descendants:
                descendant = descendant_reference.get_object()
                descriptor_reference = descendant.get("/FontDescriptor")
                if descriptor_reference is None:
                    continue
                descriptor = descriptor_reference.get_object()
                if descriptor.get("/FontFile2") is not None:
                    embedded_font_files += 1

    assert any("DejaVuSerif" in name for name in font_names)
    assert embedded_font_files >= 1
    assert re.search(rb"(?:14|14\.5|15)\s+Tf", content_streams)


def test_markup_urls_and_special_characters_are_literal_and_never_annotations() -> None:
    literal = (
        "I wrote <b>literal words</b> & kept {braces}; "
        "https://example.invalid/<story>?a=1&b=2."
    )
    document = render(content=literal, include_title_page=False)
    pdf = reader(document)
    text = "\n".join(extracted_pages(document))

    assert "<b>literal words</b>" in text
    assert "& kept" in text and "{braces}" in text
    assert "https://example.invalid/<st" in text.replace("\n", "")
    assert all(not page.get("/Annots") for page in pdf.pages)


def test_multipage_content_and_long_token_are_wrapped_without_cutoff() -> None:
    paragraphs = [
        f"I remember fictional chapter {index:03d} beside the garden and the old oak tree."
        for index in range(1, 100)
    ]
    long_token = "x" * 2_500
    content = "\n\n".join([paragraphs[0], long_token, *paragraphs[1:]])

    document = render(content=content, include_title_page=False)
    text = "\n".join(extracted_pages(document))

    assert 2 <= document.page_count <= 100
    assert "fictional chapter 001" in text
    assert "fictional chapter 099" in text
    assert text.count("x") >= 2_500
    assert len(document.data) <= 2_000_000


def test_empty_paragraphs_produce_a_valid_document_without_added_claims() -> None:
    document = render(
        content="I remember the garden.\n\n\n\nI remember the kitchen.",
        include_title_page=False,
    )
    text = "\n".join(extracted_pages(document))

    assert "I remember the garden." in text
    assert "I remember the kitchen." in text
    assert "children" not in text.casefold()


def test_many_empty_paragraphs_collapse_to_one_bounded_visual_pause() -> None:
    content = "I remember the garden.\n\n" + ("\n\n" * 9_000) + "I remember the kitchen."

    document = render(content=content, include_title_page=False)
    text = "\n".join(extracted_pages(document))

    assert len(content) <= 20_000
    assert document.page_count == 1
    assert "I remember the garden." in text
    assert "I remember the kitchen." in text


def test_maximum_length_title_stays_on_one_cover_before_story_body() -> None:
    title = ("A Life Remembered With Warmth and Care " * 4)[:120].rstrip()
    document = render(title=title, content="I remember the garden.")
    pages = extracted_pages(document)

    assert len(title) <= 120
    assert document.page_count == 2
    assert "I remember the garden." not in pages[0]
    assert "I remember the garden." in pages[1]
    assert "My story" in pages[1]


@pytest.mark.parametrize("content", ["", " ", "\n\n"])
def test_blank_draft_is_rejected(content: str) -> None:
    assert_error(lambda: render(content=content), "PDF_EMPTY_DRAFT")


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""},
        {"title": "x" * 121},
        {"content": "x" * 20_001},
        {"language": "de"},
        {"draft_version": 0},
        {"draft_version": True},
        {"draft_revision": 0},
        {"include_title_page": 1},
        {"include_page_numbers": "true"},
    ],
)
def test_request_options_are_strict(overrides: dict) -> None:
    arguments = {
        "title": "My Life Story",
        "content": "I remember the garden.",
        "language": "en",
        "draft_version": 1,
        "draft_revision": 1,
        "include_title_page": True,
        "include_page_numbers": True,
    }
    arguments.update(overrides)
    assert_error(lambda: PdfRenderer().render(**arguments), "PDF_INVALID_REQUEST")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", "My\nStory"),
        ("content", "I remember this.\x00Hidden"),
        ("content", "I remember this.\x0bHidden"),
        ("content", "I remember this 😀"),
        ("content", "I remember this.\u200bHidden"),
        ("content", "I remember this.\u2028Hidden"),
        ("content", "I remember this.\u2029Hidden"),
    ],
)
def test_controls_and_unsupported_glyphs_fail_safely(field: str, value: str) -> None:
    arguments = {"title": "My Story", "content": "I remember this."}
    arguments[field] = value

    assert_error(
        lambda: render(title=arguments["title"], content=arguments["content"]),
        "PDF_UNSUPPORTED_CHARACTER",
    )


def test_filename_is_stable_ascii_path_safe_and_bounded() -> None:
    long_title = ("Åsa & Örjan / Min berättelse " + ("lång " * 30)).strip()
    long_title = long_title[:120].rstrip()
    document = render(
        title=long_title,
        draft_version=12,
        draft_revision=34,
    )

    assert document.filename.endswith("-v12-r34.pdf")
    assert document.filename.isascii()
    assert len(document.filename) <= 100
    assert re.fullmatch(r"memy-[a-z0-9]+(?:-[a-z0-9]+)*-v12-r34\.pdf", document.filename)
    assert "/" not in document.filename and "\\" not in document.filename


def test_bundled_font_assets_include_redistribution_license() -> None:
    fonts = Path(__file__).parents[1] / "app" / "assets" / "fonts"

    assert (fonts / "DejaVuSerif.ttf").stat().st_size > 300_000
    assert (fonts / "DejaVuSerif-Bold.ttf").stat().st_size > 300_000
    license_text = (fonts / "LICENSE-DejaVu.txt").read_text(encoding="utf-8")
    assert "Permission is hereby granted" in license_text
    assert "Bitstream" in license_text
    assert "Tavmjong Bah" in license_text


def test_unexpected_render_failure_uses_stable_generation_error(monkeypatch) -> None:
    def fail_safely(**_kwargs):
        raise RuntimeError("private renderer detail")

    monkeypatch.setattr(pdf_export, "_story_flowables", fail_safely)
    with pytest.raises(APIError) as raised:
        render()

    assert raised.value.status_code == 503
    assert raised.value.code == "PDF_GENERATION_FAILED"
    assert "private" not in raised.value.message


def test_sample_builder_writes_two_bounded_review_documents(tmp_path: Path) -> None:
    paths = build_samples(tmp_path)

    assert [path.name for path in paths] == [
        "memy-sample-sv.pdf",
        "memy-sample-en.pdf",
    ]
    for path in paths:
        pdf = PdfReader(path)
        assert 2 <= len(pdf.pages) <= 4
        assert path.stat().st_size <= 2_000_000
