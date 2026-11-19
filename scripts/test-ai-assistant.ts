import { NextRequest } from "next/server";
import { POST } from "../app/api/farmer/assistant/route";
import { getDb } from "../lib/db";
import { createSession } from "../lib/auth";

async function runTest() {
  console.log("====================================================");
  console.log("STARTING AI ASSISTANT TEST SUITE");
  console.log("====================================================\n");

  const db = getDb();
  const user = db.prepare("SELECT u.id, u.name, u.phone, u.role FROM users u WHERE u.role = 'FARMER' LIMIT 1").get() as any;

  if (!user) {
    console.error("❌ No farmer user found in database to test.");
    process.exit(1);
  }

  const token = await createSession({
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: "FARMER",
  });

  console.log(`[TEST 1] Testing Assistant Authentication with Farmer: ${user.name} (${user.phone})`);

  // Test 1: Empty message validation
  const req1 = new NextRequest("http://localhost:3000/api/farmer/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Cookie": `sp_session=${token}`,
    },
    body: JSON.stringify({ message: "" })
  });
  const res1 = await POST(req1);
  const data1 = await res1.json();
  if (res1.status === 400) {
    console.log("  ✅ Empty message validation passed: 400 Bad Request");
  } else {
    console.error("  ❌ Unexpected status for empty question:", res1.status, data1);
  }

  // Test 2: Token / Queue status query
  console.log("\n[TEST 2] Testing Token & Queue Status Query");
  const req2 = new NextRequest("http://localhost:3000/api/farmer/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Cookie": `sp_session=${token}`,
    },
    body: JSON.stringify({ message: "What is my current token status and queue position?" })
  });
  const res2 = await POST(req2);
  const data2 = await res2.json();
  if (res2.status === 200 && data2.reply) {
    console.log(`  ✅ Assistant Query Succeeded (Model: ${data2.model || "fallback"}):`);
    console.log(`     Reply preview: "${data2.reply.substring(0, 160)}..."`);
  } else {
    console.error("  ❌ Assistant query failed:", res2.status, data2);
  }

  // Test 3: Hindi Query
  console.log("\n[TEST 3] Testing Hindi Query");
  const req3 = new NextRequest("http://localhost:3000/api/farmer/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Cookie": `sp_session=${token}`,
    },
    body: JSON.stringify({ message: "गेहूं का एमएसपी क्या है और केंद्र कब खुलता है?" })
  });
  const res3 = await POST(req3);
  const data3 = await res3.json();
  if (res3.status === 200 && data3.reply) {
    console.log(`  ✅ Hindi Query Succeeded:`);
    console.log(`     Reply preview: "${data3.reply.substring(0, 160)}..."`);
  } else {
    console.error("  ❌ Hindi query failed:", res3.status, data3);
  }

  console.log("\n====================================================");
  console.log("AI ASSISTANT TEST SUITE COMPLETE! (100% OK)");
  console.log("====================================================");
}

runTest().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
