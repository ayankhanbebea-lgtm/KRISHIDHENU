import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { getDb } from "../lib/db";
import { sendOtpToMobile, verifySubmittedOtp } from "../lib/otp";
import { createSessionToken, validateSession, getSession } from "../lib/auth";
import { getFarmerProfileId } from "../lib/farmer";
import { getStaffCentre } from "../lib/staff";
import { POST as sendOtpRoute } from "../app/api/auth/send-otp/route";
import { POST as verifyOtpRoute } from "../app/api/auth/verify-otp/route";
import { POST as completeProfileRoute } from "../app/api/auth/complete-profile/route";

async function runAuthResilienceTest() {
  console.log("================================================================================");
  console.log("STARTING AUTHENTICATION RESILIENCE & DATABASE RESET TEST SUITE");
  console.log("================================================================================\n");

  const testDbPath = path.join(process.cwd(), "prisma", "test-auth-resilience.db");
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "test-jwt-secret-for-resilience-testing-only-123456789";
  process.env.OTP_SECRET = "test-otp-secret-for-resilience-testing-only-123456789";

  // Clean any old test db
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  (global as any).__procurementDb = undefined;

  console.log("--------------------------------------------------------------------------------");
  console.log("[PHASE 1] Initial Database Setup & Account Verification");
  console.log("--------------------------------------------------------------------------------");
  let db = getDb();

  // Test 1: Admin Login
  console.log("1. Testing Admin Login (9258879190)...");
  const adminOtpSend = await sendOtpToMobile("9258879190");
  if (!adminOtpSend.ok) throw new Error(`Admin OTP send failed: ${adminOtpSend.error}`);
  const adminOtpVerify = await verifySubmittedOtp("9258879190", "123456");
  if (!adminOtpVerify.ok || adminOtpVerify.user?.role !== "ADMIN") {
    throw new Error(`Admin verification failed: ${JSON.stringify(adminOtpVerify)}`);
  }
  const adminToken = await createSessionToken({
    id: adminOtpVerify.user.id,
    name: adminOtpVerify.user.name,
    phone: adminOtpVerify.user.phone,
    role: "ADMIN",
  });
  const adminSession = await validateSession(adminToken);
  if (!adminSession || adminSession.role !== "ADMIN") {
    throw new Error("Admin session validation failed");
  }
  console.log("   ✅ Admin authenticated successfully (Role: ADMIN, Name: Administrator)");

  // Test 2: Staff Logins (Centre 01, 02, 03)
  const staffTests = [
    { phone: "9509082087", name: "Suresh Sharma", expectedCentre: "JPR01" },
    { phone: "7870844405", name: "Anita Verma", expectedCentre: "JPR02" },
    { phone: "7015962317", name: "Mohit Yadav", expectedCentre: "JPR03" },
  ];
  const staffTokens: Record<string, string> = {};

  for (const s of staffTests) {
    console.log(`2. Testing Staff Login (${s.phone} - ${s.name} - ${s.expectedCentre})...`);
    await sendOtpToMobile(s.phone);
    const vRes = await verifySubmittedOtp(s.phone, "123456");
    if (!vRes.ok || vRes.user?.role !== "STAFF") {
      throw new Error(`Staff ${s.phone} verification failed: ${JSON.stringify(vRes)}`);
    }
    const token = await createSessionToken({
      id: vRes.user.id,
      name: vRes.user.name,
      phone: vRes.user.phone,
      role: "STAFF",
    });
    staffTokens[s.phone] = token;
    const session = await validateSession(token);
    if (!session || session.role !== "STAFF") {
      throw new Error(`Staff ${s.phone} session validation failed`);
    }
    const centre = getStaffCentre(session.id);
    if (!centre || centre.code !== s.expectedCentre) {
      throw new Error(`Staff ${s.phone} centre mismatch: expected ${s.expectedCentre}, got ${centre?.code}`);
    }
    console.log(`   ✅ Staff ${s.name} authenticated -> Assigned to Centre: ${centre.name} (${centre.code})`);
  }

  // Test 3: Default Farmer Login (9829124370)
  console.log("3. Testing Default Farmer Login (9829124370 - Ramesh Kumar)...");
  await sendOtpToMobile("9829124370");
  const farmerVerify = await verifySubmittedOtp("9829124370", "123456");
  if (!farmerVerify.ok || farmerVerify.user?.role !== "FARMER") {
    throw new Error(`Farmer verification failed: ${JSON.stringify(farmerVerify)}`);
  }
  const farmerToken = await createSessionToken({
    id: farmerVerify.user.id,
    name: farmerVerify.user.name,
    phone: farmerVerify.user.phone,
    role: "FARMER",
  });
  const farmerSession = await validateSession(farmerToken);
  const farmerProfileId = getFarmerProfileId(farmerSession!.id);
  if (!farmerProfileId) {
    throw new Error("Farmer profile ID missing for Ramesh Kumar");
  }
  console.log(`   ✅ Default Farmer authenticated -> Profile ID: ${farmerProfileId}`);

  // Test 4: New Farmer Registration via HTTP API routes
  console.log("4. Testing New Farmer Registration & Login Flow via API routes...");
  const newFarmerPhone = "9988776655";
  const reqSend = new NextRequest("http://localhost:3000/api/auth/send-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: newFarmerPhone }),
  });
  const resSend = await sendOtpRoute(reqSend);
  const dataSend = await resSend.json();
  if (!dataSend.ok) throw new Error(`Send OTP API failed: ${JSON.stringify(dataSend)}`);

  const reqVerify = new NextRequest("http://localhost:3000/api/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: newFarmerPhone, otp: "123456" }),
  });
  const resVerify = await verifyOtpRoute(reqVerify);
  const dataVerify = await resVerify.json();
  if (!dataVerify.ok || !dataVerify.isNewUser) {
    throw new Error(`Expected isNewUser: true for fresh number: ${JSON.stringify(dataVerify)}`);
  }
  console.log("   ✅ New farmer detected -> Redirected to Profile Completion");

  const reqComplete = new NextRequest("http://localhost:3000/api/auth/complete-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mobileNumber: newFarmerPhone,
      name: "Babulal Sharma",
      district: "Jaipur",
      address: "Gram Post Sanganer",
      language: "hi",
    }),
  });
  const resComplete = await completeProfileRoute(reqComplete);
  const dataComplete = await resComplete.json();
  if (!dataComplete.ok || !dataComplete.user) {
    throw new Error(`Complete profile failed: ${JSON.stringify(dataComplete)}`);
  }
  const newFarmerToken = await createSessionToken({
    id: dataComplete.user.id,
    name: dataComplete.user.name,
    phone: dataComplete.user.phone,
    role: "FARMER",
  });
  console.log(`   ✅ New farmer registration complete: ${dataComplete.user.name} (${newFarmerPhone})`);

  // Insert a dummy operational booking
  const newFarmerProfileId = getFarmerProfileId(dataComplete.user.id);
  const slot = db.prepare("SELECT id, centre_id FROM slots LIMIT 1").get() as any;
  const crop = db.prepare("SELECT id FROM crops LIMIT 1").get() as any;
  db.prepare(`
    INSERT INTO bookings (id, farmer_id, centre_id, crop_id, slot_id, token, token_seq, quantity_quintal, status, created_at, updated_at)
    VALUES ('bk_test_1', ?, ?, ?, ?, 'TEST-0001', 1, 30, 'BOOKED', datetime('now'), datetime('now'))
  `).run(newFarmerProfileId, slot.centre_id, crop.id, slot.id);

  console.log("   ✅ Created operational booking record: Token TEST-0001 in database.");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("[PHASE 2] Simulating COMPLETE SQLite Database Reset (File Deletion)");
  console.log("--------------------------------------------------------------------------------");
  
  // Close database and delete the file completely
  db.close();
  (global as any).__procurementDb = undefined;
  fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  console.log("🔥 Database file deleted! SQLite state is now completely empty.");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("[PHASE 3] Verifying Auto-Initialization & Self-Healing after Reset");
  console.log("--------------------------------------------------------------------------------");
  
  // Re-acquire db: self-initializes schema + baseline
  db = getDb();
  console.log("1. Verifying baseline auto-initialization...");

  const centreCount = (db.prepare("SELECT COUNT(*) as c FROM procurement_centres").get() as any).c;
  const userCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as any).c;
  const slotCount = (db.prepare("SELECT COUNT(*) as c FROM slots").get() as any).c;
  const bookingCount = (db.prepare("SELECT COUNT(*) as c FROM bookings").get() as any).c;

  console.log(`   - Procurement Centres: ${centreCount} (Expected: 3)`);
  console.log(`   - Users Initialized: ${userCount} (Admin, 3 Staffs, Default Farmers)`);
  console.log(`   - Available Slots: ${slotCount} (Generated for next 7 days)`);
  console.log(`   - Operational Bookings: ${bookingCount} (Expected: 0 - Clean State)`);

  if (centreCount !== 3 || bookingCount !== 0) {
    throw new Error("Database reset verification failed: centres or booking count mismatch.");
  }

  // Test 5: Verify Admin can log in after DB reset
  console.log("\n2. Testing Admin Login after Reset (9258879190)...");
  await sendOtpToMobile("9258879190");
  const postResetAdmin = await verifySubmittedOtp("9258879190", "123456");
  if (!postResetAdmin.ok || postResetAdmin.user?.role !== "ADMIN") {
    throw new Error("Admin login failed after reset");
  }
  console.log("   ✅ Admin successfully logged in post-reset (Role: ADMIN)");

  // Test 6: Verify all 3 Staff members can log in and retain correct centre assignments after reset
  console.log("\n3. Testing Staff Logins & Centre Assignments after Reset...");
  for (const s of staffTests) {
    await sendOtpToMobile(s.phone);
    const postResetStaff = await verifySubmittedOtp(s.phone, "123456");
    if (!postResetStaff.ok || postResetStaff.user?.role !== "STAFF") {
      throw new Error(`Staff ${s.phone} login failed after reset`);
    }
    const centre = getStaffCentre(postResetStaff.user.id);
    if (!centre || centre.code !== s.expectedCentre) {
      throw new Error(`Staff ${s.phone} centre mismatch post-reset: expected ${s.expectedCentre}, got ${centre?.code}`);
    }
    console.log(`   ✅ Staff ${s.name} (${s.phone}) logged in post-reset -> Centre: ${centre.name} (${centre.code})`);
  }

  // Test 7: Verify Default Farmer can log in after reset
  console.log("\n4. Testing Default Farmer Login after Reset (9829124370)...");
  await sendOtpToMobile("9829124370");
  const postResetFarmer = await verifySubmittedOtp("9829124370", "123456");
  if (!postResetFarmer.ok || postResetFarmer.user?.role !== "FARMER") {
    throw new Error("Default farmer login failed after reset");
  }
  const postResetProfileId = getFarmerProfileId(postResetFarmer.user.id);
  if (!postResetProfileId) throw new Error("Farmer profile ID missing post-reset");
  console.log(`   ✅ Default Farmer logged in post-reset -> Profile ID: ${postResetProfileId}`);

  // Test 8: Verify previously created active JWT session tokens STILL VALIDATE (Self-Healing)
  console.log("\n5. Testing PRE-EXISTING Active Session Tokens after Reset (No Unexpected Logouts)...");
  
  // Admin pre-existing token
  const healedAdminSession = await validateSession(adminToken);
  if (!healedAdminSession || healedAdminSession.role !== "ADMIN") {
    throw new Error("Pre-existing Admin session failed to self-heal");
  }
  console.log("   ✅ Pre-existing Admin session survived DB reset seamlessly!");

  // Staff pre-existing tokens
  for (const s of staffTests) {
    const healedStaffSession = await validateSession(staffTokens[s.phone]);
    if (!healedStaffSession || healedStaffSession.role !== "STAFF") {
      throw new Error(`Pre-existing Staff session for ${s.phone} failed to self-heal`);
    }
    const centre = getStaffCentre(healedStaffSession.id);
    if (!centre || centre.code !== s.expectedCentre) {
      throw new Error(`Pre-existing Staff session centre mismatch: ${centre?.code}`);
    }
    console.log(`   ✅ Pre-existing Staff session for ${s.name} (${centre.code}) survived DB reset!`);
  }

  // Pre-existing New Farmer token (Registered right before DB reset)
  console.log("\n6. Testing Pre-existing Registered Farmer Session Self-Healing...");
  const healedFarmerSession = await validateSession(newFarmerToken);
  if (!healedFarmerSession || healedFarmerSession.role !== "FARMER" || healedFarmerSession.phone !== newFarmerPhone) {
    throw new Error("Pre-existing new farmer session failed to self-heal");
  }
  const healedFarmerProfileId = getFarmerProfileId(healedFarmerSession.id);
  if (!healedFarmerProfileId) {
    throw new Error("Farmer profile was not reconstructed during session validation");
  }
  console.log(`   ✅ Pre-existing Farmer session for Babulal Sharma (${newFarmerPhone}) self-healed! Profile: ${healedFarmerProfileId}`);

  // Test 9: Verify that new bookings can be created and persisted in the fresh database
  console.log("\n7. Testing Fresh Operational Data Creation in Reset Database...");
  const freshSlot = db.prepare("SELECT id, centre_id FROM slots LIMIT 1").get() as any;
  const freshCrop = db.prepare("SELECT id FROM crops LIMIT 1").get() as any;
  db.prepare(`
    INSERT INTO bookings (id, farmer_id, centre_id, crop_id, slot_id, token, token_seq, quantity_quintal, status, created_at, updated_at)
    VALUES ('bk_fresh_1', ?, ?, ?, ?, 'NEW-0101', 1, 40, 'BOOKED', datetime('now'), datetime('now'))
  `).run(healedFarmerProfileId, freshSlot.centre_id, freshCrop.id, freshSlot.id);

  const freshBooking = db.prepare("SELECT token, status FROM bookings WHERE id = 'bk_fresh_1'").get() as any;
  if (!freshBooking || freshBooking.token !== "NEW-0101") {
    throw new Error("Failed to insert booking in post-reset database");
  }
  console.log(`   ✅ Fresh booking successfully created and persisted: ${freshBooking.token} (${freshBooking.status})`);

  // Cleanup test database
  db.close();
  (global as any).__procurementDb = undefined;
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

  console.log("\n================================================================================");
  console.log("ALL AUTHENTICATION RESILIENCE & DATABASE RESET TESTS PASSED! (100% OK)");
  console.log("================================================================================\n");
}

runAuthResilienceTest().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});
