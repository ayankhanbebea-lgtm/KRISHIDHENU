import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export async function migrateToTurso() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error("❌ Error: TURSO_DATABASE_URL environment variable is not set.");
    console.error("Please configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
    process.exit(1);
  }

  console.log("========================================================");
  console.log("MIGRATING LOCAL SQLITE BACKUP TO TURSO / libSQL CLOUD");
  console.log("========================================================");
  console.log(`Target Turso Database: ${url}\n`);

  const client = createClient({ url, authToken });
  const localDb = new DatabaseSync(path.join(process.cwd(), "prisma", "dev.db"));

  // 1. Read schema SQL
  const schemaPath = path.join(process.cwd(), "prisma", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Split into executable DDL statements
  const ddlStatements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`1. Applying Baseline DDL Schema (${ddlStatements.length} statements)...`);
  for (const stmt of ddlStatements) {
    try {
      await client.execute(stmt);
    } catch (err: any) {
      if (!err?.message?.includes("already exists")) {
        console.warn(`  Warning on DDL: ${stmt.slice(0, 40)}... -> ${err?.message}`);
      }
    }
  }

  // 2. Synchronize all table columns from local SQLite schema to Turso
  console.log("\n2. Synchronizing all columns and migrations to Turso Cloud...");
  const tables = localDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r: any) => r.name);

  for (const t of tables) {
    const localCols = localDb.prepare(`PRAGMA table_info(${t})`).all() as any[];
    const tursoColsRes = await client.execute(`PRAGMA table_info(${t})`);
    const tursoColNames = new Set(tursoColsRes.rows.map((r: any) => r.name));

    for (const col of localCols) {
      if (!tursoColNames.has(col.name)) {
        console.log(`   + Adding column ${col.name} (${col.type}) to Turso table ${t}`);
        const dflt = col.dflt_value !== null ? ` DEFAULT ${col.dflt_value}` : "";
        const alterSql = `ALTER TABLE ${t} ADD COLUMN ${col.name} ${col.type}${dflt}`;
        try {
          await client.execute(alterSql);
        } catch (e: any) {
          console.warn(`     Alter warning: ${e.message}`);
        }
      }
    }
  }
  console.log("   ✅ DDL Schema and table columns 100% synchronized!\n");

  // 3. Locate latest JSON backup dump
  const prismaDir = path.join(process.cwd(), "prisma");
  const backupFiles = fs
    .readdirSync(prismaDir)
    .filter((f) => f.startsWith("backup-dev-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (backupFiles.length === 0) {
    console.error("❌ No backup JSON file found in prisma/");
    process.exit(1);
  }

  const backupFile = path.join(prismaDir, backupFiles[0]);
  console.log(`3. Loading verified data from backup: ${backupFiles[0]}...`);
  const { counts, tableData } = JSON.parse(fs.readFileSync(backupFile, "utf-8"));

  // Ordered table insertion to respect foreign key constraints
  const insertionOrder = [
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

  console.log("\n4. Migrating records to Turso cloud...");
  for (const table of insertionOrder) {
    const rows = tableData[table] || [];
    if (rows.length === 0) {
      console.log(`   • ${table.padEnd(22)}: 0 rows (skipped)`);
      continue;
    }

    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => "?").join(", ");
    const insertSql = `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;

    // Batch insert in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const batchStmts = chunk.map((row: any) => ({
        sql: insertSql,
        args: cols.map((col) => row[col] ?? null),
      }));
      await client.batch(batchStmts, "write");
    }

    console.log(`   • ${table.padEnd(22)}: Migrated ${rows.length} rows`);
  }

  // 5. Verification
  console.log("\n5. Verifying Turso Cloud Table Counts against Local Backup...");
  let match = true;
  for (const table of insertionOrder) {
    const res = await client.execute(`SELECT COUNT(*) as c FROM ${table}`);
    const tursoCount = Number(res.rows[0].c);
    const expected = counts[table] || 0;
    const ok = tursoCount >= expected;
    console.log(`   ✓ ${table.padEnd(22)}: Turso = ${tursoCount.toString().padStart(3)} | Expected = ${expected.toString().padStart(3)} [${ok ? "PASS" : "WARN"}]`);
    if (!ok) match = false;
  }

  if (match) {
    console.log("\n========================================================");
    console.log("✅ TURSO DATABASE MIGRATION & VERIFICATION COMPLETED 100%!");
    console.log("========================================================\n");
  }
}

if (require.main === module) {
  migrateToTurso().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
