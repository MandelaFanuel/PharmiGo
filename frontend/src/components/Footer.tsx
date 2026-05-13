import { Link } from "react-router-dom";

import { usePreferences } from "../context/PreferencesContext";

function WhatsAppOutline() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <path d="M12 3.5a8.5 8.5 0 0 1 7.3 12.8L20.5 21l-4.9-1.3A8.5 8.5 0 1 1 12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 8.9c.2-.4.4-.4.7-.4h.6c.2 0 .4 0 .6.4.2.4.7 1.7.8 1.8.1.2.1.4 0 .6l-.4.5c-.1.1-.2.3 0 .6.3.5.8 1.1 1.4 1.6.7.6 1.4.9 1.9 1.1.3.1.5 0 .6-.1l.6-.7c.2-.2.4-.2.6-.1l1.7.8c.2.1.4.2.4.4 0 .2 0 1.1-.7 1.6-.7.5-1.5.5-2 .4-.5-.1-1.3-.4-2.6-1.1-1.7-.9-2.8-2.5-3.2-3.2-.4-.6-.9-1.7-.9-2.6 0-.9.5-1.3.7-1.6Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinkedInOutline() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <rect x="4" y="4" width="16" height="16" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10v6M8 7.5v.01M12 16v-6m0 0h2.4A2.6 2.6 0 0 1 17 12.6V16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailOutline() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-svg-icon">
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m5.5 8 6.5 5 6.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
            <span>+25769096758</span>
            <span>contact@pharmigo.com</span>
            <span>Burundi, Tanzanie, RDCongo</span>
            <span>www.pharmigo.com</span>
          </div>
          <div className="landing-inline-footer-socials">
            <a href="https://wa.me/25769096758" target="_blank" rel="noreferrer" aria-label="WhatsApp PharmiGo">
              <WhatsAppOutline />
              <span>WhatsApp</span>
            </a>
            <a href="https://www.linkedin.com/company/pharmigo" target="_blank" rel="noreferrer" aria-label="LinkedIn PharmiGo">
              <LinkedInOutline />
              <span>LinkedIn</span>
            </a>
            <a href="mailto:pharmigo@gmail.com" aria-label="Gmail PharmiGo">
              <MailOutline />
              <span>Gmail</span>
            </a>
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
        <span>{t("footer.bottom")} · © PharmiGo, tous droits réservés.</span>
      </div>
    </footer>
  );
}
