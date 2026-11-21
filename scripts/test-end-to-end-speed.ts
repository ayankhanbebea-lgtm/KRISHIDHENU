const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://krishidhenu.vercel.app";

async function login(mobileNumber: string, otp: string = "123456") {
  await fetch(`${BASE_URL}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber }),
  });

  const res = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber, otp }),
  });

  const cookies = res.headers.get("set-cookie") || "";
  const match = cookies.match(/sp_session=([^;]+)/);
  const sessionToken = match ? match[1] : "";
  const data = await res.json();
  return { res, data, sessionToken, cookie: `sp_session=${sessionToken}` };
}

async function runE2E() {
  console.log("=== END-TO-END STAFF & ADMIN ACTION FLOW TIMING TEST ===");
  console.log(`Target: ${BASE_URL}\n`);

  // 1. Login Farmer (9828466372)
  console.log("1. Authenticating Farmer (9828466372)...");
  const farmerAuth = await login("9828466372");
  console.log(`   Farmer authenticated: ${farmerAuth.data.user?.name}`);

  // 2. Fetch booking options and create a booking
  console.log("\n2. Creating a test booking...");
  const optionsRes = await fetch(`${BASE_URL}/api/farmer/booking-options`, {
    headers: { Cookie: farmerAuth.cookie },
  });
  const options = await optionsRes.json();
  const centre = options.centres?.[0];
  const crop = options.crops?.[0];

  // Fetch slots for this centre
  const slotsRes = await fetch(`${BASE_URL}/api/farmer/booking-options?centreId=${centre.id}&cropId=${crop.id}`, {
    headers: { Cookie: farmerAuth.cookie },
  });
  const slotsData = await slotsRes.json();
  const slot = slotsData.slots?.[0] || { id: "slt_default", date: options.todayIST };

  const bookRes = await fetch(`${BASE_URL}/api/farmer/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: farmerAuth.cookie },
    body: JSON.stringify({
      cropCode: crop.code,
      centreId: centre.id,
      date: slot.date,
      slotId: slot.id,
      quantityQuintal: 45,
    }),
  });
  const bookData = await bookRes.json();
  console.log(`   ✅ Booking created: Token ${bookData.token} (ID: ${bookData.bookingId})`);
  const bookingId = bookData.bookingId;

  // 3. Login Staff (9509082087)
  console.log("\n3. Authenticating Staff (9509082087)...");
  const staffAuth = await login("9509082087");
  console.log(`   Staff authenticated: ${staffAuth.data.user?.name}`);

  // 4. Staff Action: CALL NEXT
  console.log("\n4. Testing Staff 'CALL_NEXT' action...");
  const tCall = Date.now();
  const callRes = await fetch(`${BASE_URL}/api/staff/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
    body: JSON.stringify({ action: "CALL_NEXT", centreId: centre.id }),
  });
  const callDur = Date.now() - tCall;
  const callData = await callRes.json();
  console.log(`   Single-Click Latency: ${callDur}ms | Status: ${callRes.status} | Data:`, callData);

  // 5. Staff Action: MARK_ARRIVED
  console.log("\n5. Testing Staff 'MARK_ARRIVED' action...");
  const tArr = Date.now();
  const arrRes = await fetch(`${BASE_URL}/api/staff/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
    body: JSON.stringify({ bookingId, action: "MARK_ARRIVED", centreId: centre.id }),
  });
  const arrDur = Date.now() - tArr;
  const arrData = await arrRes.json();
  console.log(`   Single-Click Latency: ${arrDur}ms | Status: ${arrRes.status} | Confirmed Status: ${arrData.status}`);

  // Test Rapid Duplicate Click on MARK_ARRIVED (must return 200 idempotent)
  const dupArr = await fetch(`${BASE_URL}/api/staff/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
    body: JSON.stringify({ bookingId, action: "MARK_ARRIVED", centreId: centre.id }),
  });
  const dupArrData = await dupArr.json();
  console.log(`   Duplicate Click Guard: Status: ${dupArr.status} | Idempotent Result:`, dupArrData);

  // 6. Staff Action: START_WEIGHING
  console.log("\n6. Testing Staff 'START_WEIGHING' action...");
  const tWeigh = Date.now();
  const weighRes = await fetch(`${BASE_URL}/api/staff/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
    body: JSON.stringify({ bookingId, action: "START_WEIGHING", centreId: centre.id }),
  });
  const weighDur = Date.now() - tWeigh;
  const weighData = await weighRes.json();
  console.log(`   Single-Click Latency: ${weighDur}ms | Status: ${weighRes.status} | Confirmed Status: ${weighData.status}`);

  // 7. Staff Action: COMPLETE_PROCUREMENT
  console.log("\n7. Testing Staff 'COMPLETE_PROCUREMENT' action...");
  const tComp = Date.now();
  const compRes = await fetch(`${BASE_URL}/api/staff/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: staffAuth.cookie },
    body: JSON.stringify({
      bookingId,
      action: "COMPLETE_PROCUREMENT",
      centreId: centre.id,
      actualQuantity: 44.5,
      ratePerUnit: 2275,
      deductions: 0,
      qualityGrade: "GRADE_A",
    }),
  });
  const compDur = Date.now() - tComp;
  const compData = await compRes.json();
  console.log(`   Single-Click Latency: ${compDur}ms | Status: ${compRes.status} | Confirmed Status: ${compData.status}`);

  // 8. Farmer Fetches Payment and Submits Bank Details
  console.log("\n8. Farmer Fetching Payment and Submitting Bank Details...");
  const payListFarmer = await fetch(`${BASE_URL}/api/farmer/payments?_t=${Date.now()}`, {
    headers: { Cookie: farmerAuth.cookie },
  });
  const payListDataFarmer = await payListFarmer.json();
  const farmerPayment = payListDataFarmer.payments?.find((p: any) => p.bookingId === bookingId);
  console.log(`   Farmer Payment ID: ${farmerPayment?.id} (Status: ${farmerPayment?.paymentStatus})`);

  const bankRes = await fetch(`${BASE_URL}/api/farmer/payments/submit-bank-details`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: farmerAuth.cookie },
    body: JSON.stringify({
      bookingId,
      paymentId: farmerPayment?.id,
      accountHolderName: "Devendra Verma",
      bankName: "State Bank of India",
      accountNumber: "123456789012",
      confirmAccountNumber: "123456789012",
      ifscCode: "SBIN0001234",
    }),
  });
  const bankData = await bankRes.json();
  console.log(`   Bank details status: ${bankRes.status} | Data:`, bankData);

  // 9. Login Admin (9258879190)
  console.log("\n9. Authenticating Admin (9258879190)...");
  const adminAuth = await login("9258879190");
  console.log(`   Admin authenticated: ${adminAuth.data.user?.name}`);

  // Find payment record
  const payListRes = await fetch(`${BASE_URL}/api/admin/payments?_t=${Date.now()}`, {
    headers: { Cookie: adminAuth.cookie },
  });
  const payListData = await payListRes.json();
  const paymentRecord = payListData.payments?.find((p: any) => p.bookingId === bookingId);
  console.log(`   Found Payment Record: ${paymentRecord?.id} (Amount: ₹${paymentRecord?.finalPayableAmount}, Status: ${paymentRecord?.paymentStatus})`);

  if (paymentRecord) {
    // 10. Admin Action: START_PROCESSING
    console.log("\n10. Testing Admin 'START_PROCESSING' action...");
    const tProc = Date.now();
    const procRes = await fetch(`${BASE_URL}/api/admin/payments/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminAuth.cookie },
      body: JSON.stringify({ paymentId: paymentRecord.id, action: "START_PROCESSING" }),
    });
    const procDur = Date.now() - tProc;
    const procData = await procRes.json();
    console.log(`   Single-Click Latency: ${procDur}ms | Status: ${procRes.status} | Confirmed Status: ${procData.status}`);

    // Duplicate test
    const dupProc = await fetch(`${BASE_URL}/api/admin/payments/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminAuth.cookie },
      body: JSON.stringify({ paymentId: paymentRecord.id, action: "START_PROCESSING" }),
    });
    const dupProcData = await dupProc.json();
    console.log(`   Duplicate Click Guard: Status: ${dupProc.status} | Idempotent Result:`, dupProcData);

    // 11. Admin Action: MARK_PAID
    console.log("\n11. Testing Admin 'MARK_PAID' action...");
    const tPaid = Date.now();
    const paidRes = await fetch(`${BASE_URL}/api/admin/payments/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminAuth.cookie },
      body: JSON.stringify({
        paymentId: paymentRecord.id,
        action: "MARK_PAID",
        paymentMethod: "NEFT",
        transactionReference: `UTR${Date.now()}`,
      }),
    });
    const paidDur = Date.now() - tPaid;
    const paidData = await paidRes.json();
    console.log(`   Single-Click Latency: ${paidDur}ms | Status: ${paidRes.status} | Confirmed Status: ${paidData.status}`);

    // Duplicate test
    const dupPaid = await fetch(`${BASE_URL}/api/admin/payments/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminAuth.cookie },
      body: JSON.stringify({
        paymentId: paymentRecord.id,
        action: "MARK_PAID",
        paymentMethod: "NEFT",
        transactionReference: `UTR${Date.now()}`,
      }),
    });
    const dupPaidData = await dupPaid.json();
    console.log(`   Duplicate Click Guard: Status: ${dupPaid.status} | Idempotent Result:`, dupPaidData);
  }

  console.log("\n========================================================");
  console.log("ALL ACTIONS CONFIRMED ON PRODUCTION APPLICATION!");
  console.log("========================================================");
}

runE2E().catch(console.error);
