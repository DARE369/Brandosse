import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def parse_table_block(lines):
    rows = []
    for line in lines:
        if not line.strip().startswith("|"):
            continue
        cols = [c.strip() for c in line.strip().strip("|").split("|")]
        if cols and all(set(c) <= {"-", ":"} for c in cols):
            continue
        rows.append(cols)
    return rows


def build_story(markdown_text):
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        spaceAfter=8,
    )
    h2_style = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        spaceBefore=8,
        spaceAfter=4,
    )
    h3_style = ParagraphStyle(
        "H3",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        spaceBefore=6,
        spaceAfter=2,
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        spaceAfter=2,
    )
    bullet_style = ParagraphStyle(
        "Bullet",
        parent=body_style,
        leftIndent=10,
        bulletIndent=2,
    )

    story = []
    lines = markdown_text.splitlines()
    i = 0

    while i < len(lines):
        line = lines[i].rstrip()

        if not line.strip():
            story.append(Spacer(1, 2))
            i += 1
            continue

        if line.startswith("### "):
            story.append(Paragraph(line[4:].strip(), h3_style))
            i += 1
            continue

        if line.startswith("## "):
            story.append(Paragraph(line[3:].strip(), h2_style))
            i += 1
            continue

        if line.startswith("# "):
            story.append(Paragraph(line[2:].strip(), title_style))
            i += 1
            continue

        if line.lstrip().startswith("|"):
            block = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                block.append(lines[i])
                i += 1
            rows = parse_table_block(block)
            if rows:
                max_cols = max(len(r) for r in rows)
                padded = [r + [""] * (max_cols - len(r)) for r in rows]
                table = Table(
                    padded,
                    repeatRows=1,
                    hAlign="LEFT",
                )
                table.setStyle(
                    TableStyle(
                        [
                            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                            ("FONTSIZE", (0, 0), (-1, -1), 8),
                            ("LEADING", (0, 0), (-1, -1), 10),
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f0")),
                            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#c7c7c7")),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 4),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                            ("TOPPADDING", (0, 0), (-1, -1), 3),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                        ]
                    )
                )
                story.append(table)
                story.append(Spacer(1, 6))
            continue

        if line.startswith("- "):
            text = line[2:].strip()
            story.append(Paragraph(text, bullet_style, bulletText="•"))
            i += 1
            continue

        if re.match(r"^\d+\.\s", line):
            text = re.sub(r"^\d+\.\s*", "", line).strip()
            story.append(Paragraph(text, bullet_style, bulletText="•"))
            i += 1
            continue

        paragraph_lines = [line]
        i += 1
        while i < len(lines):
            next_line = lines[i].rstrip()
            if (
                not next_line.strip()
                or next_line.startswith("#")
                or next_line.startswith("- ")
                or re.match(r"^\d+\.\s", next_line)
                or next_line.lstrip().startswith("|")
            ):
                break
            paragraph_lines.append(next_line)
            i += 1

        text = " ".join(s.strip() for s in paragraph_lines)
        text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        text = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", text)
        story.append(Paragraph(text, body_style))

    return story


def render_markdown_to_pdf(markdown_path, pdf_path):
    markdown = Path(markdown_path)
    output = Path(pdf_path)

    text = markdown.read_text(encoding="utf-8")
    story = build_story(text)

    doc = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=markdown.stem,
    )
    doc.build(story)


def main():
    if len(sys.argv) != 3:
        print("Usage: python scripts/render_markdown_pdf.py <input.md> <output.pdf>")
        sys.exit(1)

    render_markdown_to_pdf(sys.argv[1], sys.argv[2])
    print(f"PDF created: {sys.argv[2]}")


if __name__ == "__main__":
    main()

