import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { logClientError } from "../lib/logger";

export interface PharmiGoPDFContent {
  title: string;
  subtitle: string;
  sections: {
    title: string;
    content: string[];
    type: 'text' | 'list' | 'comparison';
  }[];
}

type PdfColor = [number, number, number];

export const generatePharmiGoPDF = async (): Promise<void> => {
  const pdf = new jsPDF('p', 'mm', 'a4');

  // PharmiGo Brand Colors
  const colors = {
    primary: [34, 197, 94] as PdfColor,
    secondary: [22, 163, 74] as PdfColor,
    accent: [245, 158, 11] as PdfColor,
    text: [31, 41, 55] as PdfColor,
    light: [248, 250, 252] as PdfColor,
    danger: [239, 68, 68] as PdfColor,
    success: [34, 197, 94] as PdfColor
  };

  // Page dimensions
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let currentY = margin;

  // Helper functions
  const addText = (text: string, fontSize: number = 12, color: PdfColor = colors.text, style: 'normal' | 'bold' = 'normal') => {
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', style);
    pdf.setTextColor(...color);
    return pdf.splitTextToSize(text, contentWidth);
  };

  const addSection = (title: string, content: string[], startY: number) => {
    let y = startY;

    // Section title
    const titleText = addText(title, 16, colors.primary, 'bold');
    pdf.text(titleText, margin, y);
    y += pdf.getTextDimensions(titleText).h + 10;

    // Section content
    content.forEach(item => {
      if (item.startsWith('•')) {
        // Bullet point
        const bulletText = addText(item, 11, colors.text, 'normal');
        pdf.text(bulletText, margin + 5, y);
        y += pdf.getTextDimensions(bulletText).h + 5;
      } else if (item.includes('**')) {
        // Bold text
        const boldText = item.replace(/\*\*/g, '');
        const textLines = addText(boldText, 11, colors.text, 'bold');
        pdf.text(textLines, margin, y);
        y += pdf.getTextDimensions(textLines).h + 5;
      } else {
        // Normal text
        const textLines = addText(item, 11, colors.text, 'normal');
        pdf.text(textLines, margin, y);
        y += pdf.getTextDimensions(textLines).h + 5;
      }
    });

    return y + 15;
  };

  // Add header
  pdf.setFillColor(...colors.primary);
  pdf.rect(0, 0, pageWidth, 40, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(24);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PharmiGo', pageWidth / 2, 25, { align: 'center' });

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'normal');
  pdf.text('La Révolution de l\'Accès aux Médicaments', pageWidth / 2, 35, { align: 'center' });

  currentY = 60;

  // Main content
  const sections = [
    {
      title: '🎯 Qu\'est-ce que PharmiGo ?',
      content: [
        'PharmiGo est une plateforme numérique révolutionnaire conçue spécifiquement pour les populations du Burundi et de la RDC.',
        'Elle transforme radicalement l\'accès aux médicaments en connectant instantanément les patients avec les pharmacies ayant les médicaments requis en stock.',
        '',
        '🚀 **Diffusion en Temps Réel**',
        'Votre ordonnance est instantanément visible par toutes les pharmacies partenaires de votre région',
        '',
        '📍 **Géolocalisation Intelligente**',
        'Localisez automatiquement les pharmacies les plus proches avec disponibilité effective',
        '',
        '⚡ **Comparaison Instantanée**',
        'Comparez les prix, délais et services en un seul clic'
      ]
    },
    {
      title: '🎯 Objectifs de PharmiGo',
      content: [
        '🏥 **Réduire la Pénurie de Médicaments**',
        'Éradiquer les ruptures de stock en connectant patients et pharmacies en temps réel',
        '',
        '⏱️ **Économiser le Temps Précieux**',
        'Finir les heures de recherche et les appels infructueux aux pharmacies',
        '',
        '💊 **Garantir l\'Accès Universel**',
        'Assurer que chaque citoyen puisse trouver ses médicaments rapidement',
        '',
        '📱 **Démocratiser la Santé Digitale**',
        'Rendre la technologie accessible à tous pour améliorer la santé publique'
      ]
    },
    {
      title: '🔄 Comment ça Marche ?',
      content: [
        '📸 **1. Publiez votre Ordonnance**',
        'Prenez une photo claire ou scannez votre ordonnance en quelques secondes',
        '',
        '📬 **2. Recevez des Réponses**',
        'Les pharmacies confirment la disponibilité et proposent leurs services (livraison/retrait)',
        '',
        '✅ **3. Choisissez en Toute Confiance**',
        'Sélectionnez la pharmacie idéale selon vos critères de prix et de proximité'
      ]
    },
    {
      title: '🌟 Distinction PharmiGo vs Autres Solutions',
      content: [
        '| Critère | Solutions Traditionnelles | PharmiGo |',
        '|---|---|---|',
        '| Disponibilité en Temps Réel | ❌ Non | ✅ Oui |',
        '| Géolocalisation Précise | ❌ Non | ✅ Oui |',
        '| Comparaison des Prix | ❌ Non | ✅ Oui |',
        '| Service de Livraison | ❌ Rare | ✅ Oui |',
        '| Adapté au Contexte Local | ❌ Non | ✅ Oui |',
        '',
        'PharmiGo se distingue par son adaptation complète au contexte local du Burundi et de la RDC, offrant des solutions que les plateformes standards ne proposent pas.'
      ]
    },
    {
      title: '❤️ Importance pour la Communauté',
      content: [
        '👨‍👩‍👧‍👦 **Impact Familial**',
        'Protégez vos proches en garantissant un accès rapide aux médicaments essentiels',
        '',
        '💼 **Impact Économique**',
        'Créez des opportunités pour les pharmacies et économisez temps et argent pour les patients',
        '',
        '🏛️ **Impact Sanitaire**',
        'Améliorez la santé publique en réduisant les retards de traitement',
        '',
        '🌍 **Impact Social**',
        'Développez l\'inclusion numérique et l\'accès équitable aux soins de santé'
      ]
    },
    {
      title: '🚀 L\'Innovation PharmiGo',
      content: [
        '🗺️ **Cartographie Intégrée**',
        'Localisation GPS précise de chaque pharmacie partenaire avec itinéraires optimisés',
        '',
        '🔐 **Sécurité Maximale**',
        'Chiffrement de bout en bout pour vos données médicales confidentielles',
        '',
        '📱 **Multi-plateforme**',
        'Disponible sur web, mobile USSD et application native adaptée au contexte local',
        '',
        '💬 **Communication Directe**',
        'Chat intégré avec les pharmacies pour clarifier les détails et suivre les commandes'
      ]
    },
    {
      title: '🏥 Pour les Pharmacies Partenaires',
      content: [
        '📈 **Visibilité Accrue**',
        'Atteignez des milliers de patients cherchant activement vos médicaments',
        '',
        '⏰ **Gestion Optimisée**',
        'Interface simple pour gérer les demandes et optimiser votre inventaire',
        '',
        '💰 **Revenus Additionnels**',
        'Transformez chaque demande en opportunité commerciale rentable',
        '',
        '📊 **Analytics Avancés**',
        'Accédez à des données précises sur les tendances du marché local'
      ]
    }
  ];

  // Add sections
  sections.forEach(section => {
    if (currentY > pageHeight - 50) {
      pdf.addPage();
      currentY = margin;
    }
    currentY = addSection(section.title, section.content, currentY);
  });

  // Add footer
  const footerY = pageHeight - 20;
  pdf.setFillColor(...colors.light);
  pdf.rect(0, footerY - 10, pageWidth, 20, 'F');

  pdf.setTextColor(...colors.text);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text('© 2024 PharmiGo - Révolutionnant l\'accès aux médicaments au Burundi et en RDC', pageWidth / 2, footerY, { align: 'center' });

  // Save the PDF
  pdf.save('PharmiGo-Information-Complete.pdf');
};

export const downloadPharmiGoPDF = async () => {
  try {
    await generatePharmiGoPDF();
  } catch (error) {
    void error;
    logClientError("La generation du PDF a echoue.");
  }
};
