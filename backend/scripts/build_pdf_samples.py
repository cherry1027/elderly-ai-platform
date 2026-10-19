#!/usr/bin/env python3
"""Build two deterministic, fictional Day 6 PDF samples for visual review."""

from __future__ import annotations

from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.pdf_export import PdfRenderer  # noqa: E402


SWEDISH_SAMPLE = """Jag heter Elin och växte upp i den fiktiva kuststaden Björkhamn. Mitt första hem låg nära hamnen, där jag ofta såg båtarna återvända på kvällen.

Jag minns särskilt köket i vårt lilla hus. Där doftade det nybakat bröd på lördagarna, och det stora träbordet var platsen där jag brukade rita och läsa.

När jag var ung flyttade jag till Malmö för att studera. Jag kände mig lite nervös den första dagen, men jag blev snart lugnare när jag lärde känna staden.

Jag arbetade senare på ett bibliotek. Jag tyckte om de stilla morgnarna, hyllorna med gamla böcker och samtalen med människor som letade efter en särskild berättelse.

På fritiden promenerade jag gärna vid havet. Jag minns vinden, måsarna och ljuset över vattnet. De stunderna gav mig ro.

Det här är en fiktiv provberättelse som används för att granska PDF-formatets läsbarhet, svenska tecken och sidbrytningar."""


ENGLISH_SAMPLE = """My name is Eleanor, and I grew up in the fictional town of Willow Bay. My childhood home stood near a quiet garden, where I remember the scent of mint and the sound of rain against the kitchen window.

I walked to a small school at the edge of town. I felt a little nervous on my first morning, but I soon came to enjoy the bright classroom and the shelves filled with storybooks.

As a young adult, I moved to Bristol to study. I rented a modest room above a bakery and learned the rhythm of a new city. I remember early buses, warm bread, and letters arriving from home.

I later worked in a public library. My favourite hours were the quiet ones before opening, when sunlight reached across the reading tables and the building seemed to be waiting for its visitors.

One spring, I joined a community garden. I planted beans, rosemary, and sunflowers. The garden became a place where neighbours exchanged practical advice and took time to listen to one another.

Years later, I returned to Willow Bay for a visit. The streets looked smaller than I remembered, yet the path beside the water still felt familiar. I sat on a bench and watched the evening light move across the harbour.

I have kept a few simple traditions from those years. I still bake bread on some Saturdays, keep a book beside my chair, and make time for a walk whenever the weather is kind.

This is a fictional sample story used only to review PDF typography, paragraph flow, page numbering, and safe English export behaviour."""


def build_samples(output_directory: Path | None = None) -> list[Path]:
    repository_root = Path(__file__).resolve().parents[2]
    destination = output_directory or repository_root / "output" / "pdf"
    destination.mkdir(parents=True, exist_ok=True)
    renderer = PdfRenderer()
    specifications = (
        (
            "memy-sample-sv.pdf",
            "Mitt fiktiva liv vid havet",
            SWEDISH_SAMPLE,
            "sv",
        ),
        (
            "memy-sample-en.pdf",
            "A Fictional Life by the Water",
            ENGLISH_SAMPLE,
            "en",
        ),
    )
    paths: list[Path] = []
    for filename, title, content, language in specifications:
        document = renderer.render(
            title=title,
            content=content,
            language=language,
            draft_version=1,
            draft_revision=1,
            include_title_page=True,
            include_page_numbers=True,
        )
        if document.page_count > 4:
            raise RuntimeError("Sample exceeded the four-page visual review bound.")
        path = destination / filename
        path.write_bytes(document.data)
        paths.append(path)
        print(f"{path} ({document.page_count} pages)")
    return paths


if __name__ == "__main__":
    build_samples()
