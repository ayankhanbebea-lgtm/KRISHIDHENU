import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStaffCentre } from "@/lib/staff";
import { currentlyServingToken, centreLoad } from "@/lib/services";
import { getTodayIST, normalizeDateToYMD } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const reqStart = Date.now();
  const requestId = `staff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();

  const session = await getSession(req);
  if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
    return NextResponse.json(
      { error: "Please login with a Staff account (e.g. 9100000002 for Centre 02)." },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const requestedCentreId = url.searchParams.get("centreId");
  const requestedDate = url.searchParams.get("date");
  const todayIST = getTodayIST();

  const db = getDb();

  let centre = requestedCentreId
    ? ((await db.prepare(`SELECT id, name, code FROM procurement_centres WHERE id = ?`).get(requestedCentreId)) as any)
    : null;
  if (!centre) centre = await getStaffCentre(session.id);
  if (!centre) {
    centre = (await db.prepare(`SELECT id, name, code FROM procurement_centres ORDER BY code ASC LIMIT 1`).get()) as any;
  }

  if (!centre) {
    return NextResponse.json({ error: "No procurement centre found." }, { status: 404 });
  }

  // Filter by date if requested (unless "all")
  const activeDate = !requestedDate || requestedDate === "undefined" ? todayIST : requestedDate === "all" ? "all" : normalizeDateToYMD(requestedDate);
  const targetServingDate = activeDate === "all" ? todayIST : activeDate;

  // Execute independent queries in parallel via Promise.all to minimize round-trip latency
  const [allRows, upcomingSummary, allCentres, serving, load] = await Promise.all([
    db
      .prepare(
        `SELECT b.id, b.token, b.status, b.quantity_quintal as quantityQuintal, b.actual_quantity as actualQuantity,
                b.quality_grade as qualityGrade, b.created_at as createdAt, b.updated_at as updatedAt,
                u.name as farmerName, u.phone as farmerPhone,
                c.id as centreId, c.name as centreName, c.code as centreCode,
                cr.name as cropName, cr.code as cropCode, COALESCE(cr.msp_rate, 2275) as cropMsp,
                s.date as slotDate, s.start_time as startTime, s.end_time as endTime,
                COALESCE(q.position, 1) as position, q.called_at as calledAt,
                COALESCE(p.payment_status, p.status) as paymentStatus,
                COALESCE(p.final_payable_amount, p.total_amount, p.amount) as paymentAmount,
                p.rate_per_unit as ratePerUnit, p.deductions as deductions, p.transaction_id as transactionId
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         JOIN farmer_profiles fp ON b.farmer_id = fp.id
         JOIN users u ON fp.user_id = u.id
         JOIN procurement_centres c ON b.centre_id = c.id
         JOIN crops cr ON b.crop_id = cr.id
         LEFT JOIN queue_entries q ON q.booking_id = b.id
         LEFT JOIN payments p ON p.booking_id = b.id
         WHERE b.centre_id = ?
         ORDER BY s.date ASC, COALESCE(q.position, 999) ASC, b.created_at ASC`
      )
      .all(centre.id) as Promise<any[]>,

    db
      .prepare(
        `SELECT s.date, COUNT(b.id) as count
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         WHERE b.centre_id = ? AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
         GROUP BY s.date
         ORDER BY s.date ASC`
      )
      .all(centre.id) as Promise<{ date: string; count: number }[]>,

    db.prepare(`SELECT id, name, code FROM procurement_centres ORDER BY code ASC`).all() as Promise<any[]>,

    currentlyServingToken(centre.id, targetServingDate),
    centreLoad(centre.id, targetServingDate),
  ]);

  // Normalized date comparison
  const filteredRows = activeDate === "all"
    ? allRows
    : allRows.filter((r) => normalizeDateToYMD(r.slotDate) === activeDate);

  const activeTotal = allRows.filter(
    (r) => !["COMPLETED", "PROCUREMENT_COMPLETED", "PAYMENT_PROCESSING", "PAYMENT_COMPLETED", "CANCELLED", "NO_SHOW"].includes(r.status)
  ).length;

  const summary = {
    total: filteredRows.length,
    waiting: filteredRows.filter((r) => r.status === "BOOKED").length,
    inProgress: filteredRows.filter((r) => ["ARRIVED", "VERIFIED", "WEIGHING", "PROCUREMENT_IN_PROGRESS"].includes(r.status)).length,
    completed: filteredRows.filter((r) => ["PROCUREMENT_COMPLETED", "PAYMENT_PROCESSING", "PAYMENT_COMPLETED"].includes(r.status)).length,
    paymentPending: filteredRows.filter((r) => r.paymentStatus && r.paymentStatus !== "PAID").length,
  };

  const respEnd = Date.now();
  console.log(`[STAFF_QUEUE_TRACE] reqId=${requestId} time=${timestamp} centre=${centre.code} date=${activeDate} total=${filteredRows.length} active=${activeTotal} duration=${respEnd - reqStart}ms`);

  const response = NextResponse.json({
    requestId,
    timestamp,
    centre,
    allCentres,
    date: activeDate,
    todayIST,
    totalCentreBookings: allRows.length,
    activeTotal,
    rows: filteredRows,
    summary,
    upcomingSummary,
    serving,
    load,
    debug: {
      dbIdentifier: "turso_cloud",
      executionMs: respEnd - reqStart,
      isCache: false,
    },
  });

  // Strict anti-caching headers for real-time queue data
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Response-Time", String(respEnd));

  return response;
}
