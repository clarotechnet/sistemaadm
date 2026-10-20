"""Synthetic QA files only. Run using the bundled Codex Python runtime."""
from pathlib import Path
import random
import sys
from io import BytesIO
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from docx import Document
from docx.shared import Inches, Pt, RGBColor

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
image = Image.new("RGB", (500, 300), "white")
draw = ImageDraw.Draw(image)
draw.rectangle((20, 20, 450, 250), fill=(220, 35, 40))
draw.text((40, 60), "DOCUMENTO DE TESTE", fill="white")
image.save(out / "imagem.png")
image.convert("RGB").save(out / "imagem.jpg", quality=85)

c = canvas.Canvas(str(out / "original.pdf"), pagesize=(595, 842))
for index, label in enumerate(["ANA TESTE SILVA", "SEGUNDA PAGINA", "TERCEIRA PAGINA"]):
    c.setFont("Helvetica", 16)
    c.drawString(50, 760, label)
    c.setFont("Helvetica", 12)
    c.drawString(50, 730, "Documento sintético para verificar texto, ordem e conteúdo.")
    c.drawImage(str(out / "imagem.png"), 50, 480, width=250, height=150)
    c.showPage()
c.save()

reader = PdfReader(str(out / "original.pdf"))
writer = PdfWriter()
writer.add_page(reader.pages[0]).rotate(90)
with (out / "rotacionado.pdf").open("wb") as stream:
    writer.write(stream)
writer = PdfWriter()
writer.append(reader)
writer.add_blank_page(width=595, height=842)
with (out / "pagina_adicionada.pdf").open("wb") as stream:
    writer.write(stream)
writer = PdfWriter()
writer.add_page(reader.pages[0])
writer.encrypt("senha-teste")
with (out / "protegido.pdf").open("wb") as stream:
    writer.write(stream)

for version in ["a", "b"]:
    scanned = image.copy()
    if version == "b":
        ImageDraw.Draw(scanned).rectangle((100, 100, 200, 190), fill="blue")
    c = canvas.Canvas(str(out / f"digitalizado_{version}.pdf"), pagesize=(595, 842))
    c.drawImage(ImageReader(scanned), 40, 400, width=500, height=300)
    c.showPage()
    c.save()

rng = random.Random(42)
noise = Image.frombytes("RGB", (1200, 1600), rng.randbytes(1200 * 1600 * 3))
c = canvas.Canvas(str(out / "grande.pdf"), pagesize=(595, 842))
c.drawImage(ImageReader(noise), 0, 0, width=595, height=842)
c.showPage()
c.save()
(out / "corrompido.pdf").write_bytes(b"%PDF-1.7\narquivo corrompido")

for long in [False, True]:
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    section.left_margin = section.right_margin = Inches(.7)
    document.styles["Normal"].font.name = "Arial"
    document.styles["Normal"].font.size = Pt(11)
    document.styles["Title"].font.color.rgb = RGBColor(0, 0, 0)
    document.add_paragraph("Relatório de teste", style="Title")
    paragraph = document.add_paragraph("Conversão de documento com ")
    paragraph.add_run("acentuação e negrito").bold = True
    paragraph.add_run(". Ação, saúde, rescisão e informações.")
    table = document.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    table.rows[0].cells[0].text, table.rows[0].cells[1].text = "Colaborador", "Valor"
    table.add_row().cells[0].text = "Ana Teste Silva"
    table.rows[1].cells[1].text = "R$ 123,45"
    document.add_picture(str(out / "imagem.png"), width=Inches(2))
    if long:
        for index in range(90):
            document.add_paragraph(f"Registro {index + 1:03d}. Conteúdo para testar paginação e a preservação de todas as linhas sem cortes ou sobreposição de texto.")
    document.save(out / ("word_longo.docx" if long else "word_simples.docx"))

print(f"Synthetic PDF/DOCX QA fixtures prepared in {out}")
