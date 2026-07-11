#!/usr/bin/env python3
"""
Render docs/CODEX_v2.0.md to build/Extropy_Codex_v2.0.pdf.

Pipeline:
  1. pandoc converts markdown to HTML5 using build/codex_template.html
  2. WeasyPrint renders HTML + docs/codex-v2.0.css to a paginated PDF

Run from the repo root:
    python3 build/render_codex_v2.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MD = REPO / "docs" / "CODEX_v2.0.md"
CSS = REPO / "docs" / "codex-v2.0.css"
TEMPLATE = REPO / "build" / "codex_template.html"
HTML_OUT = REPO / "build" / "codex_v2.0.html"
PDF_OUT = REPO / "build" / "Extropy_Codex_v2.0.pdf"


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
    if not MD.exists():
        print(f"missing: {MD}", file=sys.stderr)
        return 1
    if not CSS.exists():
        print(f"missing: {CSS}", file=sys.stderr)
        return 1
    if not TEMPLATE.exists():
        print(f"missing: {TEMPLATE}", file=sys.stderr)
        return 1

    run_pandoc()
    run_weasyprint()
    print(f"wrote {PDF_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
