import { Link } from "react-router-dom";

import { usePreferences } from "../context/PreferencesContext";

export default function Footer() {
  const { t } = usePreferences();

  return (
    <footer className="site-footer pharmigo-footer">
      <div className="pharmigo-footer-grid">
        <section className="pharmigo-footer-brand">
          <div className="pharmigo-footer-logo">
            <div className="pharmigo-brand-mark small" aria-hidden="true">
              <span className="pharmigo-brand-plus" />
              <span className="pharmigo-brand-pill" />
            </div>
            <div>
              <strong>{t("brand.name")}</strong>
              <span>{t("footer.brandSub")}</span>
            </div>
          </div>
          <p>{t("footer.copy")}</p>
        </section>

        <section>
          <h3>{t("footer.quickLinks")}</h3>
          <div className="pharmigo-footer-links">
            <Link to="/">{t("nav.home")}</Link>
            <Link to="/upload-prescription">{t("nav.upload")}</Link>
            <Link to="/search">{t("nav.search")}</Link>
            <Link to="/chat">{t("nav.chat")}</Link>
            <Link to="/operations">{t("nav.operations")}</Link>
          </div>
        </section>

        <section>
          <h3>{t("footer.office")}</h3>
          <div className="pharmigo-footer-office">
            <span>+257 79 180 000</span>
            <span>contact@pharmigo.app</span>
            <span>Bujumbura, Burundi</span>
            <span>Kigali, Goma, Bujumbura</span>
          </div>
        </section>

        <section>
          <h3>{t("footer.newsletterTitle")}</h3>
          <p>{t("footer.newsletterCopy")}</p>
          <form className="pharmigo-newsletter" onSubmit={(event) => event.preventDefault()}>
            <input type="email" placeholder={t("footer.newsletterPlaceholder")} />
            <button type="submit">{t("footer.newsletterButton")}</button>
          </form>
        </section>
      </div>

      <div className="pharmigo-footer-bottom">
        <span>{t("footer.bottom")}</span>
      </div>
    </footer>
  );
}
