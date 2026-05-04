import { useEffect, useMemo, useRef, useState } from "react";

import { askChatbotQuestion, fetchChatMessages, fetchPrescriptionAnalysisTask, selectPrescriptionPharmacy, submitPrescription } from "../services/api";
import { usePreferences } from "../context/PreferencesContext";
import { getStoredCurrentUser } from "../lib/auth";
import { formatExactDateTime } from "../lib/datetime";
import { logClientError } from "../lib/logger";
import OcrResultModal from "./OcrResultModal";
import type { ChatBotMessage, MatchedPharmacy, PrescriptionBotResult, PrescriptionRecord } from "../types";

interface ChatBotProps {
  isOpen: boolean;
  onClose: () => void;
}

type WorkflowState = "idle" | "uploading" | "selection";
type ChatIdentity = { scope: "guest" | "user"; id: string };

const CHATBOT_HISTORY_KEY_PREFIX = "pharmigo.chatbot.history.v1";
const CHATBOT_ARCHIVE_HOURS = 6;
const CHATBOT_MAX_STORED_MESSAGES = 250;
const CHATBOT_RECENT_LOOKBACK_MS = CHATBOT_ARCHIVE_HOURS * 60 * 60 * 1000;

function getChatIdentity(): ChatIdentity {
  const storedUser = getStoredCurrentUser();
  if (!storedUser) {
    return { scope: "guest", id: "guest" };
  }

  const userIdentity =
    storedUser.email ||
    storedUser.username ||
    `${storedUser.profile?.role ?? "user"}-${storedUser.id ?? "session"}`;

  return {
    scope: "user",
    id: userIdentity.replace(/[^a-zA-Z0-9_.-]+/g, "_").toLowerCase(),
  };
}

function getChatHistoryStorageKey(identity: ChatIdentity) {
  return `${CHATBOT_HISTORY_KEY_PREFIX}.${identity.scope}.${identity.id}`;
}

function normalizeStoredChatMessage(value: unknown): ChatBotMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ChatBotMessage>;
  if ((candidate.sender !== "user" && candidate.sender !== "bot") || typeof candidate.message !== "string" || typeof candidate.created_at !== "string") {
    return null;
  }

  return {
    id: typeof candidate.id === "number" ? candidate.id : Date.now() + Math.floor(Math.random() * 1000),
    sender: candidate.sender,
    message: candidate.message,
    created_at: candidate.created_at,
  };
}

function loadStoredChatHistory(storageKey: string) {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [] as ChatBotMessage[];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(normalizeStoredChatMessage)
      .filter((message): message is ChatBotMessage => Boolean(message))
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
      .slice(-CHATBOT_MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

function storeChatHistory(storageKey: string, messages: ChatBotMessage[]) {
  const trimmedMessages = [...messages]
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .slice(-CHATBOT_MAX_STORED_MESSAGES);
  localStorage.setItem(storageKey, JSON.stringify(trimmedMessages));
}

function mergeChatHistories(...collections: ChatBotMessage[][]) {
  const deduped = new Map<string, ChatBotMessage>();
  collections.flat().forEach((message) => {
    const key = `${message.sender}:${message.created_at}:${message.message}`;
    if (!deduped.has(key)) {
      deduped.set(key, message);
    }
  });
  return Array.from(deduped.values())
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .slice(-CHATBOT_MAX_STORED_MESSAGES);
}

function isArchivedMessage(createdAt: string, now = Date.now()) {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  const createdDate = new Date(createdAtMs);
  const nowDate = new Date(now);
  const isDifferentDay =
    createdDate.getFullYear() !== nowDate.getFullYear() ||
    createdDate.getMonth() !== nowDate.getMonth() ||
    createdDate.getDate() !== nowDate.getDate();

  return isDifferentDay || now - createdAtMs >= CHATBOT_RECENT_LOOKBACK_MS;
}

function getArchiveSectionLabel(createdAt: string, language: "fr" | "en" | "rn" | "sw" | "ln") {
  const date = new Date(createdAt);
  const locale = language === "en" ? "en-US" : "fr-FR";
  return date.toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export default function ChatBot({ isOpen, onClose }: ChatBotProps) {
  const { language } = usePreferences();
  const labels = {
    fr: {
      welcome:
        "Bienvenue sur PharmiGo. Je surveille les ordonnances en temps reel. Posez une question sur un medicament ou chargez une ordonnance pour recevoir une reponse exacte sur les pharmacies et leurs adresses.",
      uploadInstruction:
        "Chargez maintenant une image d'ordonnance. Je vais l'analyser immediatement puis vous afficher les pharmacies exactes qui ont les medicaments.",
      uploadSentPrefix: "J'ai envoye l'ordonnance",
      noStructuredResult: "Analyse terminee, mais aucun resultat structure n'a ete recu.",
      foundPharmaciesPrefix: "Les pharmacies trouvees sont :",
      uploadFailed: "Je n'ai pas pu analyser cette ordonnance. Verifiez le fichier et reessayez.",
      requestFailed:
        "Je n'ai pas pu traiter cette demande pour le moment. Essayez avec le nom du medicament ou chargez une ordonnance.",
      selectionSending: "Transmission...",
      selectionCta: "Choisir cette pharmacie",
      selectionFailed: "Je n'ai pas pu transmettre votre choix a la pharmacie. Reessayez dans quelques secondes.",
      uploadHint: "Je reponds ensuite avec les pharmacies exactes et leurs adresses.",
      uploadTitle: "Chargez votre ordonnance ici",
      recentTitle: "Conversation recente",
      archiveTitle: "Voir les conversations passees",
      archiveHide: "Masquer les archives",
      archiveBackToRecent: "Voir les discussions recentes",
      archiveEmpty: "Aucune conversation archivee pour le moment.",
      noRecentConversation: "Les conversations plus anciennes sont archivees ci-dessous.",
      placeholder: "Posez votre question sur un medicament ou tapez analyser",
      send: "Envoyer",
      close: "Fermer",
      online: "En ligne",
      title: "Assistant PharmiGo",
      chosenPrefix: "Je choisis",
      selectionSuccessPrefix: "Votre ordonnance a ete envoyee a",
    },
    en: {
      welcome:
        "Welcome to PharmiGo. I monitor prescriptions in real time. Ask about a medicine or upload a prescription to receive an exact answer with matching pharmacies and addresses.",
      uploadInstruction:
        "Upload the prescription image now. I will analyze it immediately and show you the exact pharmacies that have the medicine.",
      uploadSentPrefix: "I sent the prescription",
      noStructuredResult: "Analysis completed, but no structured result was received.",
      foundPharmaciesPrefix: "The pharmacies found are:",
      uploadFailed: "I could not analyze this prescription. Check the file and try again.",
      requestFailed: "I could not process this request right now. Try the medicine name or upload a prescription.",
      selectionSending: "Sending...",
      selectionCta: "Choose this pharmacy",
      selectionFailed: "I could not send your choice to the pharmacy. Please try again in a few seconds.",
      uploadHint: "I will then reply with the exact pharmacies and their addresses.",
      uploadTitle: "Upload your prescription here",
      recentTitle: "Recent conversation",
      archiveTitle: "View past conversations",
      archiveHide: "Hide archives",
      archiveBackToRecent: "View recent conversations",
      archiveEmpty: "No archived conversations yet.",
      noRecentConversation: "Older conversations are archived below.",
      placeholder: "Ask about a medicine or type analyze",
      send: "Send",
      close: "Close",
      online: "Online",
      title: "PharmiGo Assistant",
      chosenPrefix: "I choose",
      selectionSuccessPrefix: "Your prescription has been sent to",
    },
    rn: {
      welcome:
        "Murakaza neza kuri PharmiGo. Nkurikirana ordonnances mu kanya nyako. Baza ikibazo kuri medicament canke ushiremwo ordonnance kugira uronke inyishu itomoye ku mafaranga n'aderesi.",
      uploadInstruction:
        "Shiramwo ubu ifoto y'ordonnance. Nca nyisesangura ningoga maze nkwereke amafarumasi nyayo afise iyo miti.",
      uploadSentPrefix: "Nohereje ordonnance",
      noStructuredResult: "Isesengura ryarangiye ariko nta gisubizo gitunganijwe cabonetse.",
      foundPharmaciesPrefix: "Amafarumasi yabonetse ni aya:",
      uploadFailed: "Sinashoboye gusesangura iyi ordonnance. Suzuma fichier wongere ugerageze.",
      requestFailed:
        "Sinashoboye gutunganya ubu busabe. Gerageza izina ry'umuti canke ushiremwo ordonnance.",
      selectionSending: "Biriko biratangwa...",
      selectionCta: "Hitamwo iyi farumasi",
      selectionFailed: "Sinashoboye kurungikira farumasi amahitamwo yawe. Ongera ugerageze mu kanya.",
      uploadHint: "Nca nguha amafarumasi nyayo n'aderesi zayo.",
      uploadTitle: "Shiramwo ordonnance yawe hano",
      recentTitle: "Ikiganiro giheruka",
      archiveTitle: "Raba ibiganiro vya kera",
      archiveHide: "Hisha archives",
      archiveBackToRecent: "Raba ibiganiro vya vuba",
      archiveEmpty: "Nta biganiro vya kera biraboneka.",
      noRecentConversation: "Ibiganiro vya kera bibitswe hepfo.",
      placeholder: "Baza ikibazo kuri medicament canke wandike analyser",
      send: "Rungika",
      close: "Funga",
      online: "Kuri internet",
      title: "Assistant PharmiGo",
      chosenPrefix: "Nhitamwo",
      selectionSuccessPrefix: "Ordonnance yawe yarungikiwe",
    },
    sw: {
      welcome:
        "Karibu PharmiGo. Ninafuatilia preskripsheni kwa wakati halisi. Uliza kuhusu dawa au pakia preskripsheni ili upate jibu sahihi la maduka ya dawa na anwani zao.",
      uploadInstruction:
        "Pakia picha ya preskripsheni sasa. Nitachambua mara moja kisha nikuonyeshe maduka sahihi yenye dawa hizo.",
      uploadSentPrefix: "Nimetuma preskripsheni",
      noStructuredResult: "Uchambuzi umekamilika lakini hakuna matokeo yaliyopangwa yaliyopokelewa.",
      foundPharmaciesPrefix: "Maduka ya dawa yaliyopatikana ni:",
      uploadFailed: "Sikuweza kuchambua preskripsheni hii. Kagua faili na ujaribu tena.",
      requestFailed:
        "Sikuweza kushughulikia ombi hili kwa sasa. Jaribu jina la dawa au pakia preskripsheni.",
      selectionSending: "Inatumwa...",
      selectionCta: "Chagua duka hili",
      selectionFailed: "Sikuweza kutuma chaguo lako kwa duka la dawa. Jaribu tena baada ya muda mfupi.",
      uploadHint: "Kisha nitajibu kwa maduka sahihi na anwani zao.",
      uploadTitle: "Pakia preskripsheni yako hapa",
      recentTitle: "Mazungumzo ya hivi karibuni",
      archiveTitle: "Tazama mazungumzo ya zamani",
      archiveHide: "Ficha kumbukumbu",
      archiveBackToRecent: "Tazama mazungumzo ya karibuni",
      archiveEmpty: "Hakuna mazungumzo ya zamani bado.",
      noRecentConversation: "Mazungumzo ya zamani yamehifadhiwa hapa chini.",
      placeholder: "Uliza kuhusu dawa au andika analyze",
      send: "Tuma",
      close: "Funga",
      online: "Mtandaoni",
      title: "Msaidizi wa PharmiGo",
      chosenPrefix: "Ninachagua",
      selectionSuccessPrefix: "Preskripsheni yako imetumwa kwa",
    },
    ln: {
      welcome:
        "Boyei malamu na PharmiGo. Nazali kolanda ba ordonnance na tango ya solo. Tuna motuna na kisi ya monganga to tinda ordonnance mpo ozwa eyano ya sikisiki na ba pharmacie mpe ba adresse na yango.",
      uploadInstruction:
        "Tinda sikoyo image ya ordonnance. Nakotalela yango mbala moko mpe nakolakisa yo ba pharmacie ya solo oyo bazali na ba kisi yango.",
      uploadSentPrefix: "Natindi ordonnance",
      noStructuredResult: "Analyse esili kasi eyano oyo ebongisami ezwama te.",
      foundPharmaciesPrefix: "Ba pharmacie oyo bamoni ezali:",
      uploadFailed: "Nakokaki te ko analyser ordonnance oyo. Tala fichier mpe meka lisusu.",
      requestFailed:
        "Nakokaki te kosala likambo oyo mpo na sikoyo. Meka na kombo ya kisi to tinda ordonnance.",
      selectionSending: "Ezali kotindama...",
      selectionCta: "Pona pharmacie oyo",
      selectionFailed: "Nakokaki te kotindela pharmacie maponi na yo. Meka lisusu mwa moke.",
      uploadHint: "Na nsima nakopesa yo ba pharmacie ya solo mpe ba adresse na yango.",
      uploadTitle: "Tinda ordonnance na yo awa",
      recentTitle: "Lisolo ya sika",
      archiveTitle: "Tala masolo ya kala",
      archiveHide: "Bomba archives",
      archiveBackToRecent: "Tala masolo ya sika",
      archiveEmpty: "Lisolo ya kala ezali te mpo na sikoyo.",
      noRecentConversation: "Masolo ya kala ebombami awa na se.",
      placeholder: "Tuna motuna na kisi to koma analyze",
      send: "Tinda",
      close: "Kanga",
      online: "Na internet",
      title: "Assistant PharmiGo",
      chosenPrefix: "Naponi",
      selectionSuccessPrefix: "Ordonnance na yo etindami epai ya",
    },
  }[language];
  const [messages, setMessages] = useState<ChatBotMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [workflowState, setWorkflowState] = useState<WorkflowState>("idle");
  const [analysisResult, setAnalysisResult] = useState<PrescriptionRecord | null>(null);
  const [availablePharmacies, setAvailablePharmacies] = useState<MatchedPharmacy[]>([]);
  const [selectionBusyId, setSelectionBusyId] = useState<number | null>(null);
  const [ocrModal, setOcrModal] = useState<{ ocrText: string; confidence: number; botResult: PrescriptionBotResult } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const historyIdentity = useMemo(() => getChatIdentity(), [isOpen]);
  const historyStorageKey = useMemo(() => getChatHistoryStorageKey(historyIdentity), [historyIdentity]);
  const recentMessages = useMemo(() => messages.filter((message) => !isArchivedMessage(message.created_at)), [messages]);
  const archivedMessages = useMemo(() => messages.filter((message) => isArchivedMessage(message.created_at)), [messages]);
  const archivedSections = useMemo(() => {
    const sections = new Map<string, ChatBotMessage[]>();
    archivedMessages.forEach((message) => {
      const sectionLabel = getArchiveSectionLabel(message.created_at, language);
      const existingSection = sections.get(sectionLabel) ?? [];
      existingSection.push(message);
      sections.set(sectionLabel, existingSection);
    });
    return Array.from(sections.entries());
  }, [archivedMessages, language]);

  useEffect(() => {
    let cancelled = false;

    if (!isOpen) {
      return () => {
        cancelled = true;
      };
    }

    const storedUser = getStoredCurrentUser();
    const localHistory = loadStoredChatHistory(historyStorageKey);
    const welcomeMessage = [
      {
        id: Date.now(),
        sender: "bot" as const,
        message: labels.welcome,
        created_at: new Date().toISOString(),
      },
    ];

    if (!storedUser) {
      setMessages(localHistory.length ? localHistory : welcomeMessage);
      return () => {
        cancelled = true;
      };
    }

    void fetchChatMessages()
      .then((history) => {
        if (cancelled) {
          return;
        }

        const mergedHistory = mergeChatHistories(localHistory, history);
        setMessages(mergedHistory.length ? mergedHistory : welcomeMessage);
      })
      .catch(() => {
        if (!cancelled) {
          setMessages(localHistory.length ? localHistory : welcomeMessage);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [historyStorageKey, isOpen, labels.welcome]);

  useEffect(() => {
    if (!isOpen || messages.length === 0) {
      return;
    }
    storeChatHistory(historyStorageKey, messages);
  }, [historyStorageKey, isOpen, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [recentMessages, workflowState, availablePharmacies.length]);

  useEffect(() => {
    if (!messagesContainerRef.current) {
      return;
    }

    messagesContainerRef.current.scrollTop = 0;
  }, [showArchived]);

  function addBotMessage(message: string) {
    setMessages((current) => [
      ...current,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        sender: "bot",
        message,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  function addUserMessage(message: string) {
    setMessages((current) => [
      ...current,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        sender: "user",
        message,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  async function handleSend() {
    const question = inputMessage.trim();
    if (!question || isLoading) {
      return;
    }

    addUserMessage(question);
    setInputMessage("");
    setIsLoading(true);

    try {
      if (question.toLowerCase().includes("analyser") || question.toLowerCase().includes("ordonnance")) {
        setWorkflowState("uploading");
        addBotMessage(labels.uploadInstruction);
      } else {
        const data = await askChatbotQuestion(question);
        addBotMessage(data.answer);
      }
    } catch (error) {
      void error;
      logClientError("La requete chatbot a echoue.");
      addBotMessage(labels.requestFailed);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFileUpload(file: File) {
    const storedUser = getStoredCurrentUser();
    addUserMessage(`${labels.uploadSentPrefix} ${file.name}.`);
    setWorkflowState("uploading");
    setIsLoading(true);

    try {
      const result = await submitPrescription({
        patient_name: storedUser?.username || "Patient",
        patient_email: storedUser?.email || "patient@pharmigo.local",
        medication_name: "Ordonnance médicale",
        dosage: "Analyse instantanée",
        instructions: "Analyse demandée depuis le chatbot PharmiGo.",
        prescription_file: file,
      });

      let completedResult = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const nextResult = await fetchPrescriptionAnalysisTask(result.task_id);
        if (["completed", "needs_confirmation", "failed"].includes(nextResult.task_status)) {
          completedResult = nextResult;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      const record = completedResult?.record ?? null;
      setAnalysisResult(record);
      const botResult = record?.bot_result;
      if (!botResult) {
        addBotMessage(labels.noStructuredResult);
        setWorkflowState("idle");
        return;
      }

      // Ouvrir le popup OCR avec le texte extrait et les médicaments reconnus
      setOcrModal({
        ocrText: record?.ocr_text ?? "",
        confidence: record?.confidence_score ?? 0,
        botResult,
      });
      setWorkflowState("idle");
    } catch (error) {
      void error;
      logClientError("L'envoi de l'ordonnance via le chatbot a echoue.");
      addBotMessage(labels.uploadFailed);
      setWorkflowState("idle");
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePharmacySelection(pharmacy: MatchedPharmacy) {
    if (!analysisResult) {
      return;
    }

    setSelectionBusyId(pharmacy.pharmacy_id);
    try {
      await selectPrescriptionPharmacy(analysisResult.id, pharmacy.pharmacy_id);
      addUserMessage(`${labels.chosenPrefix} ${pharmacy.name}.`);
      addBotMessage(`${labels.selectionSuccessPrefix} ${pharmacy.name}. Adresse : ${pharmacy.address}. Telephone : ${pharmacy.phone}.`);
      setWorkflowState("idle");
      setAvailablePharmacies([]);
    } catch (error) {
      void error;
      logClientError("La selection de la pharmacie a echoue.");
      addBotMessage(labels.selectionFailed);
    } finally {
      setSelectionBusyId(null);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  function handleOcrConfirm() {
    if (!ocrModal) return;
    const { botResult } = ocrModal;
    setOcrModal(null);
    addBotMessage(botResult.message);
    if (!botResult.is_valid_prescription) {
      setAvailablePharmacies([]);
      return;
    }
    const pharmacies = botResult.pharmacies ?? [];
    setAvailablePharmacies(pharmacies);
    if (pharmacies.length) {
      const exactList = pharmacies.map((p) => `${p.name} - ${p.address}`).join("\n");
      addBotMessage(`${labels.foundPharmaciesPrefix}\n${exactList}`);
      setWorkflowState("selection");
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="chatbot-container">
      {ocrModal ? (
        <OcrResultModal
          ocrText={ocrModal.ocrText}
          confidence={ocrModal.confidence}
          botResult={ocrModal.botResult}
          onClose={() => setOcrModal(null)}
          onConfirm={handleOcrConfirm}
        />
      ) : null}
      <div className="chatbot-window">
        <div className="chatbot-header">
          <div className="chatbot-header-info">
            <img src="/chatbot-guardian.png" alt="Assistant PharmiGo" className="chatbot-avatar-image" />
            <div>
              <h3 className="chatbot-title">{labels.title}</h3>
              <span className="chatbot-status">
                <span className="status-dot online"></span>
                {labels.online}
              </span>
            </div>
          </div>
          <div className="chatbot-header-actions">
            {archivedMessages.length ? (
              <button
                className="chatbot-archive-toggle"
                type="button"
                onClick={() => setShowArchived((current) => !current)}
              >
                {showArchived ? labels.archiveHide : labels.archiveTitle}
              </button>
            ) : null}
            <button className="chatbot-close-btn" onClick={onClose} aria-label={labels.close}>
              ✕
            </button>
          </div>
        </div>

        <div className="chatbot-messages" ref={messagesContainerRef}>
          {showArchived ? (
            <div className="chatbot-archive-panel">
              <button
                className="chatbot-inline-link"
                type="button"
                onClick={() => setShowArchived(false)}
              >
                {labels.archiveBackToRecent}
              </button>
              {archivedSections.length ? (
                archivedSections.map(([sectionLabel, sectionMessages]) => (
                  <section key={sectionLabel} className="chatbot-archive-section">
                    <header className="chatbot-archive-section-title">{sectionLabel}</header>
                    {sectionMessages.map((message) => (
                      <div key={message.id} className={`message ${message.sender === "user" ? "message-user" : "message-bot"} message-archived`}>
                        <div className="message-content">
                          {message.sender === "bot" ? (
                            <img src="/chatbot-guardian.png" alt="" className="message-avatar-image" />
                          ) : null}
                          <div className="message-text">{formatMessage(message.message)}</div>
                          <span className="message-time">{formatExactDateTime(message.created_at, language)}</span>
                        </div>
                      </div>
                    ))}
                  </section>
                ))
              ) : (
                <div className="chatbot-empty-state">{labels.archiveEmpty}</div>
              )}
            </div>
          ) : (
            <>
              <div className="chatbot-recent-label">{labels.recentTitle}</div>

              {recentMessages.length === 0 && archivedMessages.length ? (
                <div className="chatbot-empty-state">{labels.noRecentConversation}</div>
              ) : null}

              {recentMessages.map((message) => (
                <div key={message.id} className={`message ${message.sender === "user" ? "message-user" : "message-bot"}`}>
                  <div className="message-content">
                    {message.sender === "bot" ? (
                      <img src="/chatbot-guardian.png" alt="" className="message-avatar-image" />
                    ) : null}
                    <div className="message-text">{formatMessage(message.message)}</div>
                    <span className="message-time">{formatExactDateTime(message.created_at, language)}</span>
                  </div>
                </div>
              ))}

              {workflowState === "uploading" ? (
                <div className="workflow-interface">
                  <label className="upload-area">
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="sr-only-file-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleFileUpload(file);
                        }
                      }}
                    />
                    <div className="upload-content">
                      <img src="/chatbot-guardian.png" alt="" className="upload-guardian-image" />
                      <p>{labels.uploadTitle}</p>
                      <p className="upload-hint">{labels.uploadHint}</p>
                    </div>
                  </label>
                </div>
              ) : null}

              {workflowState === "selection" && availablePharmacies.length ? (
                <div className="workflow-interface">
                  <div className="pharmacy-list">
                    {availablePharmacies.map((pharmacy) => (
                      <div key={pharmacy.pharmacy_id} className="pharmacy-card">
                        <div className="pharmacy-info">
                          <strong>{pharmacy.name}</strong>
                          <p>{pharmacy.address}</p>
                          <p>{pharmacy.phone}</p>
                        </div>
                        <div className="pharmacy-actions">
                          <button
                            className="select-pharmacy-btn"
                            disabled={selectionBusyId === pharmacy.pharmacy_id}
                            onClick={() => void handlePharmacySelection(pharmacy)}
                          >
                            {selectionBusyId === pharmacy.pharmacy_id ? labels.selectionSending : labels.selectionCta}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {isLoading ? (
                <div className="message message-bot">
                  <div className="message-content">
                    <img src="/chatbot-guardian.png" alt="" className="message-avatar-image" />
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="chatbot-input-area">
          <textarea
            value={inputMessage}
            onChange={(event) => setInputMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={labels.placeholder}
            rows={1}
            disabled={isLoading}
          />
          <button className="send-button" onClick={() => void handleSend()} disabled={!inputMessage.trim() || isLoading}>
            {labels.send}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatMessage(text: string) {
  const lines = text.split("\n");
  const urlPattern = /(https?:\/\/[^\s]+)/g;

  return lines.map((line, index) => {
    const parts = line.split(urlPattern);

    return (
      <span key={`${line}-${index}`}>
        {parts.map((part, partIndex) =>
          /^https?:\/\//.test(part) ? (
            <a
              key={`${part}-${partIndex}`}
              href={part}
              target="_blank"
              rel="noreferrer"
              className="message-link"
            >
              {part}
            </a>
          ) : (
            <span key={`${part}-${partIndex}`}>{part}</span>
          )
        )}
        {index < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}
