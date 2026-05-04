import jsPDF from "jspdf";

import { logClientError } from "../lib/logger";

type PdfColor = [number, number, number];

export interface PharmiGoGuideItem {
  title: string;
  body: string;
}

export interface PharmiGoGuideSection {
  title: string;
  intro?: string;
  items: PharmiGoGuideItem[];
}

export interface PharmiGoGuideContent {
  title: string;
  downloadPdf?: string;
  subtitle?: string;
  footer?: string;
  filename?: string;
  sections: PharmiGoGuideSection[];
}

const pdfColors = {
  primary: [21, 94, 117] as PdfColor,
  accent: [41, 182, 246] as PdfColor,
  text: [31, 41, 55] as PdfColor,
  muted: [100, 116, 139] as PdfColor,
  border: [203, 213, 225] as PdfColor,
  light: [248, 250, 252] as PdfColor,
};

const normalizeText = (value: string) => value.replace(/[^\x20-\x7E\u00A0-\u024F]/g, "");

export const generatePharmiGoPDF = async (content: PharmiGoGuideContent): Promise<void> => {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let cursorY = 24;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight <= pageHeight - 24) {
      return;
    }
    pdf.addPage();
    cursorY = 24;
  };

  const drawWrappedText = (
    text: string,
    options: {
      fontSize?: number;
      color?: PdfColor;
      fontStyle?: "normal" | "bold";
      indent?: number;
      gapAfter?: number;
      maxWidth?: number;
    } = {},
  ) => {
    const {
      fontSize = 11,
      color = pdfColors.text,
      fontStyle = "normal",
      indent = 0,
      gapAfter = 4,
      maxWidth = contentWidth - indent,
    } = options;
    const safeText = normalizeText(text);
    pdf.setFont("helvetica", fontStyle);
    pdf.setFontSize(fontSize);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(safeText, maxWidth);
    const blockHeight = Math.max(lines.length, 1) * (fontSize * 0.38 + 2.2);
    ensureSpace(blockHeight + gapAfter);
    pdf.text(lines, margin + indent, cursorY);
    cursorY += blockHeight + gapAfter;
  };

  const drawSectionCard = (section: PharmiGoGuideSection) => {
    const topY = cursorY;
    const estimatedHeight =
      18 +
      (section.intro ? 16 : 0) +
      section.items.reduce((sum, item) => sum + Math.max(item.body.length / 8, 18), 0);
    ensureSpace(Math.min(Math.max(estimatedHeight, 42), 150));

    pdf.setDrawColor(...pdfColors.border);
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(margin - 3, cursorY - 4, contentWidth + 6, 10, 3, 3, "F");

    drawWrappedText(section.title, {
      fontSize: 15,
      color: pdfColors.primary,
      fontStyle: "bold",
      gapAfter: 5,
    });

    if (section.intro) {
      drawWrappedText(section.intro, {
        fontSize: 11,
        color: pdfColors.muted,
        gapAfter: 6,
      });
    }

    section.items.forEach((item) => {
      drawWrappedText(item.title, {
        fontSize: 11.5,
        color: pdfColors.text,
        fontStyle: "bold",
        indent: 3,
        gapAfter: 2,
      });
      drawWrappedText(item.body, {
        fontSize: 10.8,
        color: pdfColors.text,
        indent: 7,
        gapAfter: 4,
        maxWidth: contentWidth - 7,
      });
    });

    pdf.setDrawColor(...pdfColors.border);
    pdf.roundedRect(margin - 4, topY - 8, contentWidth + 8, cursorY - topY + 4, 4, 4, "S");
    cursorY += 4;
  };

  pdf.setFillColor(...pdfColors.primary);
  pdf.rect(0, 0, pageWidth, 34, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(normalizeText("PharmiGo"), pageWidth / 2, 16, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(normalizeText(content.subtitle ?? content.title), pageWidth / 2, 25, { align: "center" });

  cursorY = 42;
  drawWrappedText(content.title, {
    fontSize: 18,
    color: pdfColors.primary,
    fontStyle: "bold",
    gapAfter: 6,
  });

  drawWrappedText(
    "Document de reference base sur les fonctionnalites actuellement presentes dans la plateforme.",
    {
      fontSize: 10.5,
      color: pdfColors.muted,
      gapAfter: 8,
    },
  );

  content.sections.forEach(drawSectionCard);

  const footerText =
    content.footer ??
    "PharmiGo - Plateforme de recherche, verification et orientation medicamenteuse pour le Burundi et la RDC.";

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    const footerY = pageHeight - 10;
    pdf.setDrawColor(...pdfColors.border);
    pdf.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...pdfColors.muted);
    pdf.text(normalizeText(footerText), margin, footerY);
    pdf.text(`${page}/${pageCount}`, pageWidth - margin, footerY, { align: "right" });
  }

  pdf.save(content.filename ?? "PharmiGo-Guide-Fonctionnel.pdf");
};

export const downloadPharmiGoPDF = async (content: PharmiGoGuideContent) => {
  try {
    await generatePharmiGoPDF(content);
  } catch (error) {
    void error;
    logClientError("La generation du PDF a echoue.");
  }
};
