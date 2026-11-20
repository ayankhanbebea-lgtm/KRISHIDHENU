# KRISHIDHENU — A Digital Farmer Procurement & Smart Mandi Management Platform

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)](https://nextjs.org/)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini%202.5%20Flash-4285F4?logo=google)](https://aistudio.google.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-green?logo=node.js)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/Database-SQLite%20(node%3Asqlite)-003B57?logo=sqlite)](https://nodejs.org/api/sqlite.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Platform:** KRISHIDHENU — Digital Farmer Procurement & Smart Mandi Management  
> **Repository:** [https://github.com/ayankhanbebea-lgtm/KRISHIDHENU](https://github.com/ayankhanbebea-lgtm/KRISHIDHENU)  
> **Primary Production Deployment (Railway):** Continuous Stateful Container with Persistent Volume Storage (`/app/data/dev.db`)  
> **Secondary Preview Deployment (Vercel):** [https://krishidhenu.vercel.app](https://krishidhenu.vercel.app)  
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
- **AI-Powered Multilingual Farmer Assistant:** Context-grounded, zero-hallucination conversational assistant powered by Google Gemini (`gemini-2.5-flash`), operating in fluent Devanagari Hindi, Hinglish, and English.
- **Secure Role-Based Access:** Enforced through middleware validation across `FARMER`, `STAFF`, and `ADMIN` operational roles.

---

## 🏗️ Deployment & Database Architecture

KRISHIDHENU is engineered to run in dual environments:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          KRISHIDHENU ARCHITECTURE                               │
├───────────────────────────────────────┬─────────────────────────────────────────┤
│    PRIMARY PRODUCTION (Railway)       │       SECONDARY PREVIEW (Vercel)        │
│    Stateful Container Architecture    │       Stateless Edge Serverless         │
├───────────────────────────────────────┼─────────────────────────────────────────┤
│ • Continuous Node.js 22 Long-Running  │ • Ephemeral Edge Serverless Lambdas     │
│   Process                             │ • Instant global edge delivery          │
│ • Persistent Volume: /app/data        │ • Isolated /tmp sandbox database        │
│ • Single Authoritative dev.db SQLite  │ • Full UI & API demonstration           │
│ • Continuous EventSource / SSE Streams│ • Demo OTP authentication (123456)      │
│ • True persistent operational storage │ • Standalone showcase deployment        │
└───────────────────────────────────────┴─────────────────────────────────────────┘
```

### 🔍 Architectural Analysis: Why Dual SQLite Files Cannot Automatically Synchronize
SQLite is a fast, ACID-compliant, zero-configuration **embedded file-based database**. Its storage engine writes directly to a physical file on the host filesystem via POSIX system calls.
- **Railway** provides a stateful Linux container with a dedicated block volume attached at `/app/data`. The file `/app/data/dev.db` is durable, surviving restarts, redeployments, and scale events.
- **Vercel** executes each route handler in isolated, stateless, and ephemeral serverless MicroVM containers. The local filesystem (`/tmp`) is isolated per container and recycled periodically.
- Because SQLite has no network wire protocol or TCP listener, **two separate SQLite database files on Railway and Vercel cannot synchronize across cloud boundaries without an external distributed database system.**

### 🏆 Selected Safe Architecture: Option A (Primary Production on Railway + Preview on Vercel)
- **Primary Production Environment (Railway):**
  - Serves as the authoritative production environment.
  - Hosts the persistent `/app/data/dev.db` database.
  - All operational farmer bookings, staff queue station actions, weighbridge entries, and DBT payments persist here permanently.
- **Secondary Preview Environment (Vercel):**
  - Live at [https://krishidhenu.vercel.app](https://krishidhenu.vercel.app).
  - Operates as a resilient demonstration and preview platform.
  - Features fixed demo OTP login (`123456`), live weather forecasts, and full interactive dashboard walkthroughs.

### 🔄 Option B Migration Blueprint (Shared External Distributed Database)
If a single unified database shared simultaneously across both Railway and Vercel is required in a future evolution, follow this verified migration roadmap:
1. **Target Database:** Deploy a managed PostgreSQL instance (via Railway PostgreSQL, Neon, or Supabase) or Turso / LibSQL (cloud SQLite over HTTP/WebSocket).
2. **Asynchronous Query Migration:** Convert synchronous `node:sqlite` calls (`db.prepare().all()`, `.run()`, `.get()`) into async query calls across the route handlers and services.
3. **Connection Pooling:** Implement connection pooling via Prisma or `@neondatabase/serverless` to gracefully absorb concurrent serverless lambda invocations from Vercel.
4. **Data Seed & Migration:** Execute `pg_dump` / SQL data transfer from `/app/data/dev.db` into the central cluster, configuring `DATABASE_URL` uniformly across both Railway and Vercel environments.

---

## 🚀 Key Features

### 🚜 Farmer Experience
- **Guided 6-Step Booking:** Crop → Quantity/Land → Centre → Date → Slot → Review & Confirm.
- **Dynamic Token Flow:** Guaranteed unique cryptographic token generation (e.g. `WHT-0105`, `BAJ-0121`).
- **Real-Time Queue Rail:** Visual progress tracking from "Now Serving" to the farmer's grain-marked token with live estimated wait times.
- **AI Sahayak (Multilingual Assistant):** Direct bottom-bar and dashboard access to an empathetic, bilingual assistant answering questions regarding token status, queue position, fair moisture deductions, and required documents.
- **DBT Bank Settlement:** Farmers track weighing slips, quality grades, deductions, and direct bank UTR transfers in real time.

### 🏢 Mandi Staff Experience
- **Centre-Scoped Station Queue:** Staff at Sitapura (`JPR01`), Sanganer (`JPR02`), or Chaksu (`JPR03`) manage arrivals for their assigned centre.
- **State-Machine Enforcement:** Enforces strict sequential transitions:  
  `BOOKED` → `ARRIVED` → `VERIFIED` → `WEIGHING` → `PROCUREMENT_COMPLETED` → `PAYMENT_COMPLETED`.
- **Electronic Weighing & Quality Entry:** Records actual weight in quintals, quality grade (Grade A / Grade B), and fair moisture deductions.
- **Anti-Flicker & In-Flight Tracking:** Stable request sequencing (`latestReqIdRef`), SSE event bus, and automatic zero-stale background polling.

### 🏛️ Administrator Experience
- **Statewide Mandi Analytics:** Live capacity utilization, throughput, and bottleneck detection across procurement centres.
- **Congestion Detector:** Automatically flags high-congestion centres (`Normal`, `Busy`, `High Load`) to balance farmer influx.
- **Audit & Financial Logs:** Tracks state treasury disbursements, bank submissions, and payment references.

---

## 🛠️ Tech Stack

- **Framework:** Next.js 14 App Router (React 18, Tailwind CSS)
- **Database Engine:** Node 22 native `node:sqlite` (`DatabaseSync` with `PRAGMA journal_mode = DELETE` and `PRAGMA synchronous = FULL`)
- **AI Model:** Google Gemini (`gemini-2.5-flash` with automatic fallback to `gemini-3.5-flash-lite`, `gemini-3.5-flash`, and `gemini-3.8-flash`)
- **Authentication:** Passwordless HMAC-SHA256 hashed OTPs, HTTP-only JWT sessions, and role-based route middleware
- **Localization:** Bilingual engine supporting English, Devanagari Hindi, and Romanized Hinglish
- **Real-Time Engine:** Server-Sent Events (SSE) `/api/realtime/events` with adaptive 5-second polling fallback
- **Weather Feed:** Live agricultural weather via Open-Meteo

---

## 📋 Verified Test Credentials

| Role | Mobile Number | Password / Demo OTP | Assigned Centre / Scope |
| :--- | :--- | :--- | :--- |
| **Administrator** | `9258879190` | `123456` | Statewide / All Mandi Centres |
| **Mandi Staff (Sitapura)** | `9509082087` | `123456` | Jaipur Procurement Centre 01 (`JPR01`) |
| **Mandi Staff (Sanganer)** | `7870844405` | `123456` | Jaipur Procurement Centre 02 (`JPR02`) |
| **Mandi Staff (Chaksu)** | `7015962317` | `123456` | Jaipur Procurement Centre 03 (`JPR03`) |
| **Farmer (Ramesh Kumar)** | `9829124370` | `123456` | Farmer Profile `FP-1000` |
| **Farmer (Suman Devi)** | `9200000002` | `123456` | Farmer Profile `FP-1001` |
| **Farmer (Kailash Chand)** | `9200000003` | `123456` | Farmer Profile `FP-1002` |

---

## ⚙️ Quick Start (Local Development)

### Prerequisites
- Node.js 22.x LTS (>= 22.5.0 required for native `node:sqlite`)
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
JWT_SECRET=replace_with_64_character_random_secret_string_here
OTP_SECRET=replace_with_another_64_character_random_salt_string_here
OTP_DEMO_MODE=true

# Google Gemini AI Assistant
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### Run Locally
```bash
# Start development server
npm run dev

# Open in browser
http://localhost:3000
```

---

## 🧪 Automated Testing Suites

```bash
# 1. Mandatory Core Regression Suite (11/11 tests, 100% pass)
npm run test:regression

# 2. Real-Time Booking Consistency & Queue Synchronization Suite (100% pass)
npm run test:consistency

# 3. AI Assistant Language & Grounding Verification Suite (100% pass)
npm run test:ai

# 4. Production Build Verification
npm run build
```

---

## 🚢 Deployment Guide

### 1. Railway Deployment (Primary Production)

1. Connect the GitHub repository [`https://github.com/ayankhanbebea-lgtm/KRISHIDHENU`](https://github.com/ayankhanbebea-lgtm/KRISHIDHENU) on [Railway](https://railway.app).
2. Attach a **Persistent Volume** in the Railway service settings:
   - Mount Path: `/app/data`
3. Configure Service Environment Variables:
   ```env
   NODE_ENV=production
   NIXPACKS_NODE_VERSION=22
   DATABASE_PATH=/app/data/dev.db
   JWT_SECRET=your_64_character_production_jwt_secret
   OTP_SECRET=your_64_character_production_otp_secret
   OTP_DEMO_MODE=true
   GEMINI_API_KEY=your_google_gemini_api_key
   GEMINI_MODEL=gemini-2.5-flash
   ```
4. Build & Start Commands (handled automatically via [`nixpacks.toml`](./nixpacks.toml)):
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run start`
   - *Note: Railway dynamically injects `PORT`. Next.js automatically listens on `process.env.PORT`.*

### 2. Vercel Deployment (Secondary Preview)

1. Import the repository on [Vercel](https://vercel.com).
2. Configure Environment Variables in Vercel Project Settings:
   - `NODE_ENV=production`
   - `DATABASE_PATH=/tmp/dev.db`
   - `JWT_SECRET=your_jwt_secret`
   - `OTP_SECRET=your_otp_secret`
   - `OTP_DEMO_MODE=true`
   - `GEMINI_API_KEY=your_google_gemini_api_key`
   - `GEMINI_MODEL=gemini-2.5-flash`
3. Deploy directly. The preview site is live at: [https://krishidhenu.vercel.app](https://krishidhenu.vercel.app).

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details. Built with ❤️ for the Indian farming community.
