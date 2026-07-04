#!/usr/bin/env python3
"""
Render docs/CODEX_v2.0_COMPREHENSIVE.md to build/Extropy_Codex_v2.0_Comprehensive.pdf.

Uses the same pandoc + WeasyPrint pipeline as the Concise edition.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MD = REPO / "docs" / "CODEX_v2.0_COMPREHENSIVE.md"
CSS = REPO / "docs" / "codex-v2.0.css"
TEMPLATE = REPO / "build" / "codex_template.html"
HTML_OUT = REPO / "build" / "codex_v2.0_comprehensive.html"
PDF_OUT = REPO / "build" / "Extropy_Codex_v2.0_Comprehensive.pdf"


def run_pandoc() -> None:
    cmd = [
        "pandoc",
        str(MD),
        "-f",
        "markdown+yaml_metadata_block+pipe_tables",
        "-t",
        "html5",
        "--template",
        str(TEMPLATE),
        "--section-divs",
        "--wrap=none",
        "-o",
        str(HTML_OUT),
    ]
    subprocess.run(cmd, check=True)


def run_weasyprint() -> None:
    from weasyprint import HTML, CSS as WeasyCSS

    html = HTML(filename=str(HTML_OUT), base_url=str(REPO))
    stylesheet = WeasyCSS(filename=str(CSS))
    html.write_pdf(str(PDF_OUT), stylesheets=[stylesheet])


def main() -> int:
    for p in (MD, CSS, TEMPLATE):
        if not p.exists():
            print(f"missing: {p}", file=sys.stderr)
            return 1

    run_pandoc()
    run_weasyprint()
    print(f"wrote {PDF_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
