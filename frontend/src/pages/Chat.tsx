import { FormEvent, useEffect, useRef, useState } from "react";

import { getChatWebSocketUrl } from "../config/endpoints";
import { usePreferences } from "../context/PreferencesContext";
import { fetchMessages, postMessage } from "../services/api";
import type { ChatMessage } from "../types";

export default function Chat() {
  const { t, language } = usePreferences();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [senderName, setSenderName] = useState("Client PharmiGo");
  const [message, setMessage] = useState("");
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    async function loadMessages() {
      const data = await fetchMessages();
      setMessages(data);
    }

    void loadMessages();
  }, []);

  useEffect(() => {
    const socket = new WebSocket(getChatWebSocketUrl("public-room"));
    socketRef.current = socket;

    socket.onopen = () => setIsRealtimeConnected(true);
    socket.onclose = () => setIsRealtimeConnected(false);
    socket.onerror = () => setIsRealtimeConnected(false);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { message: string; sender: string };
        setMessages((current) => [
          ...current,
          {
            id: Date.now(),
            pharmacy: null,
            sender_name: payload.sender,
            sender_role: "pharmacy",
            message: payload.message,
            created_at: new Date().toISOString(),
          },
        ]);
      } catch {
        setIsRealtimeConnected(false);
      }
    };

    return () => socket.close();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) {
      return;
    }

    const created = await postMessage({
      sender_name: senderName,
      sender_role: "customer",
      message,
      pharmacy: null,
    });

    setMessages((current) => [...current, created]);

    if (socketRef.current && isRealtimeConnected) {
      socketRef.current.send(JSON.stringify({ message, sender: senderName }));
    }

    setMessage("");
  }

  return (
    <section className="stack">
      <div className="section-heading">
        <h2>{t("chat.title")}</h2>
        <p>{t("chat.subtitle")}</p>
        <div className="status-indicator">
          <span className={isRealtimeConnected ? "badge success" : "badge"}>
            {isRealtimeConnected ? t("chat.connected") : t("chat.disconnected")}
          </span>
        </div>
      </div>

      <div className="chat-panel">
        <div className="chat-feed">
          {messages.length === 0 ? (
            <p className="empty-state">{t("common.empty")}</p>
          ) : (
            messages.map((item) => (
              <article key={item.id} className="chat-bubble">
                <div className="card-row">
                  <strong>{item.sender_name}</strong>
                  <span>{new Date(item.created_at).toLocaleString(language === "en" ? "en-US" : "fr-FR")}</span>
                </div>
                <p>{item.message}</p>
              </article>
            ))
          )}
        </div>

        <form className="stack form-card" onSubmit={handleSubmit}>
          <label>
            <span>{t("chat.name")}</span>
            <input value={senderName} onChange={(event) => setSenderName(event.target.value)} />
          </label>
          <label>
            <span>{t("chat.message")}</span>
            <textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} required />
          </label>
          <button className="primary-button" type="submit">
            {t("chat.send")}
          </button>
        </form>
      </div>
    </section>
  );
}
