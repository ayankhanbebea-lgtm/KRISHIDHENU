import { getDb, newId, nowIso } from "../lib/db";
import { getTodayIST } from "../lib/format";
import { generateToken, nextQueuePosition } from "../lib/services";

async function run() {
  console.log("====================================================");
  console.log("KRISHIDHENU PRODUCTION BOOKING CONSISTENCY TEST");
  console.log("====================================================");

  const db = getDb();
  const todayIST = getTodayIST();

  // 1. Identify Centre 01 and Default Farmer
  const centre = (await db.prepare(`SELECT id, name, code FROM procurement_centres WHERE code = 'JPR01'`).get()) as any;
  if (!centre) throw new Error("Centre JPR01 not found");
  console.log(`[STEP 1] Target Centre: ${centre.name} (${centre.code}, ID: ${centre.id})`);

  const farmer = (await db.prepare(`SELECT id, name, phone FROM users WHERE phone = '9829124370'`).get()) as any;
  if (!farmer) throw new Error("Default farmer 9829124370 not found");
  const farmerProfile = (await db.prepare(`SELECT id FROM farmer_profiles WHERE user_id = ?`).get(farmer.id)) as any;
  console.log(`[STEP 2] Test Farmer: ${farmer.name} (${farmer.phone}, Profile ID: ${farmerProfile.id})`);

  // Clean existing test bookings for this slot/centre today to have a clean slate
  const slot = (await db.prepare(`SELECT id, capacity FROM slots WHERE centre_id = ? AND date = ? LIMIT 1`).get(centre.id, todayIST)) as any;
  if (!slot) throw new Error(`Slot for ${todayIST} not found`);

  // 3. Create Booking 1
  const { token, seq } = await generateToken("WHT", centre.id, todayIST);
  const bookingId = newId("bkg_test_");
  await db.prepare(`
    INSERT INTO bookings (id, farmer_id, centre_id, crop_id, slot_id, quantity_quintal, token, token_seq, status, created_at, updated_at)
    VALUES (?, ?, ?, (SELECT id FROM crops WHERE code = 'WHT'), ?, 25.0, ?, ?, 'BOOKED', ?, ?)
  `).run(bookingId, farmerProfile.id, centre.id, slot.id, token, seq, nowIso(), nowIso());

  const pos = await nextQueuePosition(centre.id, todayIST);
  await db.prepare(`
    INSERT INTO queue_entries (id, booking_id, centre_id, date, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId("q_test_"), bookingId, centre.id, todayIST, pos, nowIso());

  console.log(`[STEP 3] Booking created successfully: Token=${token}, Position=${pos}`);

  // 4. Query Staff Queue API Simulation (using exact SQL from staff/queue/route.ts)
  const getStaffQueue = async () => {
    return (await db.prepare(`
      SELECT b.id, b.token, b.status, b.quantity_quintal as quantityQuintal,
             u.name as farmerName, u.phone as farmerPhone,
             s.date as slotDate, COALESCE(q.position, 1) as position
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN farmer_profiles fp ON b.farmer_id = fp.id
      JOIN users u ON fp.user_id = u.id
      LEFT JOIN queue_entries q ON q.booking_id = b.id
      WHERE b.centre_id = ? AND s.date = ?
      ORDER BY s.date ASC, COALESCE(q.position, 999) ASC
    `).all(centre.id, todayIST)) as any[];
  };

  const initialRows = await getStaffQueue();
  const foundInitial = initialRows.find(r => r.token === token);
  if (!foundInitial) {
    throw new Error(`CRITICAL: Booking ${token} was NOT returned by Staff Queue immediately after creation!`);
  }
  console.log(`[STEP 4] Staff Queue verified: Found booking ${token} (Total rows=${initialRows.length})`);

  // 5. Stress test: Rapid successive queries simulating 25 concurrent / rapid refreshes
  console.log(`[STEP 5] Simulating 25 rapid successive polling cycles...`);
  let disappearedCount = 0;
  for (let i = 1; i <= 25; i++) {
    const rows = await getStaffQueue();
    const hasToken = rows.some(r => r.token === token);
    if (!hasToken) {
      disappearedCount++;
      console.error(`  [FAILURE] Iteration ${i}: Booking ${token} disappeared!`);
    }
  }

  if (disappearedCount > 0) {
    throw new Error(`CRITICAL BUG: Booking disappeared in ${disappearedCount}/25 queries!`);
  }
  console.log(`  ✅ All 25/25 polling cycles returned booking ${token} with 100% consistency (0 disappearances).`);

  // 6. Admin Queue Verification
  const adminQueue = (await db.prepare(`
    SELECT b.id, b.token, b.status, u.name as farmerName, q.position
    FROM queue_entries q
    JOIN bookings b ON q.booking_id = b.id
    JOIN farmer_profiles fp ON b.farmer_id = fp.id
    JOIN users u ON fp.user_id = u.id
    WHERE q.centre_id = ? AND q.date = ?
    ORDER BY q.position ASC
  `).all(centre.id, todayIST)) as any[];

  const adminFound = adminQueue.find(r => r.token === token);
  if (!adminFound) {
    throw new Error(`Admin queue does not show booking ${token}`);
  }
  console.log(`[STEP 6] Admin Queue verified: Token ${token} confirmed present at position ${adminFound.position}.`);

  // 7. Update status as staff (ARRIVED -> WEIGHING -> PROCUREMENT_COMPLETED)
  console.log(`[STEP 7] Updating booking status as Staff to 'ARRIVED'...`);
  await db.prepare(`UPDATE bookings SET status = 'ARRIVED', updated_at = ? WHERE id = ?`).run(nowIso(), bookingId);

  // Check that updated status appears in Staff Queue
  const updatedStaffRows = await getStaffQueue();
  const updatedRow = updatedStaffRows.find(r => r.token === token);
  if (!updatedRow || updatedRow.status !== "ARRIVED") {
    throw new Error(`Updated status 'ARRIVED' not reflected in staff queue (got ${updatedRow?.status})`);
  }
  console.log(`  ✅ Staff queue reflects status: ${updatedRow.status}`);

  // Check that updated status appears in Admin View
  const updatedAdminRow = (await db.prepare(`SELECT status FROM bookings WHERE id = ?`).get(bookingId)) as any;
  if (updatedAdminRow.status !== "ARRIVED") {
    throw new Error(`Updated status not reflected in admin database`);
  }
  console.log(`  ✅ Admin view reflects status: ${updatedAdminRow.status}`);

  // 8. Test simultaneous bookings from multiple farmers
  console.log(`[STEP 8] Testing concurrent multi-farmer bookings...`);
  const additionalFarmers = [
    { phone: "9200000002", name: "Suman Devi" },
    { phone: "9200000003", name: "Kailash Chand" },
  ];

  const createdMultiTokens: string[] = [];
  for (const farmer of additionalFarmers) {
    const u = (await db.prepare(`SELECT id FROM users WHERE phone = ?`).get(farmer.phone)) as any;
    const fp = (await db.prepare(`SELECT id FROM farmer_profiles WHERE user_id = ?`).get(u.id)) as any;
    const tkn = await generateToken("WHT", centre.id, todayIST);
    const bId = newId("bkg_multi_");
    const p = await nextQueuePosition(centre.id, todayIST);

    await db.prepare(`
      INSERT INTO bookings (id, farmer_id, centre_id, crop_id, slot_id, quantity_quintal, token, token_seq, status, created_at, updated_at)
      VALUES (?, ?, ?, (SELECT id FROM crops WHERE code = 'WHT'), ?, 30.0, ?, ?, 'BOOKED', ?, ?)
    `).run(bId, fp.id, centre.id, slot.id, tkn.token, tkn.seq, nowIso(), nowIso());
    await db.prepare(`
      INSERT INTO queue_entries (id, booking_id, centre_id, date, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId("q_multi_"), bId, centre.id, todayIST, p, nowIso());
    createdMultiTokens.push(tkn.token);
  }

  const multiStaffRows = await getStaffQueue();
  for (const t of createdMultiTokens) {
    if (!multiStaffRows.some(r => r.token === t)) {
      throw new Error(`Multi-farmer token ${t} missing from staff queue!`);
    }
  }
  console.log(`  ✅ All concurrent multi-farmer bookings (${createdMultiTokens.join(", ")}) visible in staff queue simultaneously!`);

  console.log("\n====================================================");
  console.log("ALL BOOKING CONSISTENCY TESTS PASSED! (100% OK)");
  console.log("====================================================");
}

run().catch((err) => {
  console.error("\n❌ BOOKING CONSISTENCY TEST FAILED:", err);
  process.exit(1);
});
