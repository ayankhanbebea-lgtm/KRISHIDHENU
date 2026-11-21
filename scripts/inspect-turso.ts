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

async function finalAudit() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const tables = [
    "users",
    "farmer_profiles",
    "procurement_centres",
    "centre_staff",
    "crops",
    "slots",
    "bookings",
    "queue_entries",
    "payments",
    "notifications",
    "otps",
    "sessions",
    "audit_logs",
  ];

  console.log("=================================================");
  console.log("CURRENT ACTIVE TURSO PRODUCTION DATABASE STATUS");
  console.log("=================================================");
  for (const t of tables) {
    const r = await client.execute(`SELECT COUNT(*) as c FROM ${t}`);
    console.log(`${t.padEnd(22)}: ${r.rows[0].c}`);
  }

  const fk = await client.execute("PRAGMA foreign_key_check");
  console.log(`\nForeign Key Violations: ${fk.rows.length}`);

  const users = await client.execute("SELECT id, phone, role, name FROM users");
  console.log(`\nUsers (${users.rows.length}):`);
  console.table(users.rows);

  const bookings = await client.execute("SELECT id, token, token_seq, status FROM bookings");
  console.log(`\nBookings (${bookings.rows.length}):`);
  console.table(bookings.rows);

  const payments = await client.execute("SELECT id, booking_id, token_number, payment_status, total_amount FROM payments");
  console.log(`\nPayments (${payments.rows.length}):`);
  console.table(payments.rows);
}

finalAudit().catch(console.error);
