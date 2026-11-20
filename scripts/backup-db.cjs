const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

async function backup() {
  const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
  if (!fs.existsSync(dbPath)) {
    console.error('Database file does not exist at:', dbPath);
    process.exit(1);
  }

  console.log('Inspecting database at:', dbPath);
  const db = new DatabaseSync(dbPath);

  // 1. Get all table names
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  console.log('\n--- 1. Tables Found (' + tables.length + ') ---');

  // 2. Count records in each table
  const counts = {};
  const tableData = {};
  for (const t of tables) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
    counts[t] = count;
    const rows = db.prepare(`SELECT * FROM ${t}`).all();
    tableData[t] = rows;
    console.log(`  • ${t.padEnd(22)}: ${count} records`);
  }

  // 3. Create full timestamped backup files
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDbPath = path.join(process.cwd(), 'prisma', `backup-dev-${timestamp}.db`);
  const backupJsonPath = path.join(process.cwd(), 'prisma', `backup-dev-${timestamp}.json`);

  // Copy raw binary SQLite file
  fs.copyFileSync(dbPath, backupDbPath);
  console.log('\n--- 2. Backups Created ---');
  console.log('  ✅ SQLite Binary Backup: ' + backupDbPath + ' (' + fs.statSync(backupDbPath).size + ' bytes)');

  // Write JSON export
  fs.writeFileSync(
    backupJsonPath,
    JSON.stringify({ timestamp: new Date().toISOString(), counts, tableData }, null, 2),
    'utf8'
  );
  console.log('  ✅ JSON Dump Backup:     ' + backupJsonPath + ' (' + fs.statSync(backupJsonPath).size + ' bytes)');

  // 4. Verify backup
  console.log('\n--- 3. Verifying Backup File Integrity ---');
  const verifyDb = new DatabaseSync(backupDbPath);
  let allVerified = true;
  for (const t of tables) {
    const verifiedCount = verifyDb.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
    if (verifiedCount !== counts[t]) {
      console.error(`  ❌ Mismatch for ${t}: expected ${counts[t]}, got ${verifiedCount}`);
      allVerified = false;
    } else {
      console.log(`  ✓ Table ${t} verified (${verifiedCount} rows)`);
    }
  }

  if (allVerified) {
    console.log('\n========================================================');
    console.log('✅ ALL DATABASE BACKUP TABLES AND ROW COUNTS VERIFIED 100% OK!');
    console.log('========================================================\n');
  } else {
    console.error('❌ Backup verification failed!');
    process.exit(1);
  }
}

backup().catch((err) => {
  console.error('Error during backup:', err);
  process.exit(1);
});
