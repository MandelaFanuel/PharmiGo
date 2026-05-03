import { useEffect } from "react";

type InAppDocumentViewerProps = {
  title: string;
  src: string | null;
  onClose: () => void;
};

function isImageDocument(url: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

function isPdfDocument(url: string) {
  return /\.pdf(\?.*)?$/i.test(url);
}

export default function InAppDocumentViewer({ title, src, onClose }: InAppDocumentViewerProps) {
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

  const imageDocument = isImageDocument(src);
  const pdfDocument = isPdfDocument(src);

  return (
    <div className="document-viewer-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="document-viewer-dialog">
        <div className="document-viewer-head">
          <div>
            <span className="document-viewer-kicker">Ordonnance originale</span>
            <strong>{title}</strong>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="document-viewer-body">
          {imageDocument ? (
            <img src={src} alt={title} className="document-viewer-image" />
          ) : pdfDocument ? (
            <iframe src={src} title={title} className="document-viewer-frame" />
          ) : (
            <iframe src={src} title={title} className="document-viewer-frame" />
          )}
        </div>
      </div>
    </div>
  );
}
