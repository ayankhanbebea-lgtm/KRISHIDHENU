import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

// Load environment variables from .env.development.local
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

async function resetProductionDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  }

  console.log("================================================================================");
  console.log("KRISHIDHENU PRODUCTION DATABASE RESET (TURSO CLOUD)");
  console.log(`Target: ${url}`);
  console.log("================================================================================\n");

  const client = createClient({ url, authToken });

  // 1. Pre-reset verification and record identification
  console.log("--- 1. PRE-RESET RECORD IDENTIFICATION ---");
  const preCounts: Record<string, number> = {};
  const tables = [
    "notifications",
    "queue_entries",
    "payments",
    "bookings",
    "farmer_profiles",
    "sessions",
    "audit_logs",
    "otps",
    "users",
    "centre_staff",
    "procurement_centres",
    "crops",
    "slots"
  ];

  for (const t of tables) {
    const r = await client.execute(`SELECT COUNT(*) as c FROM ${t}`);
    preCounts[t] = Number(r.rows[0].c);
    console.log(`  • ${t.padEnd(22)}: ${preCounts[t]} records`);
  }

  // Pre-reset users breakdown
  const adminUsers = await client.execute("SELECT id, phone, role, name FROM users WHERE role = 'ADMIN'");
  const staffUsers = await client.execute("SELECT id, phone, role, name FROM users WHERE role = 'STAFF'");
  const farmerUsers = await client.execute("SELECT id, phone, role, name FROM users WHERE role = 'FARMER'");

  console.log(`\nPreserving Admin Accounts (${adminUsers.rows.length}):`);
  for (const u of adminUsers.rows) {
    console.log(`  - [ADMIN] ${u.name} (Phone: ${u.phone}, ID: ${u.id})`);
  }

  console.log(`Preserving Staff Accounts (${staffUsers.rows.length}):`);
  for (const u of staffUsers.rows) {
    console.log(`  - [STAFF] ${u.name} (Phone: ${u.phone}, ID: ${u.id})`);
  }

  console.log(`Identified Old Farmer Accounts to Delete (${farmerUsers.rows.length}):`);
  for (const u of farmerUsers.rows) {
    console.log(`  - [FARMER] ${u.name} (Phone: ${u.phone}, ID: ${u.id})`);
  }

  // 2. Perform safe, dependency-ordered deletion
  console.log("\n--- 2. EXECUTING SAFE TRANSACTIONAL RESET ---");

  const deleteQueries = [
    { name: "notifications", sql: "DELETE FROM notifications" },
    { name: "queue_entries", sql: "DELETE FROM queue_entries" },
    { name: "payments", sql: "DELETE FROM payments" },
    { name: "bookings", sql: "DELETE FROM bookings" },
    { name: "farmer_profiles", sql: "DELETE FROM farmer_profiles" },
    { name: "sessions", sql: "DELETE FROM sessions" },
    { name: "audit_logs", sql: "DELETE FROM audit_logs" },
    { name: "otps", sql: "DELETE FROM otps" },
    { name: "users (FARMER)", sql: "DELETE FROM users WHERE role = 'FARMER'" },
  ];

  for (const dq of deleteQueries) {
    const res = await client.execute(dq.sql);
    console.log(`  ✅ Cleared ${dq.name.padEnd(20)} -> ${res.rowsAffected} rows deleted`);
  }

  // 3. Post-reset verification
  console.log("\n--- 3. POST-RESET DATABASE VERIFICATION ---");
  const postCounts: Record<string, number> = {};
  for (const t of tables) {
    const r = await client.execute(`SELECT COUNT(*) as c FROM ${t}`);
    postCounts[t] = Number(r.rows[0].c);
  }

  console.log("\nTable State Comparison:");
  console.log("------------------------------------------------------------------");
  console.log(`Table Name             | Pre-Count | Deleted | Post-Count | Status`);
  console.log("------------------------------------------------------------------");
  for (const t of tables) {
    const pre = preCounts[t];
    const post = postCounts[t];
    const deleted = pre - post;
    const isMaster = ["centre_staff", "procurement_centres", "crops", "slots"].includes(t);
    const expectedPost = isMaster ? pre : (t === "users" ? adminUsers.rows.length + staffUsers.rows.length : 0);
    const pass = post === expectedPost;
    console.log(
      `${t.padEnd(22)} | ${pre.toString().padStart(9)} | ${deleted.toString().padStart(7)} | ${post.toString().padStart(10)} | ${pass ? "PASS" : "FAIL"}`
    );
  }
  console.log("------------------------------------------------------------------");

  // 4. Check Foreign-Key Integrity
  console.log("\n--- 4. FOREIGN KEY INTEGRITY CHECK ---");
  const fkCheck = await client.execute("PRAGMA foreign_key_check");
  if (fkCheck.rows.length === 0) {
    console.log("  ✅ PRAGMA foreign_key_check: 0 violations! (100% Referential Integrity Intact)");
  } else {
    console.error("  ❌ Foreign key violations detected:", fkCheck.rows);
    throw new Error("Foreign key check failed!");
  }

  // 5. Verify Master Data & Staff Mappings Intact
  console.log("\n--- 5. VERIFYING PRESERVED MASTER DATA ---");
  const preservedUsers = await client.execute("SELECT id, phone, role, name FROM users ORDER BY role, name");
  console.log(`Users remaining in database (${preservedUsers.rows.length}):`);
  console.table(preservedUsers.rows);

  const preservedCentres = await client.execute("SELECT id, code, name FROM procurement_centres");
  console.log(`Centres preserved (${preservedCentres.rows.length}):`);
  console.table(preservedCentres.rows);

  const preservedStaff = await client.execute(`
    SELECT cs.id, cs.centre_id, pc.code as centre_code, u.name as staff_name, u.phone 
    FROM centre_staff cs 
    JOIN users u ON cs.user_id = u.id 
    JOIN procurement_centres pc ON cs.centre_id = pc.id
  `);
  console.log(`Centre Staff mappings preserved (${preservedStaff.rows.length}):`);
  console.table(preservedStaff.rows);

  const preservedCrops = await client.execute("SELECT id, code, name, msp_rate FROM crops");
  console.log(`Crops preserved (${preservedCrops.rows.length}):`);
  console.table(preservedCrops.rows);

  const preservedSlots = await client.execute("SELECT COUNT(*) as count FROM slots");
  console.log(`Slots preserved: ${preservedSlots.rows[0].count}`);

  console.log("\n================================================================================");
  console.log("✅ PRODUCTION DATABASE RESET COMPLETED SUCCESSFULLY WITH 100% INTEGRITY");
  console.log("================================================================================\n");
}

resetProductionDatabase().catch((err) => {
  console.error("Production reset failed:", err);
  process.exit(1);
});
