"use client";

import { useState, useRef, useEffect } from "react";
import FarmerTopBar from "@/components/FarmerTopBar";
import FarmerNav from "@/components/FarmerNav";
import { Send, Sparkles, Bot, AlertCircle } from "lucide-react";

type Msg = { role: "user" | "assistant"; text: string; offline?: boolean };

const SUGGESTIONS = [
  "मेरी बारी कब आएगी? (When is my turn?)",
  "मेरा टोकन व कतार स्थिति (My Token & Queue)",
  "भुगतान स्थिति (Payment Status)",
  "मंडी का समय व पता (Mandi Timings & Address)",
  "गेहूं और सोयाबीन MSP दर (Crop MSP Rates)",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "नमस्ते किसान भाई! मैं कृषिधेनु एआई सहायक हूँ। आप मुझसे अपने टोकन, कतार स्थिति, मंडी समय, फसल MSP या भुगतान के बारे में हिंदी या English में पूछ सकते हैं।",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState<string>("gemini-2.5-flash");
  const endRef = useRef<HTMLDivElement>(null);

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

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: data.error || "Unable to reach AI Assistant. Please try again later.",
            offline: true,
          },
        ]);
        return;
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.reply || "Sorry, I couldn't generate a response. Please try rephrasing.",
          offline: Boolean(data.offline),
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "नेटवर्क समस्या के कारण उत्तर नहीं मिल पाया। कृपया पुनः प्रयास करें। (Connection failed. Please check your network and try again.)",
          offline: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen pb-24 bg-surface flex flex-col">
      <FarmerTopBar name="Farmer" title="AI Sahayak" />

      <div className="max-w-lg mx-auto w-full px-4 py-3 flex-1 flex flex-col">
        {/* Model & Status Badge Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-brand-50/70 border border-brand-200/60 rounded-lg mb-3 text-xs">
          <div className="flex items-center gap-1.5 text-brand-900 font-semibold">
            <Bot size={15} className="text-brand-600" />
            <span>KRISHIDHENU AI Sahayak</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-brand-700 font-medium">
            <Sparkles size={12} className="text-amber-500 animate-pulse" />
            <span className="font-mono">{activeModel}</span>
          </div>
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
              <span>AI सहायक सोच रहा है... (Thinking...)</span>
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
            placeholder="हिंदी या English में प्रश्न पूछें..."
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
