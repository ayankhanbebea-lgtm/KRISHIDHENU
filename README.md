# KRISHIDHENU — A Digital Farmer Procurement & Smart Mandi Management Platform

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)](https://nextjs.org/)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini%202.5%20Flash-4285F4?logo=google)](https://aistudio.google.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-green?logo=node.js)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/Database-SQLite%20(node%3Asqlite)-003B57?logo=sqlite)](https://nodejs.org/api/sqlite.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Platform:** KRISHIDHENU — Digital Farmer Procurement & Smart Mandi Management  
> **Author:** Ayan Khan ([@ayankhanbebea-lgtm](https://github.com/ayankhanbebea-lgtm))  
> **Documentation:** [PROMPTS.md](./PROMPTS.md)

---

## 🌾 Overview

**KRISHIDHENU** is an automated, transparent, and bilingual (Hindi & English) digital farmer procurement and smart Mandi management platform. It streamlines agricultural grain procurement at Minimum Support Price (MSP) by connecting farmers, procurement centre staff, and administrators into an integrated, paperless workflow.

The platform eliminates physical bottleneck queues, reduces distress selling, guarantees transparent weighing and quality grading, and provides end-to-end visibility into direct benefit transfer (DBT) payments.

### 🌟 Core Capabilities
- **Digital Farmer Registration & Authentication:** Fast, passwordless onboarding using HMAC-SHA256 hashed OTPs and secure HTTP-only sessions.
- **Transparent Procurement Token & Queue Management:** Guaranteed unique cryptographic token generation with FIFO scheduling and a strict 3-active-token limit.
- **Real-Time Procurement Centre Updates:** Live centre capacity monitoring, queue progression rails, and wait-time estimations.
- **Role-Based Dashboards:** Dedicated, high-performance interfaces tailored for **Farmers**, **Mandi Staff**, and **Platform Administrators**.
- **MSP & Procurement Transparency:** Real-time Minimum Support Price rates, statutory moisture deduction tables, and quality grading standards.
- **Payment & DBT Tracking:** Real-time visibility into electronic weighbridge slips, net payable calculations, bank detail submissions, and transaction reference (UTR) disbursements.
- **AI-Powered Multilingual Farmer Assistant:** Context-grounded, zero-hallucination conversational assistant powered by Google Gemini (`gemini-2.5-flash`), operating in fluent Devanagari Hindi and English.
- **Secure Role-Based Access:** Enforced through middleware validation across `FARMER`, `STAFF`, and `ADMIN` operational roles.

---

## 🚀 Key Features

### 🚜 Farmer Experience
- **Guided 6-Step Booking:** Crop → Quantity/Land → Centre → Date → Slot → Review & Confirm.
- **Dynamic Token Flow:** Guaranteed unique cryptographic token generation (e.g. `WHT-0105`, `BAJ-0121`).
- **Real-Time Queue Rail:** Visual progress tracking from "Now Serving" to the farmer's grain-marked token with live estimated wait times.
- **AI Sahayak (Multilingual Assistant):** Direct bottom-bar and dashboard access to an empathetic, bilingual assistant answering questions regarding token status, queue position, fair moisture deductions, and required documents.
- **DBT Bank Settlement:** Farmers track weighing slips, quality grades, deductions, and direct bank UTR transfers in real time.

### 🏢 Mandi Staff Experience
- **Centre-Scoped Station Queue:** Staff at Sitapura, Sanganer, or Chaksu manage arrivals for their assigned centre.
- **State-Machine Enforcement:** Enforces strict sequential transitions:  
  `BOOKED` → `ARRIVED` → `VERIFIED` → `WEIGHING` → `PROCUREMENT_COMPLETED` → `PAYMENT_COMPLETED`.
- **Electronic Weighing & Quality Entry:** Records actual weight in quintals, quality grade (Grade A / Grade B), and fair moisture deductions.

### 🏛️ Administrator Experience
- **Statewide Mandi Analytics:** Live capacity utilization, throughput, and bottleneck detection across procurement centres.
- **Congestion Detector:** Automatically flags high-congestion centres (`Normal`, `Busy`, `High Load`) to balance farmer influx.
- **Audit & Financial Logs:** Tracks state treasury disbursements, bank submissions, and payment references.

---

## 🛠️ Tech Stack & Architecture

- **Framework:** Next.js 14 App Router (React 18, Tailwind CSS)
- **Database Engine:** Node 22 native `node:sqlite` (synchronous transactions, zero heavy ORM bloat)
- **AI Model:** Google Gemini (`gemini-2.5-flash` via native Web `fetch` REST API; configurable via `GEMINI_MODEL`)
- **Authentication:** Passwordless HMAC-SHA256 hashed OTPs, HTTP-only JWT sessions, and role-based route middleware.
- **Multi-Language:** English & Hindi localization engine.
- **Agrometeorological Feed:** Live weather forecasting via Open-Meteo.

---

## 🤖 AI Assistant & Prompt Engineering Architecture

KRISHIDHENU demonstrates systematic prompt engineering methodologies powering its conversational assistant:
1. **Context-Aware Conversational Assistant:** Integrated with **Google Gemini Generative AI (`gemini-2.5-flash`)**, replacing static rule-based routines with a real-time LLM.
2. **Zero-Hallucination Architecture:** The assistant queries the live SQLite database (`dev.db`) at runtime and directly injects verified farmer profiles, active tokens, live queue positions, wait time estimates, and DBT payment states into the LLM system prompt.
3. **Bilingual Grounding:** Contextually detects English or Hindi/Hinglish and responds in simple, empathetic Devanagari Hindi or professional English tailored to rural agricultural contexts.
4. **Prompt Engineering Documentation:** Full technical documentation in [`PROMPTS.md`](./PROMPTS.md) detailing the 5-part initiation prompt, 6 prompt engineering techniques, 3 before-and-after refinement case studies with evaluation metrics, and verified multi-tool contributions.

---

## 📋 The Canonical 5-Part System Initiation Prompt

The KRISHIDHENU platform was engineered using the canonical 5-part prompt framework:

1. **Role:** Elite Full-Stack Principal Systems Architect, Indian Agritech Specialist, and Senior Prompt Engineer.
2. **Task:** Design, implement, and verify "KRISHIDHENU": an automated, transparent, and bilingual (Hindi/English) MSP crop procurement and queue management system.
3. **Context:** Indian farmers facing distress selling, physical Mandi bottlenecks, and arbitrary deductions; running on Next.js 14, Node 22 SQLite, and Google Gemini API.
4. **Constraints:** 0% token hallucination (all dynamic claims strictly anchored to SQLite database), max 3 active tokens per farmer, bilingual Hindi/English fluency, offline fallback safety, passwordless HMAC OTP authentication.
5. **Output Format:** Complete production Next.js code, typed TypeScript contracts, SQL schemas, automated test suites, and Markdown documentation.

*(See full prompt details and before/after refinement examples in [`PROMPTS.md`](./PROMPTS.md).)*

---

## 🤖 Multi-AI Tool Contribution Matrix

| AI Tool | Lifecycle Stage | Primary Contribution | Key Artifacts |
| :--- | :--- | :--- | :--- |
| **OpenAI ChatGPT** *(GPT-4o)* | System Foundation & Architecture | Domain decomposition, procurement state machine design, baseline Mandi data schemas | `prisma/schema.sql`, `lib/services.ts` |
| **Anthropic Claude** *(Claude 3.5 Sonnet)* | Concurrency & Security Hardening | Concurrency audit, HMAC-SHA256 OTP hashing, transaction isolation, 3-active-token backend limits | `lib/auth.ts`, `lib/db.ts`, `scripts/regression-test.ts` |
| **Google Gemini** *(Gemini 2.5 Flash)* | Conversational AI Engine | Runtime bilingual farmer assistant, zero-hallucination SQLite context injection, anti-hallucination prompt guardrails | `app/api/farmer/assistant/route.ts`, `app/farmer/assistant/page.tsx` |

---

## ⚙️ Quick Start (Local Development)

### Prerequisites
- Node.js 22.x LTS (required for native `node:sqlite`)
- Git

### Installation
```bash
# 1. Clone the repository
git clone https://github.com/ayankhanbebea-lgtm/KRISHIDHENU.git
cd KRISHIDHENU

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
```

### Environment Variables (`.env.local`)
```env
NODE_ENV=development
DATABASE_PATH=prisma/dev.db
JWT_SECRET=your_super_secret_jwt_key_here
OTP_SECRET=your_otp_salt_secret_here
OTP_DEMO_MODE=true

# Google Gemini API (Get key from https://aistudio.google.com/)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### Run Locally
```bash
# Start Next.js development server
npm run dev

# Open in browser
http://localhost:3000
```

---

## 🧪 Automated Testing Suites

KRISHIDHENU contains comprehensive automated test suites:

### 1. Core Platform Regression Test (11/11 Suites Passed - 100% OK)
Validates concurrency, 3-token limits, HMAC OTP authentication, database persistence, multi-language UI, and full procurement-to-payment lifecycle:
```bash
npx tsx scripts/regression-test.ts
```

### 2. AI Assistant Verification Test (100% OK)
Validates authenticated session enforcement, empty-question validation (400 Bad Request), SQLite context retrieval for active tokens/queue, bilingual English/Hindi query responses, and graceful offline fallback handling:
```bash
npx tsx scripts/test-ai-assistant.ts
```

### 3. Production Build Test
Verifies that all 62 Next.js static and dynamic routes compile cleanly with zero TypeScript errors:
```bash
npm run build
```

---

## 🚢 Deployment

### 1. Railway (Recommended for Persistent SQLite)
- Connect this GitHub repository (`KRISHIDHENU`) to [Railway](https://railway.app).
- In Railway Service Settings, attach a **Persistent Volume** mounted at `/app/data`.
- Set Environment Variables:
  - `NIXPACKS_NODE_VERSION=22`
  - `DATABASE_PATH=/app/data/dev.db`
  - `JWT_SECRET=your_random_64_char_key`
  - `OTP_SECRET=your_random_64_char_salt`
  - `OTP_DEMO_MODE=true`
  - `GEMINI_API_KEY=your_gemini_api_key`
  - `GEMINI_MODEL=gemini-2.5-flash`

### 2. Vercel Deployment
- Deploy directly to [Vercel](https://vercel.com).
- Note: Vercel serverless functions run on ephemeral micro-VM filesystems (`/tmp`). For a production Vercel deployment with multi-region persistence, connect Turso / LibSQL or a cloud Postgres instance via `DATABASE_URL`.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details. Built with ❤️ for the Indian farming community.
