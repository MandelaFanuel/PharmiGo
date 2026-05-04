import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

import { appMotion, usePrefersReducedMotion } from "../lib/appMotion";

type AnimatedPageProps = {
  children: ReactNode;
  className?: string;
};

export default function AnimatedPage({ children, className }: AnimatedPageProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isVisible, setIsVisible] = useState(prefersReducedMotion);

  useEffect(() => {
    if (prefersReducedMotion) {
      setIsVisible(true);
      return undefined;
    }

    setIsVisible(false);
    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [prefersReducedMotion]);

  return (
    <div
      className={["app-motion-page", isVisible ? "is-visible" : "", className].filter(Boolean).join(" ")}
      style={
        {
          "--app-motion-duration": `${appMotion.durationMs}ms`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
