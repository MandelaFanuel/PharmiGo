import { useEffect, useState } from "react";

import ChatBot from "./ChatBot";
import { usePreferences } from "../context/PreferencesContext";

import "../styles/chatbot.css";

const guardianMessages = [
  "La plateforme est sous surveillance accrue.",
  "Assistant PharmiGo en veille temps reel.",
  "Chaque ordonnance est suivie instantanement.",
];

export default function ChatBotButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [guardianMessageIndex, setGuardianMessageIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const { t, language } = usePreferences();

  const localizedGuardianMessages = {
    fr: guardianMessages,
    en: [
      "The platform is under active monitoring.",
      "PharmiGo assistant is standing by in real time.",
      "Every prescription is tracked instantly.",
    ],
    rn: [
      "Urubuga ruriko rurakurikiranwa cane.",
      "Assistant PharmiGo arindiriye mu kanya nyako.",
      "Buri ordonnance ikurikiranywe ubwo nyene.",
    ],
    sw: [
      "Jukwaa linafuatiliwa kwa karibu.",
      "Msaidizi wa PharmiGo yuko tayari kwa wakati halisi.",
      "Kila preskripsheni inafuatiliwa papo hapo.",
    ],
    ln: [
      "Plateforme ezali kolandama penza.",
      "Assistant PharmiGo azali kozela na tango ya solo.",
      "Ordonnance moko na moko elandamaka mbala moko.",
    ],
  }[language];

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

  useEffect(() => {
    if (isPaused) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setGuardianMessageIndex((current) => (current + 1) % localizedGuardianMessages.length);
    }, 10000);

    return () => window.clearInterval(interval);
  }, [isPaused, localizedGuardianMessages.length]);

  return (
    <>
      <button
        className={isPaused ? "chatbot-toggle paused" : "chatbot-toggle"}
        onClick={toggleChat}
        aria-label={isOpen ? "Fermer le chat" : "Ouvrir le chat"}
        title={t("chatbot.open") || "Discuter avec l'assistant"}
      >
        <span className="chatbot-toggle-core">
          <img src="/chatbot-guardian.png" alt="" className="chatbot-toggle-image" />
          <span className="chatbot-toggle-pulse" aria-hidden="true" />
        </span>
        <span className="chatbot-toggle-label">{isOpen ? "Fermer" : "Assistant"}</span>
        {!isPaused ? <span className="chatbot-guardian-whisper" key={guardianMessageIndex}>{localizedGuardianMessages[guardianMessageIndex]}</span> : null}
      </button>

      <ChatBot isOpen={isOpen} onClose={closeChat} />
    </>
  );
}
