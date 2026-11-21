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

async function benchmarkQueries() {
  const url = process.env.TURSO_DATABASE_URL!;
  const authToken = process.env.TURSO_AUTH_TOKEN!;
  const client = createClient({ url, authToken });

  console.log("================================================================================");
  console.log("PHASE 1: MEASURING TURSO DATABASE QUERY TIMES (Round-Trip Latencies)");
  console.log("================================================================================\n");

  const queries = [
    {
      name: "1. Staff Queue Main Query (all centre rows)",
      sql: `SELECT b.id, b.token, b.status, b.quantity_quintal as quantityQuintal, b.actual_quantity as actualQuantity,
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
            WHERE b.centre_id = 'ctr_mtbty52pemlgmnlg'`,
    },
    {
      name: "2. Staff Upcoming Grouping Query",
      sql: `SELECT s.date, COUNT(b.id) as count
            FROM bookings b
            JOIN slots s ON b.slot_id = s.id
            WHERE b.centre_id = 'ctr_mtbty52pemlgmnlg' AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
            GROUP BY s.date
            ORDER BY s.date ASC`,
    },
    {
      name: "3. Staff Queue 'Currently Serving' Query",
      sql: `SELECT b.token FROM queue_entries q
            JOIN bookings b ON q.booking_id = b.id
            WHERE q.centre_id = 'ctr_mtbty52pemlgmnlg' AND q.date = '2026-11-21' AND q.called_at IS NOT NULL
            ORDER BY q.called_at DESC LIMIT 1`,
    },
    {
      name: "4. Staff Queue 'Centre Load' Query",
      sql: `SELECT COUNT(*) as c FROM bookings b
            JOIN slots s ON b.slot_id = s.id
            WHERE b.centre_id = 'ctr_mtbty52pemlgmnlg' AND s.date = '2026-11-21' AND b.status NOT IN ('CANCELLED', 'NO_SHOW')`,
    },
    {
      name: "5. Admin Bookings Query",
      sql: `SELECT b.id, b.token, b.status, b.quantity_quintal as quantityQuintal, b.actual_quantity as actualQuantity,
                   b.created_at as createdAt, u.name as farmerName, u.phone as farmerPhone,
                   ctr.name as centreName, c.name as cropName, s.date, s.start_time as startTime,
                   p.status as paymentStatus, p.amount as paymentAmount, q.position as queuePosition
            FROM bookings b
            JOIN farmer_profiles fp ON b.farmer_id = fp.id
            JOIN users u ON fp.user_id = u.id
            JOIN procurement_centres ctr ON b.centre_id = ctr.id
            JOIN crops c ON b.crop_id = c.id
            JOIN slots s ON b.slot_id = s.id
            LEFT JOIN payments p ON p.booking_id = b.id
            LEFT JOIN queue_entries q ON q.booking_id = b.id
            ORDER BY b.created_at DESC`,
    },
    {
      name: "6. Admin Payments Query",
      sql: `SELECT p.*, b.token as bookingToken, b.status as bookingStatus,
                   ctr.name as centreName, ctr.code as centreCode, u.phone as farmerPhone
            FROM payments p
            JOIN bookings b ON p.booking_id = b.id
            JOIN procurement_centres ctr ON p.procurement_centre_id = ctr.id
            JOIN farmer_profiles fp ON p.farmer_id = fp.id
            JOIN users u ON fp.user_id = u.id
            ORDER BY p.created_at DESC`,
    },
  ];

  for (const q of queries) {
    const start = Date.now();
    const res = await client.execute(q.sql);
    const duration = Date.now() - start;
    console.log(`${q.name.padEnd(50)}: ${duration}ms (${res.rows.length} rows returned)`);
  }

  // Also check database indexes on slots, bookings, queue_entries, payments
  console.log("\n--- CURRENT INDEXES IN PRODUCTION ---");
  const indexes = await client.execute(
    "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
  );
  console.table(indexes.rows);
}

benchmarkQueries().catch(console.error);
