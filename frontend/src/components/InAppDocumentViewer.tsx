import { useEffect } from "react";

import ModalTransition from "./ModalTransition";

type InAppDocumentViewerProps = {
  title: string;
  src: string | null;
  contentType?: string | null;
  fileName?: string | null;
  kicker?: string;
  onClose: () => void;
};

function isImageDocument(url: string, contentType?: string | null, fileName?: string | null) {
  if (contentType?.startsWith("image/")) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(fileName || url);
}

function isPdfDocument(url: string, contentType?: string | null, fileName?: string | null) {
  if (contentType?.includes("pdf")) {
    return true;
  }
  return /\.pdf(\?.*)?$/i.test(fileName || url);
}

export default function InAppDocumentViewer({ title, src, contentType, fileName, kicker = "Ordonnance originale", onClose }: InAppDocumentViewerProps) {
  useEffect(() => {
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
  }, [src]);

  if (!src) {
    return null;
  }

  const imageDocument = isImageDocument(src, contentType, fileName);
  const pdfDocument = isPdfDocument(src, contentType, fileName);
  const viewerTitle = fileName || title;

  return (
    <ModalTransition overlayClassName="document-viewer-overlay" panelClassName="document-viewer-dialog" ariaLabel={title}>
        <div className="document-viewer-head">
          <div>
            <span className="document-viewer-kicker">{kicker}</span>
            <strong>{viewerTitle}</strong>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="document-viewer-body">
          {imageDocument ? (
            <img src={src} alt={title} className="document-viewer-image" />
          ) : pdfDocument ? (
            <object data={src} type={contentType || "application/pdf"} className="document-viewer-frame">
              <iframe src={src} title={title} className="document-viewer-frame" />
            </object>
          ) : (
            <iframe src={src} title={title} className="document-viewer-frame" />
          )}
        </div>
    </ModalTransition>
  );
}
