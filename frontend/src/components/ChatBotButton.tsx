import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import ChatBot from "./ChatBot";
import { usePreferences } from "../context/PreferencesContext";

import "../styles/chatbot.css";

export default function ChatBotButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const { t } = usePreferences();
  const portalTarget = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);

  const toggleChat = () => setIsOpen(!isOpen);
  const closeChat = () => setIsOpen(false);

  useEffect(() => {
    function openChat() {
      setIsOpen(true);
    }

    function pauseChatbot() {
      setIsPaused(true);
    }

    function resumeChatbot() {
      setIsPaused(false);
    }

    window.addEventListener("open-chatbot", openChat);
    window.addEventListener("prescription-upload:start", pauseChatbot);
    window.addEventListener("prescription-upload:end", resumeChatbot);
    return () => {
      window.removeEventListener("open-chatbot", openChat);
      window.removeEventListener("prescription-upload:start", pauseChatbot);
      window.removeEventListener("prescription-upload:end", resumeChatbot);
    };
  }, []);

  const floatingNode = (
    <>
      <button
        className={isPaused ? "chatbot-toggle paused" : "chatbot-toggle"}
        onClick={toggleChat}
        aria-label={isOpen ? "Fermer le chat" : "Ouvrir le chat"}
        title={t("chatbot.open") || "Ouvrir PharmiGo"}
      >
        <span className="chatbot-toggle-core">
          <img src="/chatbot-guardian.png" alt="" className="chatbot-toggle-image" />
          <span className="chatbot-toggle-pulse" aria-hidden="true" />
        </span>
      </button>

      <ChatBot isOpen={isOpen} onClose={closeChat} />
    </>
  );

  if (!portalTarget) {
    return floatingNode;
  }

  return createPortal(floatingNode, portalTarget);
}
