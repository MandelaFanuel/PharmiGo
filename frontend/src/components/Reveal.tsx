import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

import { appMotion, usePrefersReducedMotion } from "../lib/appMotion";

type RevealProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
  id?: string;
  once?: boolean;
  durationMs?: number;
};

export default function Reveal({
  children,
  className,
  as: Component = "div",
  id,
  once = true,
  durationMs = appMotion.revealDurationMs,
}: RevealProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isVisible, setIsVisible] = useState(prefersReducedMotion);
  const nodeRef = useRef<HTMLElement | null>(null);
  const attachNodeRef = (node: Element | null) => {
    nodeRef.current = node as HTMLElement | null;
  };

  useEffect(() => {
    if (prefersReducedMotion) {
      setIsVisible(true);
      return undefined;
    }

    const target = nodeRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) {
          return;
        }

        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) {
            observer.unobserve(entry.target);
          }
          return;
        }

        if (!once) {
          setIsVisible(false);
        }
      },
      {
        threshold: appMotion.viewportThreshold,
        rootMargin: appMotion.viewportRootMargin,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [once, prefersReducedMotion]);

  return (
    <Component
      ref={attachNodeRef}
      id={id}
      className={["app-reveal", isVisible ? "is-visible" : "", className].filter(Boolean).join(" ")}
      style={
        {
          "--app-motion-duration": `${Math.min(durationMs, appMotion.maxRevealDurationMs)}ms`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
}
