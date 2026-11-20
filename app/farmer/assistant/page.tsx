"use client";

import { useState, useRef, useEffect } from "react";
import FarmerTopBar from "@/components/FarmerTopBar";
import FarmerNav from "@/components/FarmerNav";
import { Send, Sparkles, Bot } from "lucide-react";

type Msg = { role: "user" | "assistant"; text: string };

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
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Check initial configuration on mount
  useEffect(() => {
    fetch("/api/farmer/assistant")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.isLive === "boolean") {
          setIsLive(data.isLive);
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
      if (typeof data?.isLive === "boolean") {
        setIsLive(data.isLive);
      }

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: data.error || "Unable to reach the AI Assistant right now. Please try again.",
          },
        ]);
        return;
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.reply || "I received your question. How else can I assist you with your Mandi procurement today?",
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Connection failed. Please check your internet connection and try again.",
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

          {isLive ? (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 font-semibold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              <Sparkles size={12} className="text-emerald-600 animate-pulse" />
              <span>Gemini AI Active</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-brand-700 font-medium bg-brand-50 px-2.5 py-0.5 rounded-full border border-brand-200">
              <Sparkles size={12} className="text-brand-600" />
              <span>AI Assistant Active</span>
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
                    : "bg-white text-ink border border-line rounded-bl-sm shadow-xs"
                }`}
              >
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
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your question in English, हिंदी, or Hinglish..."
            disabled={loading}
            className="flex-1 bg-white border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 shadow-xs"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Send message"
            className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0 hover:bg-brand-700 transition-colors disabled:opacity-40 shadow-xs cursor-pointer disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </form>
      </div>

      <FarmerNav />
    </main>
  );
}
