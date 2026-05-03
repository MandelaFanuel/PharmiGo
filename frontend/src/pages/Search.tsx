import { useEffect, useState } from "react";

import NotificationToast from "../components/NotificationToast";
import PharmacyList from "../components/PharmacyList";
import { usePreferences } from "../context/PreferencesContext";
import { fetchNotifications, fetchPharmacies } from "../services/api";
import type { Notification, Pharmacy } from "../types";

export default function Search() {
  const { t } = usePreferences();
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [query, setQuery] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [pharmacyData, notificationData] = await Promise.all([
          fetchPharmacies(),
          fetchNotifications(),
        ]);
        setPharmacies(pharmacyData);
        setNotifications(notificationData.slice(0, 2));
      } catch {
        setError("Impossible de charger les donnees pour le moment.");
      }
    }

    void loadData();
  }, []);

  const filteredPharmacies = pharmacies.filter((pharmacy) =>
    `${pharmacy.name} ${pharmacy.city} ${pharmacy.address}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <section className="stack">
      <div className="section-heading">
        <h2>{t("search.title")}</h2>
        <p>{t("search.subtitle")}</p>
      </div>
      <div className="search-bar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search.placeholder")}
        />
      </div>
      {error ? <NotificationToast message={error} /> : null}
      {notifications.map((notification) => (
        <NotificationToast key={notification.id} message={`${notification.title}: ${notification.message}`} />
      ))}
      <PharmacyList pharmacies={filteredPharmacies} />
    </section>
  );
}
