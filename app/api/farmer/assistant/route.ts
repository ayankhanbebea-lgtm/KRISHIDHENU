import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getFarmerProfileId } from "@/lib/farmer";
import { getStaffCentre } from "@/lib/staff";
import {
  farmersAhead,
  estimateWaitMinutes,
  currentlyServingToken,
  centreLoad,
  adminOverview,
} from "@/lib/services";
import { detectLanguage } from "@/lib/language";
import { getTodayIST } from "@/lib/format";
import {
  generateIntelligentFarmerResponse,
  FarmerAssistantContext,
  isApplicationSpecificQuery,
} from "@/lib/ai-assistant-engine";

export const dynamic = "force-dynamic";

// Active Gemini model configuration
// Supported Google Gemini Developer API models in priority order
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
].filter((m): m is string => Boolean(m && m.trim()));

const UNIQUE_MODELS = Array.from(new Set(CANDIDATE_MODELS));

async function getFarmerContext(
  farmerId: string,
  sessionUser: { name: string; phone: string }
): Promise<FarmerAssistantContext> {
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
    const ahead =
      activeBooking.position != null
        ? await farmersAhead(activeBooking.centreId, activeBooking.date, activeBooking.position)
        : 0;
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
  const cropsList = (await db
    .prepare(`SELECT name, code, msp_rate as mspRate FROM crops ORDER BY name`)
    .all()) as any[];

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

async function getStaffContext(
  userId: string,
  sessionUser: { name: string; phone: string }
): Promise<any> {
  const db = getDb();
  const todayIST = getTodayIST();
  let centre = await getStaffCentre(userId);
  if (!centre) {
    centre = (await db.prepare(`SELECT id, name, code FROM procurement_centres ORDER BY code ASC LIMIT 1`).get()) as any;
  }
  if (!centre) {
    return {
      staff: { name: sessionUser.name, phone: sessionUser.phone },
      centre: null,
      todayIST,
    };
  }

  const centreInfo = (await db
    .prepare(
      `SELECT id, name, code, district, location, open_time as openTime, close_time as closeTime,
              daily_capacity as dailyCapacity, avg_service_time_mins as avgServiceTimeMins
       FROM procurement_centres
       WHERE id = ?`
    )
    .get(centre.id)) as any;

  const [serving, load, summaryRow, nextWaiting] = await Promise.all([
    currentlyServingToken(centre.id, todayIST),
    centreLoad(centre.id, todayIST),
    db
      .prepare(
        `SELECT
           COUNT(b.id) as totalBookings,
           COUNT(CASE WHEN b.status = 'BOOKED' THEN 1 END) as waiting,
           COUNT(CASE WHEN b.status IN ('ARRIVED', 'VERIFIED', 'WEIGHING', 'PROCUREMENT_IN_PROGRESS') THEN 1 END) as inProgress,
           COUNT(CASE WHEN b.status IN ('PROCUREMENT_COMPLETED', 'PAYMENT_PROCESSING', 'PAYMENT_COMPLETED') THEN 1 END) as completed
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         WHERE b.centre_id = ? AND s.date = ?`
      )
      .get(centre.id, todayIST) as Promise<any>,
    db
      .prepare(
        `SELECT b.token, cr.name as cropName, s.start_time as startTime, s.end_time as endTime, b.status
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         JOIN crops cr ON b.crop_id = cr.id
         WHERE b.centre_id = ? AND s.date = ? AND b.status IN ('BOOKED', 'ARRIVED')
         ORDER BY s.start_time ASC, b.created_at ASC
         LIMIT 5`
      )
      .all(centre.id, todayIST) as Promise<any[]>,
  ]);

  return {
    staff: { name: sessionUser.name, phone: sessionUser.phone },
    centre: centreInfo || centre,
    todayIST,
    queueStatus: {
      currentlyServingToken: serving || "None called yet",
      waitingFarmers: summaryRow?.waiting ?? load.waiting,
      inProgressCount: summaryRow?.inProgress ?? 0,
      completedTodayCount: summaryRow?.completed ?? 0,
      totalTodayBookings: summaryRow?.totalBookings ?? load.bookedCount,
      estimatedWaitMinutes: load.estimatedWaitMins,
      centreLoadLevel: load.load,
      dailyCapacityQuintal: centreInfo?.dailyCapacity || 120,
    },
    nextWaitingTokens: nextWaiting,
    procurementGuidelines: {
      qualityStandards: "Grade A FAQ (Fair Average Quality): Moisture limit <= 12%, Foreign organic matter <= 1%.",
      workflowSteps: "1. Call Next Farmer -> 2. Physical Check & Mark Arrived -> 3. Weighing & Grading -> 4. Record Weight & Complete -> 5. Farmer submits bank details -> 6. Admin bank DBT payment.",
    },
  };
}

async function getAdminContext(sessionUser: { name: string; phone: string }): Promise<any> {
  const todayIST = getTodayIST();
  const overview = await adminOverview();

  return {
    admin: { name: sessionUser.name, phone: sessionUser.phone },
    todayIST,
    procurementOverview: {
      totalRegisteredFarmers: overview.totalFarmers,
      totalStaffMembers: overview.totalStaff,
      totalProcurementCentres: overview.totalCentres,
      todaysBookings: overview.todaysBookings,
      activeQueuesPlatformWide: overview.activeQueues,
      completedProcurements: overview.completed,
      pendingPaymentsCount: overview.pendingPayments,
      noShowRatePercentage: `${overview.noShowRate}%`,
    },
    disbursementSummary: {
      totalDisbursedAmount: `₹${(overview.paymentStats?.paidAmount || 0).toLocaleString("en-IN")}`,
      pendingDisbursementAmount: `₹${(overview.paymentStats?.pendingAmount || 0).toLocaleString("en-IN")}`,
      paidRecordsCount: overview.paymentStats?.paidCount || 0,
      processingRecordsCount: overview.paymentStats?.processingCount || 0,
      pendingRecordsCount: overview.paymentStats?.pendingCount || 0,
      failedRecordsCount: overview.paymentStats?.failedCount || 0,
      onHoldRecordsCount: overview.paymentStats?.onHoldCount || 0,
    },
    centresOverview: overview.centreStatus.map((c: any) => ({
      name: c.name,
      code: c.code,
      district: c.district,
      currentLoad: c.load,
      waitingQueue: c.waiting,
      totalCapacity: c.totalCapacity,
      bookedCount: c.bookedCount,
    })),
  };
}

function generateStaffFallback(context: any): string {
  const c = context.centre;
  const q = context.queueStatus;
  return `Staff Operational Summary for ${c?.name || "your centre"} (${c?.code || "Mandi"}):\n` +
    `• Currently Serving Token: ${q?.currentlyServingToken || "None"}\n` +
    `• Waiting Farmers in Queue: ${q?.waitingFarmers ?? 0}\n` +
    `• In-Progress (Arrived/Weighing): ${q?.inProgressCount ?? 0}\n` +
    `• Completed Today: ${q?.completedTodayCount ?? 0}\n` +
    `• Mandi Operating Hours: ${c?.openTime || "09:00"} – ${c?.closeTime || "17:00"}\n` +
    `• Fair Average Quality (FAQ) Standard: Moisture <= 12%, Foreign matter <= 1% for Grade A.`;
}

function generateAdminFallback(context: any): string {
  const o = context.procurementOverview;
  const d = context.disbursementSummary;
  return `Admin Procurement & Platform Summary for today (${context.todayIST}):\n` +
    `• Platform Bookings Today: ${o?.todaysBookings ?? 0}\n` +
    `• Total Registered Farmers: ${o?.totalRegisteredFarmers ?? 0} | Active Mandis: ${o?.totalProcurementCentres ?? 0}\n` +
    `• Active Queue (Platform-wide): ${o?.activeQueuesPlatformWide ?? 0} farmers\n` +
    `• Completed Procurements: ${o?.completedProcurements ?? 0}\n` +
    `• Total Disbursed: ${d?.totalDisbursedAmount || "₹0"} (${d?.paidRecordsCount ?? 0} payments)\n` +
    `• Pending Bank Disbursement: ${d?.pendingDisbursementAmount || "₹0"} (${d?.pendingRecordsCount ?? 0} payments)`;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["FARMER", "STAFF", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Please login to access AI Assistant." }, { status: 401 });
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY || "").trim();
  const hasKey = Boolean(apiKey && !apiKey.startsWith("your_"));
  const configuredModel = UNIQUE_MODELS[0] || "gemini-3.5-flash-lite";

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
    isLive: hasKey,
    engine: "gemini",
    model: configuredModel,
    userRole: session.role,
    userName: session.name,
    defaultLanguage: "en",
    geminiDiagnostics,
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || !["FARMER", "STAFF", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Please login to access AI Assistant." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json(
        { error: "Please enter a valid message or question." },
        { status: 400 }
      );
    }

    // 1. Detect if this query needs verified Turso database context
    const needsDbContext = isApplicationSpecificQuery(message);

    // 2. Query Turso ONLY when application-specific data is needed, scoped strictly to user role
    let context: any = null;
    if (needsDbContext) {
      try {
        if (session.role === "FARMER") {
          const farmerId = (await getFarmerProfileId(session.id)) || session.id;
          if (farmerId) {
            context = await getFarmerContext(farmerId, { name: session.name, phone: session.phone });
          }
        } else if (session.role === "STAFF") {
          context = await getStaffContext(session.id, { name: session.name, phone: session.phone });
        } else if (session.role === "ADMIN") {
          context = await getAdminContext({ name: session.name, phone: session.phone });
        }
      } catch (dbErr: any) {
        console.warn("[Assistant] DB context lookup failed, continuing with Gemini general knowledge:", dbErr?.message);
        context = null;
      }
    }

    // Detect language of the incoming user message
    const detectedLanguage = detectLanguage(message);
    const apiKey = (process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY || "").trim();

    // 3. Build structured role-based system prompt for Gemini
    const roleGuidance =
      session.role === "FARMER"
        ? `You are assisting a registered Indian Farmer: "${session.name}".
Help them with their token status, queue position, Mandi timings, crop MSP rates, payment tracking, and farming guidance.`
        : session.role === "STAFF"
        ? `You are assisting an authorized Mandi Staff member: "${session.name}".
Help them manage today's queue at their procurement centre, understand procedural steps (Call Next, Arrived, Weighing, FAQ Grading, Procurement Complete), look up tokens, and ensure smooth Mandi operations.`
        : `You are assisting a Platform Administrator: "${session.name}".
Provide high-level operational statistics, payment disbursement totals, centre congestion monitoring, capacity overview, and administrative governance guidance.`;

    const dataContextBlock =
      needsDbContext && context
        ? `=== VERIFIED TURSO DATABASE CONTEXT FOR THIS ${session.role} ===
${JSON.stringify(context, null, 2)}
===================================================================
STRICT OPERATIONAL RULES FOR APPLICATION DATA:
- For questions regarding verified application records (tokens, queue counts, centres, payment amounts, dates), use EXCLUSIVELY the verified data provided in the database context above.
- NEVER invent, guess, or hallucinate token numbers, queue counts, payment amounts, or dates.
- SECURITY: Only discuss data belonging to this user's authorized role and scope.
  * A Farmer can only see their own profile, tokens, and payments.
  * Staff only sees their assigned centre's queue and tokens.
  * Admin sees platform-level summaries and governance information.`
        : `NOTE: This is a general query (or general agricultural/platform question). Answer directly using your agricultural, economic, and platform knowledge. Do not reference private records unless asked.`;

    const systemPrompt = `You are "KRISHIDHENU AI Assistant", an empathetic, truthful, and intelligent agricultural assistant for the KRISHIDHENU Digital Farmer Procurement & Smart Mandi Management Platform.

PLATFORM & PROJECT KNOWLEDGE:
- Platform Name: KRISHIDHENU (Smart Mandi & Digital Farmer Procurement Platform).
- Founder & Creator: Ayan Khan.
- What KRISHIDHENU does: It connects Indian farmers, Mandi staff, and administrators to streamline crop procurement at Minimum Support Price (MSP), eliminate physical mandi congestion with time-slotted digital tokens, provide transparent electronic weighing and quality grading, and ensure direct benefit transfer (DBT) bank payment tracking.
- CRITICAL IDENTITY RULE: You are an AI assistant built for KRISHIDHENU; you are NOT the founder. If asked who the founder or creator of KRISHIDHENU is, state clearly that Ayan Khan is the founder and creator, and that you are the platform's AI assistant.
- For unknown project-specific facts, state honestly that the information is not available rather than guessing or hallucinating.

USER ROLE CONTEXT:
${roleGuidance}

${dataContextBlock}

LANGUAGE & CONVERSATION RULES:
- Detect the language of the user's latest message and reply in that same language:
  * English user message -> Reply in English.
  * Hindi user message (Devanagari or Hindi) -> Reply in natural, clear Hindi (Devanagari script).
  * Hinglish user message (Hindi written in Roman/English alphabet) -> Reply in natural Hinglish.
- If the user explicitly requests a language (e.g. "Explain MSP in simple Hindi"), strictly follow their language instruction.
- Address the user respectfully: "Greetings [Name]" in English, "नमस्ते [Name] जी" in Hindi, or "Namaste [Name] ji" in Hinglish.
- Keep answers clear, supportive, and concise. Avoid dense walls of text; use bullet points where helpful.`;

    let liveGeminiReply: string | null = null;
    let successfulModel: string = UNIQUE_MODELS[0] || "gemini-3.5-flash-lite";
    let lastStatus = 0;
    let lastReason = "";
    let lastErrorMessage = "";
    let responseTimeMs = 0;
    const startTime = Date.now();

    // 4. PRIMARY ENGINE: REAL GEMINI API REQUEST
    if (apiKey && !apiKey.startsWith("your_")) {
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
              break; // Success! Exit loop
            }
          } else {
            const errJson = await response.json().catch(() => ({}));
            lastReason = errJson?.error?.details?.[0]?.reason || errJson?.error?.status || "API_ERROR";
            lastErrorMessage = errJson?.error?.message || response.statusText || `HTTP ${response.status}`;
            console.warn(`[Gemini API] Model ${modelToTry} attempt failed: HTTP ${response.status} (${lastReason})`);
            continue;
          }
        } catch (err: any) {
          clearTimeout(timeout);
          responseTimeMs = Date.now() - startTime;
          lastStatus = err?.name === "AbortError" ? 504 : 500;
          lastReason = err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
          lastErrorMessage = err?.name === "AbortError" ? "Request timed out" : "Network exception";
          continue;
        }
      }
    } else {
      lastStatus = 0;
      lastReason = "API_KEY_UNCONFIGURED";
      lastErrorMessage = "GEMINI_API_KEY environment variable is not configured.";
    }

    // 5. SUCCESS: Return Genuine Gemini AI Response
    if (liveGeminiReply) {
      return NextResponse.json({
        reply: liveGeminiReply,
        source: needsDbContext && context ? "gemini_db" : "gemini",
        isLive: true,
        model: successfulModel,
        responseTimeMs,
        language: detectedLanguage,
        userRole: session.role,
      });
    }

    // 6. EMERGENCY FALLBACK
    // Gemini API failed across all attempts.
    // If it was an application-specific query and we have valid Turso database records,
    // invoke the deterministic engine as an EMERGENCY FALLBACK only.
    if (needsDbContext && context) {
      console.warn(`[Assistant] Gemini unavailable (${lastReason}). Using emergency database fallback for application query.`);
      let fallbackReply = "";
      if (session.role === "FARMER") {
        fallbackReply = generateIntelligentFarmerResponse({
          message,
          context,
          language: detectedLanguage,
          sessionName: session.name,
        });
      } else if (session.role === "STAFF") {
        fallbackReply = generateStaffFallback(context);
      } else if (session.role === "ADMIN") {
        fallbackReply = generateAdminFallback(context);
      }

      return NextResponse.json({
        reply: fallbackReply,
        source: "database_fallback",
        isLive: false,
        model: "database-fallback",
        responseTimeMs: responseTimeMs || (Date.now() - startTime),
        language: detectedLanguage,
        userRole: session.role,
      });
    }

    // For general queries (or when context is unavailable), show a clear AI connection error
    return NextResponse.json(
      {
        error: "Gemini AI Assistant is temporarily unavailable. Please check your internet connection or try again shortly.",
        source: "error",
        isLive: false,
        diagnostics: {
          status: lastStatus,
          reason: lastReason,
        },
      },
      { status: 503 }
    );
  } catch (error: any) {
    console.error("[Assistant] Unexpected handler error:", error?.message);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
