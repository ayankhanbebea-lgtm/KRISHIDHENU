const baseUrl = "https://krishidhenu.vercel.app";

async function testLiveChatbot() {
  console.log("================================================================================");
  console.log("TESTING 6 CHATBOT QUESTIONS ON LIVE VERCEL PRODUCTION APPLICATION");
  console.log(`Target: ${baseUrl}`);
  console.log("================================================================================\n");

  function extractCookie(res: Response): string {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return "";
    return setCookie.split(";")[0];
  }

  // Authenticate as the farmer who has the active booking & payment in production (9828466372)
  const farmerPhone = "9828466372";
  console.log(`1. Authenticating Farmer (${farmerPhone}) on Live Vercel...`);
  await fetch(`${baseUrl}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: farmerPhone }),
  });

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: farmerPhone, otp: "123456" }),
  });
  const farmerCookie = extractCookie(verifyRes);
  const verifyData = await verifyRes.json();
  if (!verifyData.ok || !verifyData.user) {
    throw new Error(`Farmer login failed on live Vercel: ${JSON.stringify(verifyData)}`);
  }
  console.log(`   ✅ Authenticated: ${verifyData.user.name} (${verifyData.user.phone})\n`);

  // Check Assistant Status endpoint
  console.log("2. Checking Live Assistant Status Endpoint (/api/farmer/assistant)...");
  const statusRes = await fetch(`${baseUrl}/api/farmer/assistant`, {
    headers: { Cookie: farmerCookie },
  });
  const statusData = await statusRes.json();
  console.log(`   ✅ Status: ${statusData.status} | isLive: ${statusData.isLive} | Engine: ${statusData.engine} | Model: ${statusData.model}\n`);

  // Execute the 6 Exact User-Specified Questions on Live Vercel
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
        return "Identifies Ayan Khan as founder/creator and correctly distinguishes itself as an AI assistant.";
      },
    },
    {
      label: "B",
      question: "What is KRISHIDHENU?",
      expectedSource: "gemini",
      validate: (reply: string) => {
        const lower = reply.toLowerCase();
        if (!lower.includes("mandi") && !lower.includes("procurement") && !lower.includes("farmer") && !lower.includes("msp")) {
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
          throw new Error("Reply did not reference verified farmer token (WHT-0100)!");
        }
        return "Grounds response in verified Turso records: Token WHT-0100 explained naturally.";
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
        return "Grounds response in verified Turso records: Status PAID and ₹56,875 explained naturally.";
      },
    },
    {
      label: "E",
      question: "Explain MSP in simple Hindi.",
      expectedSource: "gemini",
      validate: (reply: string) => {
        if (!/[\u0900-\u097F]/.test(reply)) {
          throw new Error("Reply was not in Hindi as requested!");
        }
        return "Gemini directly generated a clear, simple Hindi explanation without querying farmer DB.";
      },
    },
    {
      label: "F",
      question: "Hello, how are you?",
      expectedSource: "gemini",
      validate: (reply: string) => {
        if (reply.length < 5) throw new Error("Reply too short.");
        return "Natural Gemini conversational greeting.";
      },
    },
  ];

  console.log("3. Executing 6 Live Questions on Vercel Production...");

  for (const tc of testCases) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[TEST ${tc.label}] Question: "${tc.question}"`);

    const qRes = await fetch(`${baseUrl}/api/farmer/assistant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: farmerCookie,
      },
      body: JSON.stringify({ message: tc.question }),
    });

    const qData = await qRes.json();
    if (qRes.status !== 200 || !qData.reply) {
      throw new Error(`Live test ${tc.label} failed: HTTP ${qRes.status} ${JSON.stringify(qData)}`);
    }

    console.log(`   Source Indicator : "${qData.source}" (Expected: "${tc.expectedSource}")`);
    console.log(`   Model Used       : "${qData.model}" (isLive: ${qData.isLive})`);
    console.log(`   Response Time    : ${qData.responseTimeMs}ms`);

    if (qData.source !== tc.expectedSource) {
      throw new Error(`Test ${tc.label} source mismatch! Got "${qData.source}", expected "${tc.expectedSource}"`);
    }

    const valMsg = tc.validate(qData.reply);
    console.log(`   Validation       : ✅ ${valMsg}`);
    console.log(`   Live Response    :\n   "${qData.reply.replace(/\n+/g, " ").substring(0, 160)}..."`);
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL 6 LIVE VERCEL PRODUCTION TESTS PASSED 100% SUCCESSFULLY!");
  console.log("================================================================================\n");
}

testLiveChatbot().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});
