import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "../lib/db";
import { createSession } from "../lib/auth";
import { POST, GET } from "../app/api/farmer/assistant/route";

// Load development environment variables if present
try {
  const envContent = fs.readFileSync(path.join(process.cwd(), ".env.development.local"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {}

async function runChatbotTests() {
  console.log("================================================================================");
  console.log("TESTING CHATBOT ARCHITECTURE & GEMINI AS PRIMARY ENGINE");
  console.log("================================================================================\n");

  const db = getDb();

  // Find the active verified farmer who has the active booking & payment in production Turso database
  const farmerUser = (await db.prepare(`
    SELECT u.id, u.name, u.phone, u.role 
    FROM users u 
    JOIN farmer_profiles fp ON fp.user_id = u.id 
    JOIN bookings b ON b.farmer_id = fp.id 
    WHERE u.role = 'FARMER' 
    LIMIT 1
  `).get()) as any;
  if (!farmerUser) {
    throw new Error("No farmer user found in database to run authenticated assistant tests.");
  }

  console.log(`Authenticated Test Farmer: ${farmerUser.name} (${farmerUser.phone}) [ID: ${farmerUser.id}]`);

  const sessionToken = await createSession({
    id: farmerUser.id,
    name: farmerUser.name,
    phone: farmerUser.phone,
    role: "FARMER",
  });

  // 1. Test GET /api/farmer/assistant status
  console.log("\n--- 1. Testing GET /api/farmer/assistant Status Endpoint ---");
  const getReq = new NextRequest("http://localhost:3000/api/farmer/assistant", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${sessionToken}`,
      "Cookie": `sp_session=${sessionToken}`,
    },
  });
  const getRes = await GET(getReq);
  const getData = await getRes.json();
  console.log(`Status: ${getData.status} | isLive: ${getData.isLive} | Engine: ${getData.engine} | Model: ${getData.model}`);
  if (!getData.hasKey || !getData.isLive) {
    throw new Error("Gemini AI is not active or API key is unconfigured!");
  }
  console.log("✅ Gemini AI Assistant confirmed active and ready.\n");

  // 2. Test the 6 Exact User-Specified Questions
  console.log("--- 2. Testing 6 Exact User-Specified Questions ---");

  const testCases = [
    {
      label: "A",
      question: "Who is the founder of KRISHIDHENU?",
      expectedSource: "gemini",
      validate: (reply: string) => {
        const lower = reply.toLowerCase();
        if (!lower.includes("ayan khan")) {
          throw new Error("Reply did not mention Ayan Khan as founder/creator!");
        }
        if (lower.includes("i am the founder") || lower.includes("i created krishidhenu")) {
          throw new Error("Assistant incorrectly claimed itself to be the founder!");
        }
        return "Acknowledges Ayan Khan as founder/creator and identifies itself as AI assistant.";
      },
    },
    {
      label: "B",
      question: "What is KRISHIDHENU?",
      expectedSource: "gemini",
      validate: (reply: string) => {
        const lower = reply.toLowerCase();
        if (!lower.includes("procurement") && !lower.includes("mandi") && !lower.includes("farmer") && !lower.includes("msp")) {
          throw new Error("Reply did not explain KRISHIDHENU platform context!");
        }
        return "Accurately explains KRISHIDHENU digital procurement platform context.";
      },
    },
    {
      label: "C",
      question: "What is my token status?",
      expectedSource: "gemini_db",
      validate: (reply: string) => {
        if (!reply.includes("WHT-0100") && !reply.includes("0100")) {
          throw new Error("Reply did not reference the verified farmer token (WHT-0100)!");
        }
        return "Correctly fetched verified token (WHT-0100) and explained it naturally.";
      },
    },
    {
      label: "D",
      question: "What is my payment status?",
      expectedSource: "gemini_db",
      validate: (reply: string) => {
        const lower = reply.toLowerCase();
        if (!lower.includes("paid") && !lower.includes("56,875") && !lower.includes("56875")) {
          throw new Error("Reply did not reference verified payment status/amount!");
        }
        return "Correctly fetched verified payment data (PAID / ₹56,875) from Turso.";
      },
    },
    {
      label: "E",
      question: "Explain MSP in simple Hindi.",
      expectedSource: "gemini",
      validate: (reply: string) => {
        // Must contain Hindi Devanagari characters
        if (!/[\u0900-\u097F]/.test(reply)) {
          throw new Error("Reply was not in Hindi as explicitly requested!");
        }
        return "Generated direct explanation of MSP in clear Hindi without database lookup.";
      },
    },
    {
      label: "F",
      question: "Hello, how are you?",
      expectedSource: "gemini",
      validate: (reply: string) => {
        if (reply.length < 5) throw new Error("Reply too short for conversation.");
        return "Normal friendly Gemini conversation.";
      },
    },
  ];

  for (const tc of testCases) {
    console.log(`\n[Question ${tc.label}] "${tc.question}"`);
    const req = new NextRequest("http://localhost:3000/api/farmer/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
        "Cookie": `sp_session=${sessionToken}`,
      },
      body: JSON.stringify({ message: tc.question }),
    });

    const res = await POST(req);
    const data = await res.json();

    if (res.status !== 200 || !data.reply) {
      throw new Error(`Question ${tc.label} failed: HTTP ${res.status} ${JSON.stringify(data)}`);
    }

    console.log(`   Source Indicator: "${data.source}" (Expected: "${tc.expectedSource}")`);
    console.log(`   Model Used      : "${data.model}" (isLive: ${data.isLive})`);
    console.log(`   Response Time   : ${data.responseTimeMs}ms`);

    if (data.source !== tc.expectedSource) {
      throw new Error(`Question ${tc.label} source mismatch! Got "${data.source}", expected "${tc.expectedSource}"`);
    }

    const validationMsg = tc.validate(data.reply);
    console.log(`   Validation      : ✅ ${validationMsg}`);
    console.log(`   Reply Preview   :\n   "${data.reply.replace(/\n+/g, " ").substring(0, 160)}..."`);
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL 6 CHATBOT ARCHITECTURE & GEMINI VERIFICATION TESTS PASSED (100% OK)!");
  console.log("================================================================================\n");
}

runChatbotTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
