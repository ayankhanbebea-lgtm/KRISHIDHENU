import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getFarmerProfileId } from "@/lib/farmer";
import { farmersAhead, estimateWaitMinutes, currentlyServingToken } from "@/lib/services";
import { detectLanguage } from "@/lib/language";
import { generateIntelligentFarmerResponse, FarmerAssistantContext } from "@/lib/ai-assistant-engine";

export const dynamic = "force-dynamic";

// Active Gemini model configuration
// Supported Google Gemini Developer API models in priority order
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
].filter((m): m is string => Boolean(m && m.trim()));

const UNIQUE_MODELS = Array.from(new Set(CANDIDATE_MODELS));

async function getFarmerContext(farmerId: string, sessionUser: { name: string; phone: string }): Promise<FarmerAssistantContext> {
  const db = getDb();

  // 1. Farmer Profile (supports either profile id or user id)
  const profile = (await db
    .prepare(
      `SELECT fp.id, fp.farmer_code as farmerCode, fp.district, fp.state, fp.address, u.name, u.phone
       FROM farmer_profiles fp
       JOIN users u ON fp.user_id = u.id
       WHERE fp.id = ? OR fp.user_id = ?`
    )
    .get(farmerId, farmerId)) as any;

  const actualProfileId = profile?.id || farmerId;

  // 2. Active or Latest Booking
  const activeBooking = (await db
    .prepare(
      `SELECT b.id, b.token, b.token_seq as tokenSeq, b.status, b.quantity_quintal as quantityQuintal,
              b.actual_quantity as actualQuantity, b.quality_grade as qualityGrade,
              c.name as cropName, c.code as cropCode, c.msp_rate as mspRate,
              ctr.id as centreId, ctr.name as centreName, ctr.code as centreCode,
              ctr.location as centreLocation, ctr.district as centreDistrict,
              ctr.open_time as openTime, ctr.close_time as closeTime,
              s.date, s.start_time as startTime, s.end_time as endTime, q.position
       FROM bookings b
       JOIN crops c ON b.crop_id = c.id
       JOIN procurement_centres ctr ON b.centre_id = ctr.id
       JOIN slots s ON b.slot_id = s.id
       LEFT JOIN queue_entries q ON q.booking_id = b.id
       WHERE b.farmer_id = ?
       ORDER BY CASE WHEN b.status NOT IN ('PROCUREMENT_COMPLETED','PAYMENT_COMPLETED','CANCELLED','NO_SHOW') THEN 0 ELSE 1 END,
                b.created_at DESC
       LIMIT 1`
    )
    .get(actualProfileId)) as any;

  // 3. Queue Real-time Metrics (if active booking exists)
  let queueMetrics = null;
  if (activeBooking && activeBooking.centreId && activeBooking.date) {
    const ahead = activeBooking.position != null ? await farmersAhead(activeBooking.centreId, activeBooking.date, activeBooking.position) : 0;
    const waitMins = await estimateWaitMinutes(activeBooking.centreId, ahead);
    const serving = await currentlyServingToken(activeBooking.centreId, activeBooking.date);
    queueMetrics = {
      queuePosition: activeBooking.position,
      farmersAhead: ahead,
      estimatedWaitMinutes: waitMins,
      currentlyServingToken: serving || "Not started yet",
    };
  }

  // 4. Payment Details (if any booking reached payment)
  let paymentDetails = null;
  if (activeBooking) {
    const payment = (await db
      .prepare(
        `SELECT id, token_number as tokenNumber, crop, final_quantity as finalQuantity,
                rate_per_unit as ratePerUnit, deductions, final_payable_amount as finalPayableAmount,
                total_amount as totalAmount, payment_status as paymentStatus,
                account_holder_name as accountHolderName, bank_name as bankName,
                transaction_reference as transactionReference, submitted_at as submittedAt, paid_at as paidAt
         FROM payments
         WHERE booking_id = ?`
      )
      .get(activeBooking.id)) as any;
    if (payment) {
      paymentDetails = payment;
    }
  }

  // 5. Official MSP Rates in System
  const cropsList = (await db.prepare(`SELECT name, code, msp_rate as mspRate FROM crops ORDER BY name`).all()) as any[];

  return {
    farmer: {
      name: profile?.name || sessionUser.name,
      phone: profile?.phone || sessionUser.phone,
      farmerCode: profile?.farmerCode || "FP-1000",
      district: profile?.district || "Jaipur",
      state: profile?.state || "Rajasthan",
    },
    activeBooking: activeBooking || null,
    queueMetrics,
    paymentDetails,
    standardMspRates: cropsList,
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "FARMER") {
    return NextResponse.json({ error: "Please login as a farmer." }, { status: 401 });
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY || "").trim();
  const hasKey = Boolean(apiKey && !apiKey.startsWith("your_"));
  const configuredModel = UNIQUE_MODELS[0] || "gemini-2.5-flash";

  let geminiDiagnostics = null;
  const wantDiagnostics = req.nextUrl.searchParams.get("diagnostics") === "1";

  if (wantDiagnostics && hasKey) {
    const pStart = Date.now();
    try {
      const pRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${configuredModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "ping" }] }],
          }),
          signal: AbortSignal.timeout(6000),
        }
      );
      const pTime = Date.now() - pStart;
      const pData = await pRes.json().catch(() => ({}));
      geminiDiagnostics = {
        httpStatus: pRes.status,
        responseTimeMs: pTime,
        model: configuredModel,
        success: pRes.ok,
        reason: pData?.error?.details?.[0]?.reason || pData?.error?.status || (pRes.ok ? "OK" : "API_ERROR"),
        errorMessage: pData?.error?.message || (pRes.ok ? null : pRes.statusText),
      };
    } catch (err: any) {
      geminiDiagnostics = {
        httpStatus: 0,
        responseTimeMs: Date.now() - pStart,
        model: configuredModel,
        success: false,
        reason: err?.name || "NETWORK_ERROR",
        errorMessage: err?.message || "Failed to reach Gemini endpoint",
      };
    }
  }

  return NextResponse.json({
    status: hasKey ? "configured" : "unconfigured",
    hasKey,
    keyPrefix: hasKey ? `${apiKey.substring(0, 4)}...` : null,
    keyLength: apiKey.length,
    keyType: apiKey.startsWith("AIzaSy") ? "google_ai_studio" : hasKey ? "non_standard_token" : "none",
    model: configuredModel,
    defaultLanguage: "en",
    geminiDiagnostics,
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "FARMER") {
      return NextResponse.json({ error: "Please login as a farmer." }, { status: 401 });
    }

    const farmerId = (await getFarmerProfileId(session.id)) || session.id;
    if (!farmerId) {
      return NextResponse.json({ error: "Farmer profile not found." }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json(
        { error: "Please enter a valid message or question." },
        { status: 400 }
      );
    }

    // Pull verified real-time database context for this farmer
    const context = await getFarmerContext(farmerId, { name: session.name, phone: session.phone });

    // Detect language of the incoming message
    const detectedLanguage = detectLanguage(message);

    const apiKey = (process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY || "").trim();

    // Track Gemini execution metrics
    let liveGeminiReply: string | null = null;
    let successfulModel: string = UNIQUE_MODELS[0] || "gemini-2.5-flash";
    let lastStatus = 0;
    let lastReason = "";
    let lastErrorMessage = "";
    let responseTimeMs = 0;
    const startTime = Date.now();

    // 1. PATH A: REAL GEMINI AI REQUEST
    // Only attempt if an API key is configured
    if (apiKey && !apiKey.startsWith("your_")) {
      const systemPrompt = `You are "KRISHIDHENU AI Assistant", an empathetic, truthful, and intelligent agricultural assistant for Indian farmers using the KRISHIDHENU Digital Farmer Procurement & Smart Mandi Management Platform.

=== VERIFIED REAL-TIME DATABASE CONTEXT FOR THIS LOGGED-IN FARMER ===
${JSON.stringify(context, null, 2)}
=====================================================================

Language Selection Rules:
- Default response language: English.
- Detect the language of the user's latest message.
- English input → English response.
- Hindi input → Hindi response in Devanagari script.
- Hinglish input → Hinglish response in Roman script.
- Always follow the language of the latest user message.
- Never switch languages without a clear reason.
- Keep responses simple, natural, helpful and easy for farmers to understand.

[Language Detection for Current Message]: ${detectedLanguage.toUpperCase()} (Respond strictly in this language).

STRICT OPERATIONAL RULES:
1. TRUTHFULNESS & ZERO HALLUCINATION:
   - For all questions regarding the farmer's token number, slot date, queue position, estimated wait time, Mandi centre location, and payment status, use EXCLUSIVELY the verified data provided in the database context above.
   - NEVER invent or guess token numbers, queue positions, payment amounts, or dates.
   - If the farmer has no active booking, inform them politely:
     * English: "You do not currently have an active procurement token. You can book a slot anytime using the 'Book Slot' option on your dashboard."
     * Hindi: "आपके पास अभी कोई सक्रिय टोकन नहीं है। आप डैशबोर्ड पर 'Book Slot' विकल्प से नया स्लॉट बुक कर सकते हैं।"
     * Hinglish: "Aapke paas abhi koi active token nahi hai. Aap dashboard par 'Book Slot' option use karke naya slot book kar sakte hain."

2. DISTINGUISHING VERIFIED DATA VS GENERAL PROCUREMENT GUIDELINES:
   - When asked about their specific booking or token, cite the exact numbers from the context.
   - When asked about official MSP rates or quality standards:
     * Official CACP/FCI standards: Moisture limit is 12.0%. Between 12.1% - 14.0%, proportional value deduction applies. Over 14.0%, grain requires sun-drying.
     * Fair assessment: Quality deductions are calculated transparently on the portal; staff cannot levy arbitrary cash cuts.
     * Farmer rights: If a farmer disputes a moisture reading, they have the statutory right to request a second sample test before signing the receipt.
     * Document checklist: Remind farmers to carry Aadhaar Card, Bank Passbook / Account details, and Land Girdawari / Jamabandi copy.

3. TONE & BREVITY:
   - Address the farmer respectfully: "Greetings [Name]" in English, "नमस्ते [Name] जी" in Hindi, or "Namaste [Name] ji" in Hinglish.
   - Keep answers clear, supportive, and concise. Avoid dense walls of text; use bullet points where helpful.`;

      for (const modelToTry of UNIQUE_MODELS) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent?key=${apiKey}`;

          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: systemPrompt }],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: message }],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 600,
              },
            }),
          });

          clearTimeout(timeout);
          responseTimeMs = Date.now() - startTime;
          lastStatus = response.status;

          if (response.ok) {
            const data = await response.json();
            const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (candidateText && candidateText.trim()) {
              liveGeminiReply = candidateText.trim();
              successfulModel = modelToTry;
              break;
            }
          } else {
            const errJson = await response.json().catch(() => ({}));
            lastReason = errJson?.error?.details?.[0]?.reason || errJson?.error?.status || "API_ERROR";
            lastErrorMessage = errJson?.error?.message || response.statusText || `HTTP ${response.status}`;
            console.warn(`[Gemini API] Model ${modelToTry} failed: HTTP ${response.status} (${lastReason}: ${lastErrorMessage})`);
            break;
          }
        } catch (err: any) {
          clearTimeout(timeout);
          responseTimeMs = Date.now() - startTime;
          lastStatus = err?.name === "AbortError" ? 504 : 500;
          lastReason = err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
          lastErrorMessage = err?.message || "Network exception";
        }
      }
    } else {
      lastStatus = 0;
      lastReason = "API_KEY_UNCONFIGURED";
      lastErrorMessage = "GEMINI_API_KEY environment variable is not configured.";
    }

    // If Gemini succeeded, return genuine REAL Gemini AI response
    if (liveGeminiReply) {
      return NextResponse.json({
        reply: liveGeminiReply,
        source: "gemini",
        isLive: true,
        model: successfulModel,
        responseTimeMs,
        language: detectedLanguage,
      });
    }

    // 2. PATH B: DATABASE FALLBACK
    // Used ONLY when Gemini is unavailable or failed (e.g. 401, quota, or network).
    // Answers farmer questions accurately using verified database records.
    // Clearly identified as "database_fallback" (NEVER labeled as Gemini AI).
    const fallbackReply = generateIntelligentFarmerResponse({
      message,
      context,
      language: detectedLanguage,
      sessionName: session.name,
    });

    return NextResponse.json({
      reply: fallbackReply,
      source: "database_fallback",
      isLive: false,
      model: "database-fallback",
      responseTimeMs: responseTimeMs || (Date.now() - startTime),
      geminiDiagnostics: {
        httpStatus: lastStatus,
        reason: lastReason,
        errorMessage: lastErrorMessage,
        modelAttempted: UNIQUE_MODELS[0] || "gemini-2.5-flash",
      },
      language: detectedLanguage,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
