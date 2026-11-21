"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  Bot,
  Send,
  X,
  Minus,
  Maximize2,
  Database,
  RefreshCw,
  Trash2,
} from "lucide-react";

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  source?: "gemini" | "gemini_db" | "database_fallback";
  model?: string;
  time?: string;
};

const FARMER_SUGGESTIONS = [
  "What is my token status?",
  "When is my turn in queue?",
  "Check my payment status",
  "What is the MSP for Wheat?",
  "Who is the founder of KRISHIDHENU?",
];

const STAFF_SUGGESTIONS = [
  "What is today's queue status at my centre?",
  "How many farmers are currently waiting?",
  "What is the procedure for recording weight?",
  "Explain quality grading FAQ standards",
  "Who is the founder of KRISHIDHENU?",
];

const ADMIN_SUGGESTIONS = [
  "What are today's total procurement numbers?",
  "Show payment disbursement summary",
  "Which procurement centre has the highest load?",
  "What is the current no-show rate?",
  "Who is the founder of KRISHIDHENU?",
];

export default function GlobalChatbot() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<"FARMER" | "STAFF" | "ADMIN" | null>(null);
  const [userName, setUserName] = useState<string>("");
  const endRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef(false);

  // Check if we are on an authenticated dashboard page
  const isDashboard =
    Boolean(pathname) &&
    (pathname.startsWith("/farmer") ||
      pathname.startsWith("/staff") ||
      pathname.startsWith("/admin"));

  // Hide floating button on the dedicated full-page farmer assistant page
  const isDedicatedAssistantPage = pathname === "/farmer/assistant";

  // Infer role from URL and /api/auth/me
  useEffect(() => {
    if (!isDashboard) return;

    let detectedRole: "FARMER" | "STAFF" | "ADMIN" = "FARMER";
    if (pathname.startsWith("/admin")) detectedRole = "ADMIN";
    else if (pathname.startsWith("/staff")) detectedRole = "STAFF";

    setRole(detectedRole);

    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.user?.role) setRole(data.user.role);
        if (data.user?.name) setUserName(data.user.name);
      })
      .catch(() => {});
  }, [pathname, isDashboard]);

  // Restore or initialize conversation messages from sessionStorage
  useEffect(() => {
    if (!role || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const storageKey = `krishidhenu_chat_${role.toLowerCase()}`;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
    } catch {}

    // Initial greeting based on role
    const initialGreeting: ChatMessage = {
      role: "assistant",
      text:
        role === "STAFF"
          ? "Namaste Staff Member! I am your KRISHIDHENU AI Assistant powered by Gemini. Ask me about today's queue at your centre, farmer tokens, weighing procedures, or Mandi operational guidelines."
          : role === "ADMIN"
          ? "Namaste Administrator! I am your KRISHIDHENU AI Assistant powered by Gemini. I can assist you with real-time procurement statistics, payment disbursement tracking, centre congestion monitoring, and platform governance."
          : "Hello! I am your KRISHIDHENU AI Assistant powered by Gemini. How can I help you today with your token status, queue position, Mandi timings, crop MSP rates, payment details, or agricultural guidance? You can ask in English, हिंदी, or Hinglish.",
      source: "gemini",
      model: "gemini-3.5-flash-lite",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages([initialGreeting]);
  }, [role]);

  // Sync messages to sessionStorage
  useEffect(() => {
    if (!role || messages.length === 0) return;
    try {
      const storageKey = `krishidhenu_chat_${role.toLowerCase()}`;
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {}
  }, [messages, role]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen && !isMinimized) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isMinimized]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const question = text.trim();
      const userMsg: ChatMessage = {
        role: "user",
        text: question,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question }),
        });

        const data = await res.json();

        if (!res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: data.error || "Unable to reach Gemini AI Assistant right now. Please try again.",
              source: "database_fallback",
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
          return;
        }

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text:
              data.reply ||
              "I received your query. How else can I assist you with KRISHIDHENU today?",
            source: data.source || "gemini",
            model: data.model,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "Network connection error. Please check your internet connection and try again.",
            source: "database_fallback",
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  function resetChat() {
    if (!role) return;
    const initialGreeting: ChatMessage = {
      role: "assistant",
      text:
        role === "STAFF"
          ? "Namaste Staff Member! How can I assist you with Mandi operations or today's queue?"
          : role === "ADMIN"
          ? "Namaste Administrator! How can I assist you with platform metrics or disbursement tracking?"
          : "Hello! How can I assist you today with your token status, queue position, payments, or MSP rates?",
      source: "gemini",
      model: "gemini-3.5-flash-lite",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages([initialGreeting]);
    try {
      const storageKey = `krishidhenu_chat_${role.toLowerCase()}`;
      sessionStorage.removeItem(storageKey);
    } catch {}
  }

  // Do not render on public pages or on the dedicated assistant page
  if (!isDashboard || isDedicatedAssistantPage) return null;

  const currentSuggestions =
    role === "STAFF"
      ? STAFF_SUGGESTIONS
      : role === "ADMIN"
      ? ADMIN_SUGGESTIONS
      : FARMER_SUGGESTIONS;

  const roleLabel =
    role === "STAFF" ? "Staff Assistant" : role === "ADMIN" ? "Admin Oversight" : "Farmer Assistant";

  return (
    <>
      {/* FLOATING TRIGGER ICON */}
      {!isOpen && (
        <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 flex items-center group">
          {/* Tooltip */}
          <div className="pointer-events-none absolute right-full mr-3 hidden sm:flex items-center px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-semibold shadow-raised whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span>KRISHIDHENU AI Assistant</span>
            <div className="absolute left-full top-1/2 -translate-y-1/2 -ml-1 border-4 border-transparent border-l-navy" />
          </div>

          {/* Pulse beacon */}
          <span className="absolute -inset-1 rounded-full bg-emerald-500 opacity-40 blur-xs animate-pulse group-hover:opacity-75 transition-opacity" />

          {/* Floating Action Button */}
          <button
            onClick={() => {
              setIsOpen(true);
              setIsMinimized(false);
            }}
            aria-label="Open KRISHIDHENU AI Assistant"
            className="relative w-13 h-13 md:w-14 md:h-14 rounded-full bg-gradient-to-tr from-brand-700 via-brand-600 to-emerald-500 text-white shadow-raised hover:shadow-2xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer border-2 border-white/40"
          >
            <Sparkles size={24} className="animate-spin-slow text-grain" />
            <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white animate-pulse" />
          </button>
        </div>
      )}

      {/* CHATBOT PANEL */}
      {isOpen && (
        <div
          className={`fixed z-50 flex flex-col bg-white border border-line shadow-2xl transition-all duration-300 animate-rise-in ${
            isMinimized
              ? "bottom-20 md:bottom-6 right-4 md:right-6 w-72 md:w-80 h-14 rounded-2xl overflow-hidden"
              : "inset-x-3 bottom-20 sm:inset-x-auto sm:bottom-22 sm:right-5 w-auto sm:w-[410px] h-[540px] max-h-[80vh] rounded-2xl overflow-hidden"
          }`}
        >
          {/* Header */}
          <div className="bg-navy text-white px-4 py-3 flex items-center justify-between shrink-0 border-b border-white/10 select-none">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0 text-grain">
                <Sparkles size={16} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-display font-bold text-xs md:text-sm truncate">
                    KRISHIDHENU AI Assistant
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-white/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-medium text-emerald-300">{roleLabel}</span>
                  {userName && <span className="truncate">· {userName}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0 text-white/75">
              {!isMinimized && (
                <button
                  onClick={resetChat}
                  title="Clear conversation"
                  aria-label="Clear chat"
                  className="p-1 rounded-md hover:bg-white/10 hover:text-white transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}

              <button
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? "Maximize" : "Minimize"}
                aria-label="Toggle minimize"
                className="p-1 rounded-md hover:bg-white/10 hover:text-white transition-colors"
              >
                {isMinimized ? <Maximize2 size={14} /> : <Minus size={15} />}
              </button>

              <button
                onClick={() => setIsOpen(false)}
                title="Close Assistant"
                aria-label="Close assistant"
                className="p-1 rounded-md hover:bg-white/10 hover:text-white transition-colors ml-0.5"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Expanded Panel Body */}
          {!isMinimized && (
            <div className="flex-1 flex flex-col min-h-0 bg-surface">
              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-rise-in`}
                  >
                    {m.role === "assistant" && (
                      <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0 mr-2 mt-1 shadow-xs">
                        <Sparkles size={12} />
                      </span>
                    )}

                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs md:text-sm leading-relaxed whitespace-pre-line shadow-xs ${
                        m.role === "user"
                          ? "bg-brand-600 text-white rounded-br-xs font-medium"
                          : "bg-white text-ink border border-line rounded-bl-xs"
                      }`}
                    >
                      {m.text}

                      {/* Source Indicator for AI Responses */}
                      {m.role === "assistant" && (
                        <div className="mt-2 pt-1.5 border-t border-line/50 flex items-center justify-between text-[10px] text-ink-faint">
                          {m.source === "gemini_db" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <Sparkles size={11} className="text-emerald-600 shrink-0" />
                              <span>Gemini AI + Verified Database Data</span>
                            </span>
                          ) : m.source === "gemini" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <Sparkles size={11} className="text-emerald-600 shrink-0" />
                              <span>Gemini AI</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                              <Database size={11} className="text-amber-600 shrink-0" />
                              <span>Database Fallback</span>
                            </span>
                          )}
                          {m.time && <span className="text-[10px] text-ink-faint ml-2">{m.time}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex items-center gap-2 text-xs text-ink-faint pl-8 pt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />
                    <span>Gemini AI is analyzing records...</span>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {/* Suggestion Chips */}
              <div className="px-3 py-1.5 border-t border-line/60 bg-white/70 overflow-x-auto whitespace-nowrap flex gap-1.5 no-scrollbar">
                {currentSuggestions.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => send(s)}
                    disabled={loading}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-line bg-white text-ink-soft hover:border-brand-600 hover:text-brand-700 hover:bg-brand-50/50 transition-colors shrink-0 disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Input Area */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="p-2.5 bg-white border-t border-line flex items-center gap-2 shrink-0"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask in English, हिंदी, or Hinglish..."
                  disabled={loading}
                  className="flex-1 bg-surface-sunken border border-line rounded-xl px-3 py-2 text-xs md:text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-brand-500 focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  aria-label="Send message"
                  className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0 hover:bg-brand-700 transition-colors disabled:opacity-40 shadow-xs cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </>
  );
}
