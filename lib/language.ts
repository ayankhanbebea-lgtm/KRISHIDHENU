/**
 * Language detection helper for KRISHIDHENU AI Assistant.
 * Defaults strictly to English.
 * Detects Hindi (Devanagari script) and Hinglish (Roman script Hindi).
 */
export function detectLanguage(text: string): "en" | "hi" | "hinglish" {
  if (!text || typeof text !== "string") return "en";

  // 1. Check for Devanagari Unicode script range
  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }

  // 2. Check for typical Hinglish marker words
  const hinglishMarkers = new Set([
    "mera", "meri", "mere", "mujhe", "mujhko", "hum", "humko", "humein",
    "kya", "kyun", "kyu", "kaise", "kaisey", "kab", "kahan", "kidhar", "kitna", "kitne", "kitni",
    "hai", "hain", "ho", "hoon", "hun", "tha", "thi", "the",
    "karo", "karna", "karni", "karne", "karein", "kare", "karte", "karta",
    "aayega", "aayegi", "aayenge", "aana", "aao", "aata", "aati",
    "batao", "bataiye", "bataye", "bolo", "boliye", "samjhao", "samjhaiye",
    "chahiye", "chahta", "chahti", "chahte",
    "hoga", "hogi", "honge",
    "nahi", "nahin", "mat",
    "raha", "rahi", "rahe",
    "aapka", "aapki", "aapke", "aapse", "aap", "tum", "tumhara",
    "kisan", "fasal", "anaj", "gehu", "gehoon", "paisa", "paise", "rupaye",
    "namaste", "pranam", "dhanyawad", "shukriya"
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const w of words) {
    if (hinglishMarkers.has(w)) {
      return "hinglish";
    }
  }

  // Default is strictly English
  return "en";
}
