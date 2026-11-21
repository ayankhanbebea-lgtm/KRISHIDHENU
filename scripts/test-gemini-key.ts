import fs from "fs";
import path from "path";

const envFiles = [".env.development.local", ".env.local", ".env"];
let key = "";
let model = "";

for (const envFile of envFiles) {
  const filePath = path.join(process.cwd(), envFile);
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (line.startsWith("GEMINI_API_KEY=") && !key) {
        key = line.split("=")[1].replace(/\"/g, "").trim();
      }
      if (line.startsWith("GEMINI_MODEL=") && !model) {
        model = line.split("=")[1].replace(/\"/g, "").trim();
      }
    }
  }
}

console.log("Model:", model);
console.log("Key length:", key.length, "Prefix:", key.slice(0, 10));

async function run() {
  const modelsToTest = [model, "gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"].filter(Boolean);

  for (const m of Array.from(new Set(modelsToTest))) {
    console.log(`\nTesting model: ${m}...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Hello, reply with 1 word." }] }]
        })
      });
      console.log(`Status: ${res.status} ${res.statusText}`);
      const data = await res.json();
      console.log(`Response:`, JSON.stringify(data).slice(0, 200));
    } catch (e: any) {
      console.error("Error:", e.message);
    }
  }
}

run();
