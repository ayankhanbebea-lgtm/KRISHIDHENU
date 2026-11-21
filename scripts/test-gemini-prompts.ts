import fs from "fs";
import path from "path";

const envFiles = [".env.development.local", ".env.local", ".env"];
let key = "";
let model = "";

for (const envFile of envFiles) {
  const filePath = path.join(process.cwd(), envFile);
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (line.startsWith("GEMINI_API_KEY=") && !key) {
        key = line.split("=")[1].replace(/\"/g, "").trim();
      }
      if (line.startsWith("GEMINI_MODEL=") && !model) {
        model = line.split("=")[1].replace(/\"/g, "").trim();
      }
    }
  }
}

const activeModel = model || "gemini-3.5-flash-lite";

const testQuestions = [
  { q: "Who is the founder of KRISHIDHENU?", isApp: false },
  { q: "What is KRISHIDHENU?", isApp: false },
  { q: "What is my token status?", isApp: true },
  { q: "What is my payment status?", isApp: true },
  { q: "Explain MSP in simple Hindi.", isApp: false },
  { q: "Hello, how are you?", isApp: false },
];

const mockContext = {
  farmer: {
    name: "Devendra Verma",
    phone: "9828466372",
    farmerCode: "FP-6372",
    district: "Jaipur",
    state: "Rajasthan",
  },
  activeBooking: {
    id: "bkg_mwpyn292c6hl2ncf",
    token: "WHT-0100",
    tokenSeq: 100,
    status: "PAYMENT_COMPLETED",
    quantityQuintal: 25,
    actualQuantity: 25,
    qualityGrade: "GRADE_A",
    cropName: "Wheat",
    cropCode: "WHT",
    mspRate: 2275,
    centreId: "ctr_mtbty52pemlgmnlg",
    centreName: "Jaipur Procurement Centre 01",
    date: "2026-11-21",
    startTime: "09:00",
    endTime: "11:00",
    position: 1,
  },
  queueMetrics: {
    queuePosition: 1,
    farmersAhead: 0,
    estimatedWaitMinutes: 0,
    currentlyServingToken: "WHT-0100",
  },
  paymentDetails: {
    id: "pay_mwpyou7oejjows1r",
    tokenNumber: "WHT-0100",
    crop: "Wheat",
    finalQuantity: 25,
    ratePerUnit: 2275,
    deductions: 0,
    finalPayableAmount: 56875,
    totalAmount: 56875,
    paymentStatus: "PAID",
    accountHolderName: "Devendra Verma",
    bankName: "State Bank of India",
    transactionReference: "TXN-KD-2026-LIVE-001",
  },
  standardMspRates: [
    { name: "Wheat", code: "WHT", mspRate: 2275 },
    { name: "Mustard", code: "MUS", mspRate: 5650 },
  ],
};

function buildSystemPrompt(isApp: boolean) {
  return `You are "KRISHIDHENU AI Assistant", an empathetic, truthful, and helpful agricultural assistant for the KRISHIDHENU Digital Farmer Procurement & Smart Mandi Management Platform.

PROJECT KNOWLEDGE:
- Platform Name: KRISHIDHENU (Smart Mandi & Farmer Procurement Platform).
- Creator / Founder: Ayan Khan.
- What KRISHIDHENU does: It connects Indian farmers, Mandi staff, and administrators to streamline crop procurement at Minimum Support Price (MSP), eliminate mandi physical queues with time-slotted digital tokens, provide transparent electronic weighing and quality grading, and ensure direct DBT bank payment tracking.
- Important: You are an AI assistant built for KRISHIDHENU; you are NOT the founder. If asked who the founder or creator of KRISHIDHENU is, state clearly that Ayan Khan is the founder/creator, and that you are the platform's AI assistant.
- For unknown project-specific facts, state honestly that the information is not available rather than guessing.

${isApp ? `=== VERIFIED TURSO DATABASE CONTEXT FOR THIS LOGGED-IN FARMER ===\n${JSON.stringify(mockContext, null, 2)}\n===================================================================\nSTRICT RULE FOR APPLICATION DATA:\n- Use EXCLUSIVELY the verified context above for token, queue, booking, and payment status.\n- NEVER hallucinate or invent token numbers, dates, or payment amounts.` : `NOTE: This is a general query. Do not reference personal farmer records unless relevant.`}

LANGUAGE & TONE:
- Understand and respond automatically in English, Hindi (Devanagari), or Hinglish based on the user's message.
- If the user explicitly asks for a language (e.g. "Explain in simple Hindi"), strictly obey that language instruction.
- Be concise, respectful, warm, and helpful.`;
}

async function testAll() {
  console.log(`Using model: ${activeModel}\n`);

  for (const { q, isApp } of testQuestions) {
    console.log(`--------------------------------------------------`);
    console.log(`Q: "${q}" (Type: ${isApp ? "Database-Context" : "Direct-Gemini"})`);
    const systemPrompt = buildSystemPrompt(isApp);

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: q }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
        }),
      });

      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      console.log(`Reply:\n${reply}\n`);
    } catch (e: any) {
      console.error(`Error:`, e.message);
    }
  }
}

testAll();
