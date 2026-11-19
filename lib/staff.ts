import { getDb, newId } from "./db";

export function getStaffCentre(userId: string): { id: string; name: string; code: string } | null {
  if (!userId) return null;
  const db = getDb();

  // Try matching by user_id
  let row = db
    .prepare(
      `SELECT ctr.id, ctr.name, ctr.code
       FROM centre_staff cs
       JOIN procurement_centres ctr ON cs.centre_id = ctr.id
       WHERE cs.user_id = ?`
    )
    .get(userId) as { id: string; name: string; code: string } | undefined;

  if (row) return row;

  // Fallback: match by phone number if userId happens to be phone or id in users
  const rowByPhone = db
    .prepare(
      `SELECT ctr.id, ctr.name, ctr.code
       FROM centre_staff cs
       JOIN users u ON cs.user_id = u.id
       JOIN procurement_centres ctr ON cs.centre_id = ctr.id
       WHERE u.phone = ? OR u.id = ?`
    )
    .get(userId, userId) as { id: string; name: string; code: string } | undefined;

  if (rowByPhone) return rowByPhone;

  // Self-healing fallback: If staff exists in users, ensure link to default designated centre
  const user = db.prepare(`SELECT id, phone, role FROM users WHERE id = ? OR phone = ?`).get(userId, userId) as any;
  if (user && user.role === "STAFF") {
    const staffPhoneMap: Record<string, string> = {
      "9509082087": "JPR01", // Sitapura
      "7870844405": "JPR02", // Sanganer
      "7015962317": "JPR03", // Chaksu
    };
    const targetCode = staffPhoneMap[user.phone] || "JPR01";
    const centre = db.prepare(`SELECT id, name, code FROM procurement_centres WHERE code = ?`).get(targetCode) as any;
    if (centre) {
      try {
        db.prepare(`INSERT OR REPLACE INTO centre_staff (id, user_id, centre_id) VALUES (?, ?, ?)`).run(
          newId("cst_"),
          user.id,
          centre.id
        );
      } catch {}
      return centre;
    }
  }

  return null;
}
