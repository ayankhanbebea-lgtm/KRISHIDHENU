import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { recordAudit, sendNotification } from "@/lib/services";
import { normalizeDateToYMD } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const reqStart = Date.now();
  const requestId = `adm_bkg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();

  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const dbIdentifier = process.env.DATABASE_PATH ? "custom_env_db" : "default_sqlite_db";

  const url = new URL(req.url);
  const rawDate = url.searchParams.get("date") || "";
  const centreId = url.searchParams.get("centreId") || "";
  const status = url.searchParams.get("status") || "";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 25;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const vals: unknown[] = [];
  if (rawDate) { conditions.push("s.date = ?"); vals.push(normalizeDateToYMD(rawDate)); }
  if (centreId) { conditions.push("b.centre_id = ?"); vals.push(centreId); }
  if (status) { conditions.push("b.status = ?"); vals.push(status); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const bookings = db.prepare(`
    SELECT b.id, b.token, b.status, b.quantity_quintal as quantityQuintal, b.actual_quantity as actualQuantity,
           b.created_at as createdAt, u.name as farmerName, u.phone as farmerPhone,
           c.name as centreName, cr.name as cropName, s.date, s.start_time as startTime,
           COALESCE(p.payment_status, p.status) as paymentStatus,
           COALESCE(p.total_amount, p.amount) as paymentAmount,
           q.position as queuePosition
    FROM bookings b
    JOIN farmer_profiles fp ON b.farmer_id = fp.id
    JOIN users u ON fp.user_id = u.id
    JOIN procurement_centres c ON b.centre_id = c.id
    JOIN crops cr ON b.crop_id = cr.id
    JOIN slots s ON b.slot_id = s.id
    LEFT JOIN payments p ON p.booking_id = b.id
    LEFT JOIN queue_entries q ON q.booking_id = b.id
    ${where}
    ORDER BY b.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...vals, limit, offset);

  const totalRow = db.prepare(`
    SELECT COUNT(*) as c FROM bookings b
    JOIN slots s ON b.slot_id = s.id
    ${where}
  `).get(...vals) as { c: number };

  const duration = Date.now() - reqStart;
  console.log(`[ADMIN_BOOKINGS_TRACE] reqId=${requestId} time=${timestamp} db=${dbIdentifier} date=${rawDate || "all"} centre=${centreId || "all"} total=${totalRow.c} duration=${duration}ms`);

  const response = NextResponse.json({ bookings, total: totalRow.c, page, limit, requestId, timestamp });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("X-Request-Id", requestId);

  return response;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body?.action !== "CANCEL" || !body?.bookingId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const db = getDb();
  const booking = db.prepare(`SELECT id, status, token, farmer_id as farmerId FROM bookings WHERE id = ?`).get(body.bookingId) as any;
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (["PAYMENT_COMPLETED", "CANCELLED"].includes(booking.status)) {
    return NextResponse.json({ error: `Cannot cancel a ${booking.status} booking` }, { status: 409 });
  }
  db.prepare(`UPDATE bookings SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).run(nowIso(), body.bookingId);
  // Get farmer user_id for notification
  const farmerUser = db.prepare(`SELECT u.id FROM farmer_profiles fp JOIN users u ON fp.user_id = u.id WHERE fp.id = ?`).get(booking.farmerId) as any;
  if (farmerUser) {
    sendNotification(farmerUser.id, "BOOKING_CANCELLED", `Your booking ${booking.token} was cancelled by admin.`, body.bookingId);
  }
  recordAudit(session.id, "ADMIN_CANCEL_BOOKING", "booking", body.bookingId);
  return NextResponse.json({ ok: true });
}