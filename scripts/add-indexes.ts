import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

try {
  const envContent = fs.readFileSync(path.join(process.cwd(), ".env.development.local"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
} catch (e) {}

async function addIndexes() {
  const url = process.env.TURSO_DATABASE_URL!;
  const authToken = process.env.TURSO_AUTH_TOKEN!;
  const client = createClient({ url, authToken });

  console.log("Applying missing performance indexes to Turso production database...");

  const newIndexes = [
    "CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id)",
    "CREATE INDEX IF NOT EXISTS idx_bookings_slot_id ON bookings(slot_id)",
    "CREATE INDEX IF NOT EXISTS idx_bookings_farmer_id ON bookings(farmer_id)",
    "CREATE INDEX IF NOT EXISTS idx_slots_centre_date ON slots(centre_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)",
  ];

  for (const sql of newIndexes) {
    const t0 = Date.now();
    await client.execute(sql);
    console.log(`✅ Applied: ${sql} (${Date.now() - t0}ms)`);
  }

  const allIdx = await client.execute("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'");
  console.log("\nAll indexes now active in Turso:");
  console.table(allIdx.rows);
}

addIndexes().catch(console.error);
