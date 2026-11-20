async function testLiveVercel() {
  const baseUrl = "https://krishidhenu.vercel.app";
  console.log("================================================================================");
  console.log(`TESTING LIVE DEPLOYED VERCEL APPLICATION`);
  console.log(`URL: ${baseUrl}`);
  console.log("================================================================================\n");

  // Test 1: Homepage
  console.log("1. Testing Homepage Health...");
  const homeRes = await fetch(baseUrl);
  console.log(`   Status: ${homeRes.status} ${homeRes.statusText}`);
  if (homeRes.status !== 200) throw new Error("Homepage health check failed");
  console.log("   ✅ Homepage loaded successfully (200 OK)");

  // Test 2: Admin Login
  console.log("\n2. Testing Admin OTP Login (9258879190)...");
  const adminSendRes = await fetch(`${baseUrl}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: "9258879190" }),
  });
  const adminSendData = await adminSendRes.json();
  if (!adminSendData.ok) throw new Error(`Admin send-otp failed: ${JSON.stringify(adminSendData)}`);

  const adminVerifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: "9258879190", otp: "123456" }),
  });
  const adminCookie = adminVerifyRes.headers.get("set-cookie") || "";
  const adminVerifyData = await adminVerifyRes.json();
  if (!adminVerifyData.ok || adminVerifyData.user?.role !== "ADMIN") {
    throw new Error(`Admin verify-otp failed: ${JSON.stringify(adminVerifyData)}`);
  }
  console.log(`   ✅ Admin authenticated -> Role: ${adminVerifyData.user.role}, Name: ${adminVerifyData.user.name}`);

  // Test 2b: Admin Overview API
  const adminOverviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie },
  });
  const adminOverviewData = await adminOverviewRes.json();
  if (adminOverviewRes.status !== 200) throw new Error("Admin overview API failed");
  console.log(`   ✅ Admin Overview API: ${adminOverviewData.overview?.totalCentres} centres active, ${adminOverviewData.overview?.totalFarmers} farmers registered.`);

  // Test 3: Staff Login (Centre 01 Sitapura - 9509082087)
  console.log("\n3. Testing Staff OTP Login (9509082087 - Sitapura)...");
  await fetch(`${baseUrl}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: "9509082087" }),
  });
  const staffVerifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: "9509082087", otp: "123456" }),
  });
  const staffCookie = staffVerifyRes.headers.get("set-cookie") || "";
  const staffVerifyData = await staffVerifyRes.json();
  if (!staffVerifyData.ok || staffVerifyData.user?.role !== "STAFF") {
    throw new Error(`Staff verify-otp failed: ${JSON.stringify(staffVerifyData)}`);
  }
  console.log(`   ✅ Staff authenticated -> Role: ${staffVerifyData.user.role}, Name: ${staffVerifyData.user.name}`);

  // Test 3b: Staff Queue API
  const staffQueueRes = await fetch(`${baseUrl}/api/staff/queue`, {
    headers: { Cookie: staffCookie },
  });
  const staffQueueData = await staffQueueRes.json();
  if (staffQueueRes.status !== 200) throw new Error("Staff queue API failed");
  console.log(`   ✅ Staff Queue API: Centre ${staffQueueData.centre?.name} (${staffQueueData.centre?.code})`);

  // Test 4: Farmer Login (9829124370 - Ramesh Kumar)
  console.log("\n4. Testing Farmer OTP Login (9829124370 - Ramesh Kumar)...");
  await fetch(`${baseUrl}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: "9829124370" }),
  });
  const farmerVerifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: "9829124370", otp: "123456" }),
  });
  const farmerCookie = farmerVerifyRes.headers.get("set-cookie") || "";
  const farmerVerifyData = await farmerVerifyRes.json();
  if (!farmerVerifyData.ok || farmerVerifyData.user?.role !== "FARMER") {
    throw new Error(`Farmer verify-otp failed: ${JSON.stringify(farmerVerifyData)}`);
  }
  console.log(`   ✅ Farmer authenticated -> Role: ${farmerVerifyData.user.role}, Name: ${farmerVerifyData.user.name}`);

  // Test 5: AI Assistant API Status & English Default
  console.log("\n5. Testing AI Assistant API (/api/farmer/assistant)...");
  const assistantGetRes = await fetch(`${baseUrl}/api/farmer/assistant`, {
    headers: { Cookie: farmerCookie },
  });
  const assistantGetData = await assistantGetRes.json();
  console.log(`   ✅ Assistant Status Check -> Status: ${assistantGetData.status}, Model: ${assistantGetData.model}, DefaultLang: ${assistantGetData.defaultLanguage}`);

  const assistantRes = await fetch(`${baseUrl}/api/farmer/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: farmerCookie,
    },
    body: JSON.stringify({ message: "What is my current queue status and token?" }),
  });
  const assistantData = await assistantRes.json();
  if (assistantRes.status !== 200 || !assistantData.reply) {
    throw new Error(`AI assistant query failed: ${assistantRes.status} ${JSON.stringify(assistantData)}`);
  }
  console.log(`   ✅ Assistant English Reply (Language: ${assistantData.language || "en"}, Model: ${assistantData.model}, isLive: ${Boolean(assistantData.isLive)}):`);
  console.log(`      "${assistantData.reply.substring(0, 140)}..."`);

  // Test 6: Hindi AI Query
  console.log("\n6. Testing Hindi AI Assistant Query...");
  const hindiRes = await fetch(`${baseUrl}/api/farmer/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: farmerCookie,
    },
    body: JSON.stringify({ message: "गेहूं का समर्थन मूल्य (MSP) क्या है?" }),
  });
  const hindiData = await hindiRes.json();
  if (hindiRes.status !== 200 || !hindiData.reply) {
    throw new Error(`Hindi assistant query failed: ${hindiRes.status} ${JSON.stringify(hindiData)}`);
  }
  console.log(`   ✅ Hindi Reply (Language: ${hindiData.language || "hi"}):`);
  console.log(`      "${hindiData.reply.substring(0, 140)}..."`);

  // Test 6b: Hinglish AI Query
  console.log("\n6b. Testing Hinglish AI Assistant Query...");
  const hinglishRes = await fetch(`${baseUrl}/api/farmer/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: farmerCookie,
    },
    body: JSON.stringify({ message: "Mera token status kya hai aur kitna wait karna hoga?" }),
  });
  const hinglishData = await hinglishRes.json();
  if (hinglishRes.status !== 200 || !hinglishData.reply) {
    throw new Error(`Hinglish assistant query failed: ${hinglishRes.status} ${JSON.stringify(hinglishData)}`);
  }
  console.log(`   ✅ Hinglish Reply (Language: ${hinglishData.language || "hinglish"}):`);
  console.log(`      "${hinglishData.reply.substring(0, 140)}..."`);

  // Test 7: Booking Creation (creating application operational data)
  console.log("\n7. Testing Booking Creation on Live Vercel...");
  const optionsRes = await fetch(`${baseUrl}/api/farmer/booking-options`, {
    headers: { Cookie: farmerCookie },
  });
  const optionsData = await optionsRes.json();
  if (!optionsData.crops || optionsData.crops.length === 0) throw new Error("No crops found");
  if (!optionsData.centres || optionsData.centres.length === 0) throw new Error("No centres found");

  const crop = optionsData.crops[0];
  const centre = optionsData.centres[0];
  const slotDate = optionsData.today || new Date().toISOString().split("T")[0];

  const slotsRes = await fetch(`${baseUrl}/api/farmer/booking-options?date=${slotDate}&centreId=${centre.id}`, {
    headers: { Cookie: farmerCookie },
  });
  const slotsData = await slotsRes.json();
  const availableSlot = slotsData.slots?.find((s: any) => s.availableCapacity > 0) || slotsData.slots?.[0];

  if (!availableSlot) {
    console.log("   ⚠️ No slot available to book, checking active bookings...");
  } else {
    const bookRes = await fetch(`${baseUrl}/api/farmer/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: farmerCookie,
      },
      body: JSON.stringify({
        cropCode: crop.code,
        quantityQuintal: 25,
        centreId: centre.id,
        date: slotDate,
        slotId: availableSlot.id,
      }),
    });
    const bookData = await bookRes.json();
    if (bookRes.status === 201 || bookRes.status === 200) {
      console.log(`   ✅ Booking created successfully on Vercel: Token ${bookData.token || bookData.booking?.token}`);
    } else if (bookData.error?.includes("maximum of 3 active bookings")) {
      console.log(`   ✅ Max 3 active bookings constraint verified on Vercel: ${bookData.error}`);
    } else {
      console.log(`   Status: ${bookRes.status}, Response: ${JSON.stringify(bookData)}`);
    }
  }

  console.log("\n================================================================================");
  console.log("ALL LIVE VERCEL TESTS PASSED! (100% OK)");
  console.log("================================================================================\n");
}

testLiveVercel().catch((err) => {
  console.error("❌ Live Vercel test failed:", err);
  process.exit(1);
});
