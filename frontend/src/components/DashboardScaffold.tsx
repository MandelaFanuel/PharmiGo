import { useState, type ReactNode } from "react";

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
  metrics,
  highlights,
  actions,
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
  metrics: DashboardMetric[];
  highlights?: DashboardHighlight[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  return (
    <div className="dashboard-frame">
      <aside className={isMobileNavOpen ? "dashboard-sidebar mobile-open" : "dashboard-sidebar"}>
        <div className="dashboard-sidebar-brand">{brand}</div>
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
        <div className="dashboard-sidebar-footer">
          <button type="button" className="dashboard-sidebar-link" onClick={() => setIsMobileNavOpen(false)}>
            <span className="dashboard-sidebar-link-dot" aria-hidden="true" />
            <span>Configuration</span>
          </button>
        </div>
      </aside>

      {isMobileNavOpen ? (
        <button type="button" className="dashboard-mobile-backdrop" onClick={() => setIsMobileNavOpen(false)} aria-label="Fermer le menu" />
      ) : null}

      <div className="dashboard-stage">
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-main">
            <button
              type="button"
              className="dashboard-mobile-toggle"
              onClick={() => setIsMobileNavOpen((current) => !current)}
              aria-label="Ouvrir le menu"
            >
              <span />
              <span />
              <span />
            </button>
            <div className="dashboard-topbar-title">{pageTitle}</div>
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
        </header>

        <section className="dashboard-hero-card">
          <div>
            <span className="dashboard-eyebrow">{roleLabel}</span>
            <h2>{pageTitle}</h2>
            <p className="dashboard-subtitle">{pageSubtitle}</p>
          </div>
          {actions ? <div className="dashboard-actions">{actions}</div> : null}
        </section>

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
