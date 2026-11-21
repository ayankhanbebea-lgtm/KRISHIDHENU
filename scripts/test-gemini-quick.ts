import fs from "fs";
import path from "path";

const envFiles = [".env.development.local", ".env.local", ".env"];
let key = "";
for (const envFile of envFiles) {
  const filePath = path.join(process.cwd(), envFile);
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (line.startsWith("GEMINI_API_KEY=") && !key) {
        key = line.split("=")[1].replace(/\"/g, "").trim();
      }
    }
  }
}

async function run() {
  for (const m of ["gemini-3.5-flash-lite", "gemini-3.8-flash"]) {
    const t0 = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      console.log(m, "-> Status:", res.status, "Time:", Date.now() - t0, "Reply:", data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.slice(0, 50));
    } catch (e: any) {
      console.log(m, "-> Error:", e.message);
    }
  }
}
run();
