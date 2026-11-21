const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://krishidhenu.vercel.app";

async function login(mobileNumber: string, otp: string = "123456") {
  // First request OTP
  await fetch(`${BASE_URL}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber }),
  });

  // Verify OTP
  const res = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber, otp }),
  });

  const cookies = res.headers.get("set-cookie") || "";
  const match = cookies.match(/sp_session=([^;]+)/);
  const sessionToken = match ? match[1] : "";
  return { res, sessionToken, cookie: `sp_session=${sessionToken}` };
}

async function runBenchmark() {
  console.log(`=== KRISHIDHENU PRODUCTION PERFORMANCE BENCHMARK ===`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // 1. Login Admin
  console.log("\n[1] Logging in as Admin (9258879190)...");
  const adminAuth = await login("9258879190");
  if (!adminAuth.sessionToken) {
    console.error("Admin login failed!");
    return;
  }
  console.log("Admin logged in successfully.");

  // 2. Login Staff
  console.log("\n[2] Logging in as Staff (9509082087)...");
  const staffAuth = await login("9509082087");
  if (!staffAuth.sessionToken) {
    console.error("Staff login failed!");
    return;
  }
  console.log("Staff logged in successfully.");

  // 3. Measure Staff Queue Fetch Latency (Parallel vs Previous Sequential)
  console.log("\n[3] Testing Staff Queue API (/api/staff/queue)...");
  const queueTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/api/staff/queue?_t=${Date.now()}`, {
      headers: { Cookie: staffAuth.cookie },
    });
    const dur = Date.now() - start;
    const data = await res.json();
    queueTimes.push(dur);
    console.log(`  Run ${i + 1}: ${dur}ms (Status: ${res.status}, Rows: ${data.rows?.length}, DB ms: ${data.debug?.executionMs}ms)`);
  }
  const avgQueue = Math.round(queueTimes.reduce((a, b) => a + b, 0) / queueTimes.length);
  console.log(`  -> Average Staff Queue Latency: ${avgQueue}ms`);

  // 4. Measure Admin Overview API Latency
  console.log("\n[4] Testing Admin Overview API (/api/admin/overview)...");
  const overviewTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/api/admin/overview?_t=${Date.now()}`, {
      headers: { Cookie: adminAuth.cookie },
    });
    const dur = Date.now() - start;
    overviewTimes.push(dur);
    console.log(`  Run ${i + 1}: ${dur}ms (Status: ${res.status})`);
  }
  const avgOverview = Math.round(overviewTimes.reduce((a, b) => a + b, 0) / overviewTimes.length);
  console.log(`  -> Average Admin Overview Latency: ${avgOverview}ms`);

  // 5. Measure Admin Payments API Latency
  console.log("\n[5] Testing Admin Payments API (/api/admin/payments)...");
  const paymentTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/api/admin/payments?_t=${Date.now()}`, {
      headers: { Cookie: adminAuth.cookie },
    });
    const dur = Date.now() - start;
    const data = await res.json();
    paymentTimes.push(dur);
    console.log(`  Run ${i + 1}: ${dur}ms (Status: ${res.status}, Payments: ${data.payments?.length})`);
  }
  const avgPayments = Math.round(paymentTimes.reduce((a, b) => a + b, 0) / paymentTimes.length);
  console.log(`  -> Average Admin Payments Latency: ${avgPayments}ms`);

  // 6. Test Single-Click Staff Action (CALL_NEXT) & Concurrent Double-Click Protection
  console.log("\n[6] Testing CALL_NEXT Single-Click & Concurrency Guard...");
  const cStart = Date.now();
  // Fire two rapid concurrent requests mimicking a frantic double-click
  const [call1, call2] = await Promise.all([
    fetch(`${BASE_URL}/api/staff/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
      body: JSON.stringify({ action: "CALL_NEXT" }),
    }).then(async (r) => ({ status: r.status, data: await r.json() })),
    fetch(`${BASE_URL}/api/staff/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
      body: JSON.stringify({ action: "CALL_NEXT" }),
    }).then(async (r) => ({ status: r.status, data: await r.json() })),
  ]);
  const cDur = Date.now() - cStart;
  console.log(`  Concurrent Double-Click Time: ${cDur}ms`);
  console.log(`  Request 1: Status ${call1.status}, data:`, call1.data);
  console.log(`  Request 2: Status ${call2.status}, data:`, call2.data);
  const preventedDuplicate = call1.data?.token === call2.data?.token || call2.data?.alreadyApplied;
  console.log(`  -> Duplicate prevention verified: ${preventedDuplicate ? "YES (Deduplicated cleanly)" : "NO"}`);

  // 7. Test Single-Click Status Transition & Idempotency on an actual booking
  console.log("\n[7] Testing State Transition Idempotency (MARK_ARRIVED twice)...");
  // Get active queue to find target booking
  const queueRes = await fetch(`${BASE_URL}/api/staff/queue`, { headers: { Cookie: staffAuth.cookie } });
  const queueData = await queueRes.json();
  const targetBooking = queueData.rows?.find((r: any) => r.status === "BOOKED" || r.status === "ARRIVED");

  if (targetBooking) {
    console.log(`  Target booking: ${targetBooking.token} (id: ${targetBooking.id}, status: ${targetBooking.status})`);
    const actStart = Date.now();
    const resA = await fetch(`${BASE_URL}/api/staff/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
      body: JSON.stringify({ bookingId: targetBooking.id, action: "MARK_ARRIVED" }),
    });
    const durA = Date.now() - actStart;
    const dataA = await resA.json();
    console.log(`  First Click: ${durA}ms -> Status: ${resA.status}, Result:`, dataA);

    // Immediate second click (simulating rapid duplicate click)
    const resB = await fetch(`${BASE_URL}/api/staff/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
      body: JSON.stringify({ bookingId: targetBooking.id, action: "MARK_ARRIVED" }),
    });
    const dataB = await resB.json();
    console.log(`  Second Click (Duplicate): Status: ${resB.status}, Result:`, dataB);
    console.log(`  -> Idempotent safe handling: ${resB.status === 200 ? "PASS (Zero error, cleanly handled)" : "FAIL"}`);
  } else {
    console.log("  No active BOOKED/ARRIVED bookings found in queue (queue is clear).");
  }

  console.log("\n=== BENCHMARK COMPLETE ===");
}

runBenchmark().catch(console.error);
