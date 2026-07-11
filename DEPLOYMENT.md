# PromptPilot: Zero-Cost Deployment Guide

This guide walks you through deploying the complete PromptPilot backend architecture to **Render Free Tier** and connecting it to the **Meta WhatsApp Cloud API Direct** and **Supabase Free Postgres** database at exactly **$0.00 operational cost**.

---

## 🏗️ Deployment Architecture Checklist

| Component | Provider | Free Tier Specification | Cost |
| :--- | :--- | :--- | :--- |
| **Relational & Vector DB** | Supabase | 500 MB Postgres storage + `pgvector` extension | $0.00 / mo |
| **Backend Compute Server** | Render | Web Service (512 MB RAM, Shared CPU, Docker) | $0.00 / mo |
| **WhatsApp Messaging** | Meta Cloud API Direct | 1,000 free service conversations per month | $0.00 / mo |
| **Primary AI Inference** | Google AI Studio (Gemini) | 15 RPM (1.5 Flash), 2 RPM (1.5 Pro), Free Embeddings | $0.00 / mo |
| **Fallback AI Inference** | Groq Cloud (Llama 3) | 30 RPM / 14,400 requests per day | $0.00 / mo |
| **Uptime Monitor** | Cron-job.org | Ping `/api/v1/health` every 14 minutes to prevent sleep | $0.00 / mo |

---

## Step 1: Set Up Supabase (Database & pgvector)

1. Go to [https://supabase.com](https://supabase.com) and create a free organization and project named `promptpilot-db`.
2. Navigate to **Project Settings -> Database**.
3. Under **Connection string**, select the **URI** tab and copy both the **Pooler** URL (`DATABASE_URL`) and the **Direct connection** URL (`DIRECT_URL`). Replace `[YOUR-PASSWORD]` with your actual database password.
4. From your terminal inside the project directory, run:
   ```bash
   # Push Prisma schema tables to Supabase
   npx prisma db push

   # Enable pgvector and install the match_project_memory() SQL function
   npx prisma db execute --file ./prisma/migrations/0_vector_init/migration.sql
   ```
5. Confirm in your Supabase SQL Editor by running `SELECT * FROM pg_extension WHERE extname = 'vector';` (you should see one row returned).

---

## Step 2: Obtain Free AI Credentials

### Google Gemini API
1. Visit [https://aistudio.google.com](https://aistudio.google.com) -> click **Get API key** -> **Create API key**.
2. Copy the key as `GEMINI_API_KEY`. This unlocks free access to `gemini-1.5-pro`, `gemini-1.5-flash`, and `text-embedding-004`.

### Groq Cloud API
1. Visit [https://console.groq.com/keys](https://console.groq.com/keys) -> click **Create API Key**.
2. Copy the key as `GROQ_API_KEY`. This provides ultra-fast `llama3-8b-8192` fallback routing.

---

## Step 3: Deploy to Render Free Web Services

1. Push your code repository (`promptpilot-backend`) to GitHub.
2. Log into [https://render.com](https://render.com) using GitHub and click **New + -> Web Service**.
3. Select your repository and configure:
   - **Environment**: `Docker`
   - **Plan**: `Free ($0/month)`
   - **Region**: `Oregon` or `Frankfurt`
4. Under **Environment Variables**, add the following key-value pairs:
   ```text
   PORT = 3000
   NODE_ENV = production
   DATABASE_URL = postgresql://postgres... (Pooler connection from Step 1)
   DIRECT_URL = postgresql://postgres... (Direct connection from Step 1)
   GEMINI_API_KEY = AIzaSy... (From Step 2)
   GROQ_API_KEY = gsk_... (From Step 2)
   WHATSAPP_VERIFY_TOKEN = promptpilot_secret_verify_token_2026
   JWT_SECRET = super_secret_production_jwt_key_98765
   RATE_LIMIT_MAX_REQUESTS = 15
   ```
5. Click **Create Web Service**. Wait ~3 minutes for Docker to build and start.
6. Once live, copy your service URL (e.g., `https://promptpilot-backend.onrender.com`). Verify it by opening `https://promptpilot-backend.onrender.com/api/v1/health` in your browser.

---

## Step 4: Configure Telegram Bot API Direct (100% Free, No Business Account Needed)

1. Open Telegram on your phone or desktop and search for **[@BotFather](https://t.me/BotFather)** (the official bot creator).
2. Send the command `/newbot` to `@BotFather`.
3. Choose a friendly name for your bot (e.g., `PromptPilot AI`) and a username ending in `bot` (e.g., `prompt_pilot_ai_bot`).
4. `@BotFather` will give you an **HTTP API Token** (e.g., `1234567890:AAH...`).
5. Go to your **Render Dashboard** -> select your `promptpilot-backend` service -> **Environment**.
6. Add/Update the following variable and save:
   ```text
   TELEGRAM_BOT_TOKEN = 1234567890:AAH... (your token from BotFather)
   ```

### Connect the Webhook to Render:
Once your Render deployment finishes rebuilding with `TELEGRAM_BOT_TOKEN`, open any web browser or terminal and visit this exact URL (replacing `<YOUR_TOKEN>` and `<YOUR_RENDER_URL>`):

```bash
https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<YOUR_RENDER_URL>.onrender.com/api/v1/webhooks/telegram
```
*(Example: `https://api.telegram.org/bot1234567890:AAH.../setWebhook?url=https://promptpilot-backend.onrender.com/api/v1/webhooks/telegram`)*

If successful, Telegram will respond immediately with:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

---

## Step 5: Prevent Free Container Sleep (Uptime Ping)

Render free instances sleep after 15 minutes of inactivity. When a user sends a Telegram message while asleep, there will be a ~35-second cold start delay. To ensure **instant zero-latency replies 24/7**:

1. Go to [https://cron-job.org](https://cron-job.org) (completely free service) and sign up.
2. Click **Create Cronjob**.
3. **Title**: `PromptPilot Keep-Alive`
4. **URL**: `https://promptpilot-backend.onrender.com/api/v1/health`
5. **Execution Schedule**: Every `14 minutes`.
6. Save and enable the job. Your backend container will now remain continuously warm and responsive at zero cost!

---

## Step 6: Test End-to-End on Telegram

1. Open your new bot inside Telegram and press **Start** or send `/start`.
2. You will receive an instant greeting from PromptPilot!
3. Type `/projects` or click inline buttons to see your active workspaces.
4. Send `Draft a clean Express & TypeScript backend structure for a fintech dashboard` to witness the **12-Point Universal Prompt Architect** construct, review, and score your prompt live!
5. Send any **Voice Note**, **Photo (screenshot)**, or **Document (PDF)** directly to the bot to automatically transcribe and embed it into your active workspace's pgvector memory!
