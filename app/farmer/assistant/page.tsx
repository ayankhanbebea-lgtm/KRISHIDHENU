"use client";

import { useState, useRef, useEffect } from "react";
import FarmerTopBar from "@/components/FarmerTopBar";
import FarmerNav from "@/components/FarmerNav";
import { Send, Sparkles, Bot, AlertCircle } from "lucide-react";

type Msg = { role: "user" | "assistant"; text: string; offline?: boolean };

const SUGGESTIONS = [
  "What is my token status?",
  "When is my turn in queue?",
  "How can I book a slot?",
  "What is the MSP rate for Wheat?",
  "Check my payment status",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hello! I am your KRISHIDHENU AI Assistant. How can I help you today with your token status, queue position, Mandi timings, crop MSP rates, or payment details? You can ask in English, हिंदी, or Hinglish.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState<string>("gemini-3.5-flash");
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Check initial configuration on mount - never activate isLive until a verified query succeeds
  useEffect(() => {
    fetch("/api/farmer/assistant")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          if (data.model) setActiveModel(data.model);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userQuestion = text.trim();
    setMessages((m) => [...m, { role: "user", text: userQuestion }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/farmer/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userQuestion }),
      });
      const data = await res.json();
      if (data.model) setActiveModel(data.model);
      if (typeof data.isLive === "boolean") {
        setIsLive(data.isLive);
      }

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: data.error || "Unable to reach the AI Assistant. Please try again later.",
            offline: true,
          },
        ]);
        return;
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.reply || "I received your question, but could not generate a response. Please try rephrasing.",
          offline: Boolean(data.offline || !data.isLive),
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Connection failed. Please check your network and try again.",
          offline: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen pb-24 bg-surface flex flex-col">
      <FarmerTopBar name="Farmer" title="AI Assistant" />

      <div className="max-w-lg mx-auto w-full px-4 py-3 flex-1 flex flex-col">
        {/* Model & Status Badge Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-brand-50/70 border border-brand-200/60 rounded-lg mb-3 text-xs">
          <div className="flex items-center gap-1.5 text-brand-900 font-semibold">
            <Bot size={15} className="text-brand-600" />
            <span>KRISHIDHENU AI Assistant</span>
          </div>

          {isLive === true ? (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              <Sparkles size={12} className="text-emerald-600 animate-pulse" />
              <span>Gemini AI Active</span>
            </div>
          ) : isLive === false ? (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-800 font-medium bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              <AlertCircle size={12} className="text-amber-600" />
              <span>Database Fallback Mode</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[11px] text-brand-700 font-medium bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200">
              <Sparkles size={12} className="text-brand-500" />
              <span>AI Assistant Ready</span>
            </div>
          )}
        </div>

        {/* Message Thread */}
        <div className="flex-1 space-y-3 overflow-y-auto">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-rise-in`}>
              {m.role === "assistant" && (
                <span className="w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0 mr-2 mt-0.5 shadow-xs">
                  <Sparkles size={13} />
                </span>
              )}
              <div
                className={`max-w-[82%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                  m.role === "user"
                    ? "bg-brand-600 text-white rounded-br-sm shadow-xs font-medium"
                    : m.offline
                    ? "bg-amber-50 text-amber-950 border border-amber-200 rounded-bl-sm"
                    : "bg-white text-ink border border-line rounded-bl-sm shadow-xs"
                }`}
              >
                {m.offline && (
                  <p className="text-[11px] font-bold text-amber-800 flex items-center gap-1 mb-1">
                    <AlertCircle size={12} /> Notice
                  </p>
                )}
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-ink-faint pl-9">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse-dot" />
              <span>AI Assistant is thinking...</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Suggestion Chips */}
        <div className="flex flex-wrap gap-1.5 my-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={loading}
              className="text-xs px-2.5 py-1 rounded-full border border-line bg-white/80 text-ink-soft hover:border-brand-600 hover:text-brand-700 hover:bg-brand-50/50 transition-colors disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            className="input !py-2.5 !text-sm"
            placeholder="Ask your question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="btn-primary !px-4"
            disabled={loading || !input.trim()}
            aria-label="Send Message"
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      <FarmerNav />
    </main>
  );
}
