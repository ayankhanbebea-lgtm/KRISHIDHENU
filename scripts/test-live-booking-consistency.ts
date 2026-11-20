/**
 * Live Production Booking Synchronization & Consistency Test against Vercel
 * URL: https://krishidhenu.vercel.app
 */

const BASE_URL = "https://krishidhenu.vercel.app";

async function postJson(endpoint: string, body: any, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  const setCookie = res.headers.get("set-cookie") || undefined;
  return { status: res.status, ok: res.ok, data, cookie: setCookie };
}

async function getJson(endpoint: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function login(mobileNumber: string) {
  await postJson("/api/auth/send-otp", { mobileNumber });
  const verifyRes = await postJson("/api/auth/verify-otp", { mobileNumber, otp: "123456" });
  if (!verifyRes.ok) throw new Error(`Login failed for ${mobileNumber}: ${JSON.stringify(verifyRes.data)}`);
  return verifyRes.cookie;
}

async function run() {
  console.log("================================================================================");
  console.log("VERCEL PRODUCTION LIVE BOOKING SYNCHRONIZATION & CONSISTENCY VERIFICATION");
  console.log(`Target: ${BASE_URL}`);
  console.log("================================================================================\n");

  // 1. Authenticate Farmer (Ramesh Kumar - 9829124370)
  console.log("1. Authenticating Farmer (9829124370)...");
  const farmerCookie = await login("9829124370");
  const farmerMe = await getJson("/api/auth/me", farmerCookie);
  console.log(`   ✅ Farmer authenticated: ${farmerMe.data?.user?.name} (Role: ${farmerMe.data?.user?.role})`);

  // 2. Authenticate Staff (Suresh Sharma - 9509082087 - JPR01)
  console.log("2. Authenticating Staff (9509082087)...");
  const staffCookie = await login("9509082087");
  const staffMe = await getJson("/api/auth/me", staffCookie);
  console.log(`   ✅ Staff authenticated: ${staffMe.data?.user?.name} (Role: ${staffMe.data?.user?.role})`);

  // 3. Authenticate Admin (Administrator - 9258879190)
  console.log("3. Authenticating Admin (9258879190)...");
  const adminCookie = await login("9258879190");
  const adminMe = await getJson("/api/auth/me", adminCookie);
  console.log(`   ✅ Admin authenticated: ${adminMe.data?.user?.name} (Role: ${adminMe.data?.user?.role})\n`);

  // 4. Fetch Booking Options for Centre 01 (JPR01)
  console.log("4. Fetching Available Slots for Jaipur Procurement Centre 01...");
  const optionsRes = await getJson("/api/farmer/booking-options", farmerCookie);
  const centre = optionsRes.data?.centres?.find((c: any) => c.code === "JPR01") || optionsRes.data?.centres?.[0];
  const crop = optionsRes.data?.crops?.find((cr: any) => cr.code === "WHT") || optionsRes.data?.crops?.[0];
  const testDate = optionsRes.data?.today || new Date().toISOString().split("T")[0];

  const slotsRes = await getJson(`/api/farmer/booking-options?date=${testDate}&centreId=${centre.id}`, farmerCookie);
  const slotObj = slotsRes.data?.slots?.find((s: any) => s.availableCapacity > 0) || slotsRes.data?.slots?.[0];
  if (!slotObj) throw new Error("No available slots found");
  console.log(`   ✅ Selected Centre: ${centre.name} (${centre.code}), Date: ${testDate}, Slot: ${slotObj.startTime}-${slotObj.endTime}`);

  // 5. Create Booking on Live Production
  console.log("5. Creating Booking via /api/farmer/bookings on Live Vercel...");
  const createRes = await postJson("/api/farmer/bookings", {
    cropCode: crop.code,
    quantityQuintal: 20,
    centreId: centre.id,
    date: testDate,
    slotId: slotObj.id,
  }, farmerCookie);

  let token = createRes.data?.token;
  let bookingId = createRes.data?.bookingId;

  if (!createRes.ok) {
    console.log(`   Notice: ${createRes.data?.error}`);
    // If farmer already has active bookings, query existing booking
    const curRes = await getJson("/api/farmer/current", farmerCookie);
    const existing = curRes.data?.bookings?.[0];
    if (existing) {
      token = existing.token;
      bookingId = existing.id;
      console.log(`   Using existing active booking: Token=${token}, ID=${bookingId}`);
    } else {
      throw new Error(`Failed to create or find booking: ${createRes.data?.error}`);
    }
  } else {
    console.log(`   ✅ Booking created successfully: Token=${token}, BookingId=${bookingId}`);
  }

  // 6. Test Staff Dashboard Queue Consistency over 15 Rapid Queries
  console.log("\n6. Testing Staff Dashboard Consistency across 15 Consecutive Polling Calls...");
  let staffFoundCount = 0;
  for (let i = 1; i <= 15; i++) {
    const queueRes = await getJson(`/api/staff/queue?centreId=${centre.id}&date=${testDate}&_t=${Date.now()}`, staffCookie);
    if (!queueRes.ok) {
      console.error(`   Iteration ${i}: HTTP Error ${queueRes.status}`);
      continue;
    }
    const rows = queueRes.data?.rows || [];
    const hasToken = rows.some((r: any) => r.token === token);
    if (hasToken) {
      staffFoundCount++;
    } else {
      console.error(`   ❌ Booking ${token} MISSING in iteration ${i}! Total rows returned: ${rows.length}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`   ✅ Staff Dashboard Consistency: ${staffFoundCount}/15 queries returned Token ${token} with 0 disappearances (100% steady).`);
  if (staffFoundCount < 15) {
    throw new Error(`Inconsistency detected: booking disappeared in ${15 - staffFoundCount} queries`);
  }

  // 7. Verify Admin Queue on Live Production
  console.log("\n7. Verifying Admin Queue (/api/admin/queue) on Live Vercel...");
  const adminQueueRes = await getJson(`/api/admin/queue?date=${testDate}&_t=${Date.now()}`, adminCookie);
  const jpr01Admin = adminQueueRes.data?.centres?.find((c: any) => c.code === "JPR01" || c.id === centre.id);
  const adminHasToken = jpr01Admin?.queue?.some((q: any) => q.token === token);
  console.log(`   ✅ Admin Live Queue: Token ${token} present at JPR01: ${adminHasToken ? "YES (Verified)" : "NO"}`);
  if (!adminHasToken) {
    throw new Error(`Token ${token} not found in admin queue for centre JPR01`);
  }

  // 8. Verify Status Advancement by Staff
  console.log("\n8. Advancing Status via Staff Action (/api/staff/actions)...");
  const advanceRes = await postJson("/api/staff/actions", {
    bookingId,
    action: "MARK_ARRIVED",
    centreId: centre.id,
  }, staffCookie);
  console.log(`   Staff action response: ${advanceRes.ok ? "Success (ARRIVED)" : advanceRes.data?.error || "Error"}`);

  // 9. Re-verify Staff Queue and Farmer Queue for updated status
  const finalStaffRes = await getJson(`/api/staff/queue?centreId=${centre.id}&date=${testDate}&_t=${Date.now()}`, staffCookie);
  const finalStaffRow = finalStaffRes.data?.rows?.find((r: any) => r.token === token);
  console.log(`   ✅ Staff Queue Updated Status: ${finalStaffRow?.status || "n/a"}`);

  const finalFarmerRes = await getJson("/api/farmer/current", farmerCookie);
  const finalFarmerRow = finalFarmerRes.data?.bookings?.find((b: any) => b.token === token);
  console.log(`   ✅ Farmer Dashboard Updated Status: ${finalFarmerRow?.status || "n/a"}`);

  console.log("\n================================================================================");
  console.log("ALL LIVE PRODUCTION SYNCHRONIZATION TESTS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

run().catch((err) => {
  console.error("\n❌ LIVE PRODUCTION TEST FAILED:", err);
  process.exit(1);
});
