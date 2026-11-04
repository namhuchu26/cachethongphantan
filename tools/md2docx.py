"""Chuyển file Markdown đơn giản sang .docx (heading, đoạn văn, bảng, danh sách, code)."""
import os
import re
import sys
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

IMAGE = re.compile(r"^!\[(.*)\]\((.+)\)\s*$")

INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)")


def add_inline(par, text, bold=False):
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**"):
            run = par.add_run(part[2:-2]); run.bold = True
        elif part.startswith("`"):
            run = par.add_run(part[1:-1]); run.font.name = "Consolas"
            run.font.color.rgb = RGBColor(0xC7, 0x25, 0x4E)
        elif part.startswith("*") and len(part) > 2:
            run = par.add_run(part[1:-1]); run.italic = True
        else:
            run = par.add_run(part)
        if bold:
            run.bold = True


def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), color)
    tcPr.append(shd)


def add_table(doc, rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    header, body = cells[0], [r for r in cells[2:]]
    table = doc.add_table(rows=1 + len(body), cols=len(header))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate([header] + body):
        for j in range(len(header)):
            text = row[j] if j < len(row) else ""
            cell = table.cell(i, j)
            par = cell.paragraphs[0]
            add_inline(par, text, bold=(i == 0))
            for run in par.runs:
                run.font.size = Pt(10)
            if i == 0:
                shade(cell, "D9E2F3")
    doc.add_paragraph()


def add_code(doc, lines):
    table = doc.add_table(rows=1, cols=1)
    table.style = "Table Grid"
    cell = table.cell(0, 0)
    shade(cell, "F2F2F2")
    par = cell.paragraphs[0]
    run = par.add_run("\n".join(lines))
    run.font.name = "Consolas"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")
    run.font.size = Pt(9)
    doc.add_paragraph()


def main(src, dst):
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(12)
    lines = open(src, encoding="utf-8").read().splitlines()
    base = os.path.dirname(os.path.abspath(src))
    i = 0
    while i < len(lines):
        line = lines[i]
        img = IMAGE.match(line)
        if img:  # ![chú thích](đường/dẫn.png) → ảnh rộng 16 cm + chú thích in nghiêng
            doc.add_picture(os.path.join(base, img.group(2)), width=Cm(16))
            doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cap = doc.add_paragraph()
            cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = cap.add_run(img.group(1)); run.italic = True; run.font.size = Pt(10)
        elif line.startswith("```"):
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i]); i += 1
            add_code(doc, block)
        elif line.startswith("|"):
            block = []
            while i < len(lines) and lines[i].startswith("|"):
                block.append(lines[i]); i += 1
            add_table(doc, block)
            continue
        elif line.startswith("# "):
            doc.add_heading(line[2:], level=0)
        elif line.startswith("## "):
            doc.add_heading(line[3:], level=1)
        elif line.startswith("### "):
            doc.add_heading(line[4:], level=2)
        elif re.match(r"^- \[[ x]\] ", line):
            add_inline(doc.add_paragraph(style="List Bullet"), "☐ " + line[6:])
        elif line.startswith("- "):
            add_inline(doc.add_paragraph(style="List Bullet"), line[2:])
        elif re.match(r"^\d+\. ", line):  # giữ đúng số đã viết (List Number của Word đánh số nối tiếp cả file)
            par = doc.add_paragraph()
            par.paragraph_format.left_indent = Cm(0.63)
            par.paragraph_format.first_line_indent = Cm(-0.63)
            add_inline(par, line)
        elif line.strip():
            add_inline(doc.add_paragraph(), line)
        i += 1
    doc.save(dst)
    print("saved", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
