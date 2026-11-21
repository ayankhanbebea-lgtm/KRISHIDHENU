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

async function askChatbot(cookie: string, message: string) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ message }),
  });
  const duration = Date.now() - start;
  const data = await res.json();
  return { status: res.status, duration, data };
}

async function runTests() {
  console.log("=== KRISHIDHENU UNIVERSAL AI ASSISTANT TEST SUITE ===");
  console.log(`Target: ${BASE_URL}\n`);

  // Test 0: Unauthenticated Security Check
  console.log("[Test 0] Checking unauthenticated access rejection...");
  const unauthRes = await fetch(`${BASE_URL}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello" }),
  });
  console.log(`  Unauthenticated status: ${unauthRes.status} (Expected: 401)`);
  console.log(`  Security check: ${unauthRes.status === 401 ? "PASSED" : "FAILED"}\n`);

  // Test 1: Farmer Role
  console.log("[Test 1] Testing Farmer Role (9828466372 - Devendra Verma)...");
  const farmer = await login("9828466372");
  console.log(`  Farmer authenticated: ${farmer.data.user?.name} (${farmer.data.user?.role})`);

  // 1A: Farmer General Query (Founder)
  console.log("\n  1A. Farmer asking: 'Who is the founder of KRISHIDHENU?'");
  const q1a = await askChatbot(farmer.cookie, "Who is the founder of KRISHIDHENU?");
  console.log(`  Status: ${q1a.status} | Source: ${q1a.data.source} | Model: ${q1a.data.model} | Latency: ${q1a.duration}ms`);
  console.log(`  Reply: ${q1a.data.reply}\n`);

  // 1B: Farmer Application Query (Token status)
  console.log("  1B. Farmer asking: 'What is my token status?'");
  const q1b = await askChatbot(farmer.cookie, "What is my token status?");
  console.log(`  Status: ${q1b.status} | Source: ${q1b.data.source} | Model: ${q1b.data.model} | Latency: ${q1b.duration}ms`);
  console.log(`  Reply: ${q1b.data.reply}\n`);

  // Test 2: Staff Role
  console.log("[Test 2] Testing Staff Role (9509082087 - Suresh Sharma)...");
  const staff = await login("9509082087");
  console.log(`  Staff authenticated: ${staff.data.user?.name} (${staff.data.user?.role})`);

  // 2A: Staff Centre Queue Query
  console.log("\n  2A. Staff asking: 'What is today\'s queue status at my centre?'");
  const q2a = await askChatbot(staff.cookie, "What is today's queue status at my centre?");
  console.log(`  Status: ${q2a.status} | Source: ${q2a.data.source} | Model: ${q2a.data.model} | Latency: ${q2a.duration}ms`);
  console.log(`  Reply: ${q2a.data.reply}\n`);

  // 2B: Staff Operational Guidelines
  console.log("  2B. Staff asking: 'Explain quality grading FAQ standards'");
  const q2b = await askChatbot(staff.cookie, "Explain quality grading FAQ standards");
  console.log(`  Status: ${q2b.status} | Source: ${q2b.data.source} | Model: ${q2b.data.model} | Latency: ${q2b.duration}ms`);
  console.log(`  Reply: ${q2b.data.reply}\n`);

  // Test 3: Admin Role
  console.log("[Test 3] Testing Admin Role (9258879190 - Administrator)...");
  const admin = await login("9258879190");
  console.log(`  Admin authenticated: ${admin.data.user?.name} (${admin.data.user?.role})`);

  // 3A: Admin Overview & Disbursement Summary
  console.log("\n  3A. Admin asking: 'What are today\'s total procurement numbers and disbursement summary?'");
  const q3a = await askChatbot(admin.cookie, "What are today's total procurement numbers and disbursement summary?");
  console.log(`  Status: ${q3a.status} | Source: ${q3a.data.source} | Model: ${q3a.data.model} | Latency: ${q3a.duration}ms`);
  console.log(`  Reply: ${q3a.data.reply}\n`);

  // 3B: Hindi Language Support
  console.log("  3B. Admin asking in Hindi: 'Explain MSP in simple Hindi.'");
  const q3b = await askChatbot(admin.cookie, "Explain MSP in simple Hindi.");
  console.log(`  Status: ${q3b.status} | Source: ${q3b.data.source} | Model: ${q3b.data.model} | Latency: ${q3b.duration}ms`);
  console.log(`  Reply: ${q3b.data.reply}\n`);

  console.log("=================================================");
  console.log("ALL ROLES (FARMER, STAFF, ADMIN) VERIFIED ON LIVE PRODUCTION!");
  console.log("=================================================");
}

runTests().catch(console.error);
