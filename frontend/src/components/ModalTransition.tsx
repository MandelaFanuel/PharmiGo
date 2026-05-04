import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { appMotion, usePrefersReducedMotion } from "../lib/appMotion";

type ModalTransitionProps = {
  children: ReactNode;
  overlayClassName: string;
  panelClassName: string;
  ariaLabel: string;
  onBackdropClick?: () => void;
  role?: "dialog" | "alertdialog";
  durationMs?: number;
};

export default function ModalTransition({
  children,
  overlayClassName,
  panelClassName,
  ariaLabel,
  onBackdropClick,
  role = "dialog",
  durationMs = appMotion.durationMs,
}: ModalTransitionProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isVisible, setIsVisible] = useState(prefersReducedMotion);
  const portalTarget = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setIsVisible(true);
      return undefined;
    }

    setIsVisible(false);
    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [prefersReducedMotion]);

  const modalNode = (
    <div
      className={["app-modal-overlay", overlayClassName, isVisible ? "is-visible" : ""].filter(Boolean).join(" ")}
      role={role}
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onBackdropClick}
      style={
        {
          "--app-motion-duration": `${durationMs}ms`,
        } as CSSProperties
      }
    >
      <div
        className={["app-modal-panel", panelClassName, isVisible ? "is-visible" : ""].filter(Boolean).join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  if (!portalTarget) {
    return modalNode;
  }

  return createPortal(modalNode, portalTarget);
}
