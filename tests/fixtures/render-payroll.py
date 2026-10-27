"""Render the fictional spatial fixture, not real payroll data. JSON on stdin."""
import json
import sys
from reportlab.pdfgen import canvas

pages = json.loads(sys.stdin.buffer.read().decode("utf-8"))
document = canvas.Canvas(sys.argv[1], pagesize=(595.273, 841.886))
document.setTitle("Extrato mensal ficticio - teste local")
for page in pages:
    document.setPageSize((page["width"], page["height"]))
    document.setFont("Helvetica", 6.96)
    for item in page["items"]:
        document.drawString(item["x"], page["height"] - item["y"], item["text"])
    document.showPage()
document.save()
