import { Children, useEffect, useState, type ReactNode } from "react";

type DashboardNavItem = {
  id: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
};

type DashboardNavSection = {
  title: string;
  items: DashboardNavItem[];
};

type DashboardMetric = {
  label: string;
  value: ReactNode;
  helper?: string;
};

type DashboardHighlight = {
  title: string;
  helper: string;
  meta?: string;
};

export function DashboardPanel({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `dashboard-panel ${className}` : "dashboard-panel"}>
      <div className="dashboard-panel-head">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function RefreshGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="dashboard-refresh-icon">
      <path
        d="M20 11a8 8 0 1 1-2.34-5.66M20 4v5h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="dashboard-eye-icon">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

export function MessageGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="dashboard-message-icon">
      <path
        d="M5 6.75h14a1.75 1.75 0 0 1 1.75 1.75v7a1.75 1.75 0 0 1-1.75 1.75H11.9L7.2 20.5a.7.7 0 0 1-1.1-.57V17.25H5A1.75 1.75 0 0 1 3.25 15.5v-7A1.75 1.75 0 0 1 5 6.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.75 10h8.5M7.75 13h5.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export default function DashboardScaffold({
  brand,
  pageTitle,
  pageSubtitle,
  roleLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  profileLabel,
  profileMeta,
  profileImageUrl,
  profileIsOnline,
  navSections,
  footerSections,
  metrics,
  highlights,
  topbarActions,
  heroActions,
  children,
}: {
  brand: string;
  pageTitle: string;
  pageSubtitle: string;
  roleLabel: string;
  searchPlaceholder: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  profileLabel: string;
  profileMeta: string;
  profileImageUrl?: string | null;
  profileIsOnline?: boolean;
  navSections: DashboardNavSection[];
  footerSections?: DashboardNavSection[];
  metrics: DashboardMetric[];
  highlights?: DashboardHighlight[];
  topbarActions?: ReactNode;
  heroActions?: ReactNode;
  children: ReactNode;
}) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const topbarActionItems = topbarActions ? Children.toArray(topbarActions).filter(Boolean) : [];
  const heroActionItems = heroActions ? Children.toArray(heroActions).filter(Boolean) : [];
  const heroActionClassName = heroActionItems.length > 1 ? "dashboard-actions dashboard-actions-paired" : "dashboard-actions dashboard-actions-single";

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;

    if (isMobileNavOpen) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [isMobileNavOpen]);

  return (
    <div className="dashboard-frame">
      <aside className={isMobileNavOpen ? "dashboard-sidebar mobile-open" : "dashboard-sidebar"}>
        <div className="dashboard-sidebar-head">
          <div className="dashboard-sidebar-brand">{brand}</div>
          <button type="button" className="dashboard-sidebar-close" onClick={() => setIsMobileNavOpen(false)} aria-label="Fermer le menu">
            ×
          </button>
        </div>
        <div className="dashboard-sidebar-sections">
          {navSections.map((section) => (
            <section key={section.title} className="dashboard-sidebar-group">
              <p className="dashboard-sidebar-title">{section.title}</p>
              <div className="dashboard-sidebar-links">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.active ? "dashboard-sidebar-link active" : "dashboard-sidebar-link"}
                    onClick={() => {
                      item.onClick?.();
                      setIsMobileNavOpen(false);
                    }}
                  >
                    <span className="dashboard-sidebar-link-dot" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        {footerSections?.length ? (
          <div className="dashboard-sidebar-footer">
            {footerSections.map((section) => (
              <section key={`footer-${section.title}`} className="dashboard-sidebar-group">
                <p className="dashboard-sidebar-title">{section.title}</p>
                <div className="dashboard-sidebar-links">
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.active ? "dashboard-sidebar-link active" : "dashboard-sidebar-link"}
                      onClick={() => {
                        item.onClick?.();
                        setIsMobileNavOpen(false);
                      }}
                    >
                      <span className="dashboard-sidebar-link-dot" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </aside>

      {isMobileNavOpen ? (
        <button type="button" className="dashboard-mobile-backdrop" onClick={() => setIsMobileNavOpen(false)} aria-label="Fermer le menu" />
      ) : null}

      <div className="dashboard-stage">
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-summary">
            <div className="dashboard-topbar-main">
              <button
                type="button"
                className="dashboard-mobile-toggle"
                onClick={() => setIsMobileNavOpen((current) => !current)}
                aria-label="Ouvrir le menu"
                aria-expanded={isMobileNavOpen}
              >
                <span />
                <span />
                <span />
              </button>
              <div className="dashboard-topbar-profile">
                <div className="dashboard-topbar-avatar-wrap">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt={profileLabel} className="dashboard-topbar-avatar-image" />
                  ) : (
                    <div className="dashboard-topbar-avatar">{profileLabel.slice(0, 1).toUpperCase()}</div>
                  )}
                  <span className={profileIsOnline ? "dashboard-presence-dot online" : "dashboard-presence-dot"} aria-label={profileIsOnline ? "En ligne" : "Hors ligne"} />
                </div>
                <div>
                  <strong>{profileLabel}</strong>
                  <small>{profileMeta}</small>
                </div>
              </div>
            </div>
            <div className="dashboard-topbar-trailing">
              {topbarActionItems.length ? <div className="dashboard-topbar-actions">{topbarActionItems}</div> : null}
            </div>
          </div>
          <label className="dashboard-topbar-search" aria-label={searchPlaceholder}>
            <span className="dashboard-topbar-search-icon" aria-hidden="true">⌕</span>
            <input
              type="text"
              value={searchValue ?? ""}
              placeholder={searchPlaceholder}
              onChange={(event) => onSearchChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && searchValue) {
                  onSearchChange?.("");
                }
              }}
            />
            {searchValue ? (
              <button
                type="button"
                className="dashboard-topbar-search-clear"
                onClick={() => onSearchChange?.("")}
                aria-label="Effacer la recherche"
              >
                ×
              </button>
            ) : null}
          </label>
        </header>

        {heroActionItems.length ? (
          <section className="dashboard-hero-card dashboard-hero-card-actions-only">
            <div className={heroActionClassName}>{heroActionItems}</div>
          </section>
        ) : null}

        <section className="dashboard-metrics-grid">
          {metrics.map((metric) => (
            <article key={metric.label} className="dashboard-metric-card">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.helper ? <small>{metric.helper}</small> : null}
            </article>
          ))}
        </section>

        {highlights?.length ? (
          <section className="dashboard-highlight-grid">
            {highlights.map((highlight) => (
              <article key={`${highlight.title}-${highlight.meta ?? ""}`} className="dashboard-highlight-card">
                <div className="dashboard-highlight-badge" aria-hidden="true" />
                <div>
                  <strong>{highlight.title}</strong>
                  <p>{highlight.helper}</p>
                  {highlight.meta ? <small>{highlight.meta}</small> : null}
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <div className="dashboard-content-grid">{children}</div>
      </div>
    </div>
  );
}
