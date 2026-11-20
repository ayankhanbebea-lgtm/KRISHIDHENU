import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getFarmerProfileId } from "@/lib/farmer";
import { farmersAhead, estimateWaitMinutes, currentlyServingToken } from "@/lib/services";

export const dynamic = "force-dynamic";

// Active Gemini model (defaulting to current stable gemini-2.5-flash, configurable via GEMINI_MODEL)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

  // 5. Government MSP Rates in System
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

    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY;

    // Graceful offline fallback if API key is not yet configured or is a placeholder
    if (!apiKey || apiKey.startsWith("your_") || apiKey.trim() === "") {
      return NextResponse.json({
        reply: `Namaste ${session.name}! AI Assistant is operating in demo mode because GEMINI_API_KEY is not configured yet. Your current token is ${context.activeBooking?.token || "none"}, and you have ${context.queueMetrics?.farmersAhead ?? 0} farmers ahead. To activate full Google Gemini AI responses, please add GEMINI_API_KEY in your environment variables.`,
        offline: true,
        model: "offline-mock",
      });
    }

    const systemPrompt = `You are "KRISHIDHENU AI Sahayak" (कृषिधेनु एआई सहायक), an empathetic, truthful, and intelligent agricultural assistant for Indian farmers at government MSP Mandi procurement centres.

=== VERIFIED REAL-TIME DATABASE CONTEXT FOR THIS LOGGED-IN FARMER ===
${JSON.stringify(context, null, 2)}
=====================================================================

STRICT RULES & CONSTRAINTS:
1. TRUTHFULNESS & ANTI-HALLUCINATION:
   - For all questions regarding the farmer's token number, slot date, queue position, estimated wait time, Mandi centre location, and payment status, use EXCLUSIVELY the verified data provided above.
   - NEVER invent or guess token numbers, queue positions, payment amounts, or dates.
   - If the farmer has no active booking, politely inform them: "आपके पास अभी कोई सक्रिय टोकन नहीं है। आप होम स्क्रीन पर 'Book Procurement Slot' से नया स्लॉट बुक कर सकते हैं।" (or in English).

2. BILINGUAL RESPONSE:
   - If the user writes in Hindi or Hinglish, reply in warm, respectful, and simple Hindi (Devanagari script).
   - If the user writes in English, reply in clean, professional, and accessible English.

3. DISTINGUISHING VERIFIED DATA VS GENERAL ADVICE:
   - When asked about their specific booking or token, cite the exact numbers from the context.
   - When asked for general advice (e.g. grain moisture limits, clean bags, required documents like Aadhaar / Bank Passbook / Girdawari), provide accurate Indian agricultural procurement norms (e.g. moisture under 12% for Wheat, clean non-torn gunny bags). Clearly state that these are standard guidelines.

4. TONE & BREVITY:
   - Be respectful, encouraging, and clear ("नमस्ते किसान भाई / Greetings").
   - Keep answers concise and direct. Avoid overwhelming paragraphs; use bullet points where helpful.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12-second timeout

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

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

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error("[Gemini API Error]", response.status, errData);

      // Helpful descriptive error in case of API failure
      return NextResponse.json(
        {
          reply: `AI Assistant is temporarily unable to connect to Gemini API (Status ${response.status}: ${errData?.error?.message || "Service unavailable"}). Your current token is ${context.activeBooking?.token || "N/A"}.`,
          error: errData?.error?.message,
          model: GEMINI_MODEL,
        },
        { status: 200 }
      );
    }

    const data = await response.json();
    const generatedReply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedReply) {
      return NextResponse.json({
        reply: "I received your question, but could not generate a response. Please try rephrasing.",
        model: GEMINI_MODEL,
      });
    }

    return NextResponse.json({
      reply: generatedReply.trim(),
      model: GEMINI_MODEL,
      verifiedToken: context.activeBooking?.token || null,
    });
  } catch (err: any) {
    if (err.name === "AbortError") {
      return NextResponse.json(
        { reply: "The AI assistant request timed out. Please try asking again." },
        { status: 504 }
      );
    }
    console.error("[Assistant Route Exception]", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while processing your request." },
      { status: 500 }
    );
  }
}
