import { NextRequest } from "next/server";
import { POST, GET } from "../app/api/farmer/assistant/route";
import { detectLanguage } from "../lib/language";
import { getDb } from "../lib/db";
import { createSession } from "../lib/auth";

async function runTestSuite() {
  console.log("====================================================");
  console.log("KRISHIDHENU AI ASSISTANT & LANGUAGE TEST SUITE");
  console.log("====================================================\n");

  // 1. Language Detection Unit Tests
  console.log("--- 1. Testing Language Detection Logic ---");
  const languageTestCases: { message: string; expected: "en" | "hi" | "hinglish" }[] = [
    { message: "Hello, how can I book a slot?", expected: "en" },
    { message: "What is my token status?", expected: "en" },
    { message: "मेरा टोकन स्टेटस क्या है?", expected: "hi" },
    { message: "Mera token status kya hai?", expected: "hinglish" },
    { message: "Mujhe booking karni hai", expected: "hinglish" },
    { message: "Please explain MSP.", expected: "en" },
    { message: "मुझे MSP समझाओ", expected: "hi" },
  ];

  for (const tc of languageTestCases) {
    const detected = detectLanguage(tc.message);
    if (detected !== tc.expected) {
      throw new Error(`Language detection mismatch for "${tc.message}": expected "${tc.expected}", got "${detected}"`);
    }
    console.log(`  ✅ "${tc.message}" -> Detected: ${detected.toUpperCase()}`);
  }

  // 2. Setup Farmer Session
  const db = getDb();
  const user = (await db.prepare("SELECT u.id, u.name, u.phone, u.role FROM users u WHERE u.role = 'FARMER' LIMIT 1").get()) as any;

  if (!user) {
    throw new Error("No farmer user found in database for testing.");
  }

  const token = await createSession({
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: "FARMER",
  });

  console.log(`\n--- 2. Testing API Route with Farmer: ${user.name} (${user.phone}) ---`);

  // Test 2a: Empty question validation (400)
  const reqEmpty = new NextRequest("http://localhost:3000/api/farmer/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Cookie": `sp_session=${token}`,
    },
    body: JSON.stringify({ message: "" }),
  });
  const resEmpty = await POST(reqEmpty);
  if (resEmpty.status === 400) {
    console.log("  ✅ Empty message correctly rejected (400 Bad Request)");
  } else {
    throw new Error(`Expected 400 for empty message, got ${resEmpty.status}`);
  }

  // Test 2b: Status Check GET endpoint
  const reqGet = new NextRequest("http://localhost:3000/api/farmer/assistant", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Cookie": `sp_session=${token}`,
    },
  });
  const resGet = await GET(reqGet);
  const dataGet = await resGet.json();
  console.log(`  ✅ GET /api/farmer/assistant status: ${dataGet.status}, defaultLanguage: ${dataGet.defaultLanguage}`);

  // Test 2c: Execute all 7 specified queries
  console.log("\n--- 3. Testing 7 Mandatory Language Queries against API Route ---");
  for (const tc of languageTestCases) {
    const req = new NextRequest("http://localhost:3000/api/farmer/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Cookie": `sp_session=${token}`,
      },
      body: JSON.stringify({ message: tc.message }),
    });

    const res = await POST(req);
    const data = await res.json();

    if (res.status !== 200 || !data.reply) {
      throw new Error(`Query failed for "${tc.message}": status ${res.status}, response: ${JSON.stringify(data)}`);
    }

    console.log(`  ✅ Query: "${tc.message}"`);
    console.log(`     Language: ${data.language || detectLanguage(tc.message)} | Model: ${data.model} | isLive: ${Boolean(data.isLive)}`);
    console.log(`     Preview: "${data.reply.substring(0, 110)}..."\n`);
  }

  console.log("====================================================");
  console.log("ALL AI ASSISTANT & LANGUAGE TESTS PASSED! (100% OK)");
  console.log("====================================================\n");
}

runTestSuite().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});
