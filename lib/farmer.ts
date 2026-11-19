import { getDb, newId, nowIso } from "./db";

export const MAX_ACTIVE_BOOKINGS = 3;

export const ACTIVE_BOOKING_STATUSES = [
  "BOOKED",
  "ARRIVED",
  "VERIFIED",
  "WEIGHING",
  "PROCUREMENT_IN_PROGRESS",
  "PAYMENT_PROCESSING",
] as const;

export const CLEARED_BOOKING_STATUSES = [
  "PROCUREMENT_COMPLETED",
  "PAYMENT_COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export function getFarmerProfileId(userId: string): string | null {
  const db = getDb();
  let row = db.prepare(`SELECT id FROM farmer_profiles WHERE user_id = ?`).get(userId) as
    | { id: string }
    | undefined;
  if (!row) {
    const user = db.prepare(`SELECT id, phone, role FROM users WHERE id = ?`).get(userId) as any;
    if (user && user.role === "FARMER") {
      const fpId = newId("frm_");
      const code = `FP-${user.phone ? user.phone.slice(-4) : Date.now().toString().slice(-4)}`;
      try {
        db.prepare(
          `INSERT INTO farmer_profiles (id, user_id, address, district, state, farmer_code, language, created_at, updated_at)
           VALUES (?, ?, 'Registered Farmer', 'Jaipur', 'Rajasthan', ?, 'en', ?, ?)`
        ).run(fpId, userId, code, nowIso(), nowIso());
        row = { id: fpId };
      } catch {
        row = db.prepare(`SELECT id FROM farmer_profiles WHERE user_id = ?`).get(userId) as any;
      }
    }
  }
  return row?.id ?? null;
}

export function getFarmerActiveBookingsCount(farmerId: string): number {
  const db = getDb();
  const placeholders = ACTIVE_BOOKING_STATUSES.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM bookings WHERE farmer_id = ? AND status IN (${placeholders})`)
    .get(farmerId, ...ACTIVE_BOOKING_STATUSES) as { count: number };
  return row?.count || 0;
}

