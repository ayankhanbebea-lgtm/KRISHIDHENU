import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { currentlyServingToken, centreLoad } from "@/lib/services";
import { getTodayIST, normalizeDateToYMD } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const reqStart = Date.now();
  const requestId = `adm_q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();

  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const dbIdentifier = process.env.DATABASE_PATH ? "custom_env_db" : "default_sqlite_db";

  const url = new URL(req.url);
  const rawDate = url.searchParams.get("date");
  const date = rawDate ? normalizeDateToYMD(rawDate) : getTodayIST();

  const centres = db.prepare(`SELECT id, name, code FROM procurement_centres ORDER BY name`).all() as any[];
  
  let totalAcrossCentres = 0;
  const result = centres.map((centre) => {
    const queue = db.prepare(`
      SELECT b.id, b.token, b.status, u.name as farmerName, u.phone as farmerPhone,
             q.position, q.called_at as calledAt, cr.name as cropName
      FROM queue_entries q
      JOIN bookings b ON q.booking_id = b.id
      JOIN farmer_profiles fp ON b.farmer_id = fp.id
      JOIN users u ON fp.user_id = u.id
      JOIN crops cr ON b.crop_id = cr.id
      WHERE q.centre_id = ? AND q.date = ?
      ORDER BY q.position ASC
    `).all(centre.id, date) as any[];
    
    totalAcrossCentres += queue.length;
    const serving = currentlyServingToken(centre.id, date);
    const load = centreLoad(centre.id, date);
    
    return { ...centre, queue, serving, load };
  });

  const duration = Date.now() - reqStart;
  console.log(`[ADMIN_QUEUE_TRACE] reqId=${requestId} time=${timestamp} db=${dbIdentifier} date=${date} centres=${centres.length} totalBookings=${totalAcrossCentres} duration=${duration}ms`);
  
  const response = NextResponse.json({ centres: result, date, requestId, timestamp });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("X-Request-Id", requestId);

  return response;
}
