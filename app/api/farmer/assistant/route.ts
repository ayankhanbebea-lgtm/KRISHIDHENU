import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getFarmerProfileId } from "@/lib/farmer";
import { farmersAhead, estimateWaitMinutes, currentlyServingToken } from "@/lib/services";
import { detectLanguage } from "@/lib/language";

export const dynamic = "force-dynamic";

// Active Gemini models in priority order with resilient fallback
// gemini-3.5-flash and gemini-3.5-flash-lite provide sub-second response times and highest availability
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
].filter((m): m is string => Boolean(m && m.trim()));

const UNIQUE_MODELS = Array.from(new Set(CANDIDATE_MODELS));

function getFarmerContext(farmerId: string, sessionUser: { name: string; phone: string }) {
  const db = getDb();

  // 1. Farmer Profile (supports either profile id or user id)
  const profile = db
    .prepare(
      `SELECT fp.id, fp.farmer_code as farmerCode, fp.district, fp.state, fp.address, u.name, u.phone
       FROM farmer_profiles fp
       JOIN users u ON fp.user_id = u.id
       WHERE fp.id = ? OR fp.user_id = ?`
    )
    .get(farmerId, farmerId) as any;

  const actualProfileId = profile?.id || farmerId;

  // 2. Active or Latest Booking
  const activeBooking = db
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
    .get(actualProfileId) as any;

  // 3. Queue Real-time Metrics (if active booking exists)
  let queueMetrics = null;
  if (activeBooking && activeBooking.centreId && activeBooking.date) {
    const ahead = activeBooking.position != null ? farmersAhead(activeBooking.centreId, activeBooking.date, activeBooking.position) : 0;
    const waitMins = estimateWaitMinutes(activeBooking.centreId, ahead);
    const serving = currentlyServingToken(activeBooking.centreId, activeBooking.date);
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
    const payment = db
      .prepare(
        `SELECT id, token_number as tokenNumber, crop, final_quantity as finalQuantity,
                rate_per_unit as ratePerUnit, deductions, final_payable_amount as finalPayableAmount,
                total_amount as totalAmount, payment_status as paymentStatus,
                account_holder_name as accountHolderName, bank_name as bankName,
                transaction_reference as transactionReference, submitted_at as submittedAt, paid_at as paidAt
         FROM payments
         WHERE booking_id = ?`
      )
      .get(activeBooking.id) as any;
    if (payment) {
      paymentDetails = payment;
    }
  }

  // 5. Official MSP Rates in System
  const cropsList = db.prepare(`SELECT name, code, msp_rate as mspRate FROM crops ORDER BY name`).all();

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

  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY;
  const isConfigured = Boolean(apiKey && !apiKey.startsWith("your_") && apiKey.trim() !== "");

  // Never return isLive: true on initial GET. Only real successful POST responses can activate isLive.
  return NextResponse.json({
    status: isConfigured ? "configured" : "unconfigured",
    model: UNIQUE_MODELS[0] || "gemini-3.5-flash",
    defaultLanguage: "en",
    isLive: false,
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "FARMER") {
      return NextResponse.json({ error: "Please login as a farmer." }, { status: 401 });
    }

    const farmerId = getFarmerProfileId(session.id);
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
    const context = getFarmerContext(farmerId, { name: session.name, phone: session.phone });

    // Detect language of the incoming message
    const detectedLanguage = detectLanguage(message);

    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY;

    // Graceful offline fallback if API key is not yet configured or is a placeholder
    if (!apiKey || apiKey.startsWith("your_") || apiKey.trim() === "") {
      let offlineReply = "";
      const token = context.activeBooking?.token || "none";
      const ahead = context.queueMetrics?.farmersAhead ?? 0;

      if (detectedLanguage === "hi") {
        offlineReply = `नमस्ते ${session.name} जी! कृषिधेनु एआई सहायक वर्तमान में ऑफ़लाइन पूर्वावलोकन मोड में है क्योंकि GEMINI_API_KEY कॉन्फ़िगर नहीं है। आपका सक्रिय टोकन ${token} है, और कतार में आपसे आगे ${ahead} किसान हैं। पूर्ण Google Gemini AI सक्रिय करने के लिए कृपया Vercel Environment Variables में GEMINI_API_KEY सेट करें।`;
      } else if (detectedLanguage === "hinglish") {
        offlineReply = `Namaste ${session.name} ji! KRISHIDHENU AI Assistant abhi offline preview mode me hai kyunki GEMINI_API_KEY configured nahi hai. Aapka active token ${token} hai aur queue me aapse aage ${ahead} farmers hain. Real Google Gemini AI activate karne ke liye Vercel Environment Variables me GEMINI_API_KEY set karein.`;
      } else {
        offlineReply = `Hello ${session.name}! The KRISHIDHENU AI Assistant is currently operating in offline preview mode because GEMINI_API_KEY is not configured yet. Your active token is ${token}, and you have ${ahead} farmers ahead in queue. To activate live Google Gemini AI responses, please configure GEMINI_API_KEY in your Vercel Project Settings → Environment Variables.`;
      }

      return NextResponse.json({
        reply: offlineReply,
        offline: true,
        isLive: false,
        model: "offline-mock",
        language: detectedLanguage,
      });
    }

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

    let generatedReply: string | null = null;
    let successfulModel: string = UNIQUE_MODELS[0] || "gemini-3.5-flash";
    let lastError: any = null;
    let lastStatus: number = 500;

    for (const modelToTry of UNIQUE_MODELS) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15-second timeout

      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent?key=${apiKey}`;

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

        if (response.ok) {
          const data = await response.json();
          const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText && candidateText.trim()) {
            generatedReply = candidateText.trim();
            successfulModel = modelToTry;
            break;
          }
        } else {
          lastStatus = response.status;
          lastError = await response.json().catch(() => ({}));
          const safeStatusText = response.statusText || "Unknown Status";
          const safeReason = lastError?.error?.details?.[0]?.reason || lastError?.error?.status || "API_ERROR";
          console.warn(`[Gemini API] Model ${modelToTry} returned HTTP ${response.status} (${safeStatusText}, reason=${safeReason})`);

          // If model is not found (404) or temporary load spike (503), try fallback candidate model
          if (response.status === 404 || response.status === 503) {
            continue;
          }
          // For authentication/quota failures (401, 403, 429), stop trying other models to avoid repeated failures
          break;
        }
      } catch (err: any) {
        clearTimeout(timeout);
        lastError = err;
        if (err?.name === "AbortError") {
          lastStatus = 504;
          console.warn(`[Gemini API] Request timeout (15s) with model ${modelToTry}`);
        } else {
          console.warn(`[Gemini API] Network exception with model ${modelToTry}:`, err?.message);
        }
      }
    }

    if (generatedReply) {
      return NextResponse.json({
        reply: generatedReply,
        model: successfulModel,
        isLive: true,
        verifiedToken: context.activeBooking?.token || null,
        language: detectedLanguage,
      });
    }

    // Build specific, multilingual user-friendly messages for each exact failure type
    const tokenStr = context.activeBooking?.token ? `Token: ${context.activeBooking.token}` : "no active token";
    const aheadStr = context.queueMetrics?.farmersAhead != null ? `${context.queueMetrics.farmersAhead} farmers ahead` : "queue not started";
    const mspSummary = context.standardMspRates?.map((c: any) => `${c.name}: ₹${c.mspRate}`).join(", ") || "Wheat: ₹2275";

    let explanationEn = "";
    let explanationHi = "";
    let explanationHing = "";

    if (lastStatus === 401) {
      explanationEn = "Google Gemini API authentication failed (HTTP 401: Invalid or expired API key). Please ensure a valid Google AI Studio key (starting with 'AIzaSy...') is configured in GEMINI_API_KEY.";
      explanationHi = "Google Gemini API प्रमाणीकरण विफल रहा (HTTP 401: अमान्य या समाप्त API कुंजी)। कृपया Vercel सेटिंग्स में एक मान्य Gemini API कुंजी कॉन्फ़िगर करें।";
      explanationHing = "Google Gemini API authentication fail ho gaya (HTTP 401: Invalid ya expired API key). Kripya Vercel settings me valid Gemini API key set karein.";
    } else if (lastStatus === 403) {
      explanationEn = "Google Gemini API access forbidden (HTTP 403: Missing permissions or restricted key). Please check API key restrictions in Google Cloud Console.";
      explanationHi = "Google Gemini API एक्सेस प्रतिबंधित है (HTTP 403)। API कुंजी के पास आवश्यक अनुमतियाँ नहीं हैं।";
      explanationHing = "Google Gemini API access forbidden hai (HTTP 403). API key ke paas required permissions nahi hain.";
    } else if (lastStatus === 429) {
      explanationEn = "Google Gemini API rate limit or quota exceeded (HTTP 429). The system is temporarily using verified local Mandi records.";
      explanationHi = "Google Gemini दर सीमा या कोटा समाप्त हो गया (HTTP 429)। सिस्टम वर्तमान में सत्यापित स्थानीय मंडी रिकॉर्ड का उपयोग कर रहा है।";
      explanationHing = "Google Gemini rate limit ya quota exceed ho gaya hai (HTTP 429). Kripya thodi der baad try karein.";
    } else if (lastStatus === 500 || lastStatus === 503) {
      explanationEn = "Google Gemini service is temporarily experiencing high load (HTTP 503). Showing your verified procurement records below.";
      explanationHi = "Google Gemini सेवा में वर्तमान में अधिक लोड है (HTTP 503)। आपके सत्यापित खरीद रिकॉर्ड नीचे दिए गए हैं।";
      explanationHing = "Google Gemini service par abhi high load hai (HTTP 503). Aapke verified records neeche diye gaye hain.";
    } else if (lastStatus === 504) {
      explanationEn = "Google Gemini request timed out. Showing your verified procurement records below.";
      explanationHi = "Google Gemini अनुरोध का समय समाप्त (टाइमआउट) हो गया। आपके सत्यापित खरीद रिकॉर्ड नीचे दिए गए हैं।";
      explanationHing = "Google Gemini request timeout ho gaya. Aapke verified records neeche diye gaye hain.";
    } else {
      explanationEn = "The AI Assistant is currently operating in verified database mode.";
      explanationHi = "एआई सहायक वर्तमान में सत्यापित डेटाबेस मोड में कार्य कर रहा है।";
      explanationHing = "AI Assistant abhi verified database mode me chal raha hai.";
    }

    let finalFallbackReply = "";
    if (detectedLanguage === "hi") {
      finalFallbackReply = `नमस्ते ${session.name} जी!\n\n${explanationHi}\n\n📋 **आपके सत्यापित खरीद विवरण:**\n• सक्रिय टोकन: ${tokenStr}\n• कतार स्थिति: ${aheadStr}\n• सरकारी समर्थन मूल्य (MSP): ${mspSummary}\n\nयदि आपके पास टोकन या स्लॉट से संबंधित कोई प्रश्न है, तो आप अपने डैशबोर्ड पर सभी विवरण देख सकते हैं।`;
    } else if (detectedLanguage === "hinglish") {
      finalFallbackReply = `Namaste ${session.name} ji!\n\n${explanationHing}\n\n📋 **Aapka Verified Mandi Data:**\n• Active Token: ${tokenStr}\n• Queue Status: ${aheadStr}\n• Official MSP Rates: ${mspSummary}\n\nAap dashboard par apna slot ya payment status bhi directly check kar sakte hain.`;
    } else {
      finalFallbackReply = `Greetings ${session.name},\n\n${explanationEn}\n\n📋 **Your Verified Procurement Status:**\n• Active Token: ${tokenStr}\n• Queue Position: ${aheadStr}\n• Official MSP Rates: ${mspSummary}\n\nYou can also manage your slots and track DBT payment disbursements directly on your dashboard.`;
    }

    return NextResponse.json(
      {
        reply: finalFallbackReply,
        error: lastError?.error?.message || `HTTP ${lastStatus} from Gemini service`,
        isLive: false,
        model: successfulModel,
        language: detectedLanguage,
        status: "fallback",
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.name === "AbortError") {
      return NextResponse.json(
        { reply: "The AI assistant request timed out. Please try asking again.", isLive: false },
        { status: 504 }
      );
    }
    console.error("[Assistant Route Exception]", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while processing your request.", isLive: false },
      { status: 500 }
    );
  }
}
