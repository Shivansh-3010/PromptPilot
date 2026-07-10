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

## Step 4: Configure Meta WhatsApp Cloud API Direct

1. Go to [https://developers.facebook.com](https://developers.facebook.com) -> **My Apps -> Create App -> Other -> Business**.
2. Add the **WhatsApp** product to your app.
3. In the left menu, select **WhatsApp -> API Setup**.
   - Copy your **Phone number ID** (`WHATSAPP_PHONE_NUMBER_ID`).
   - Copy your **WhatsApp Business Account ID** (`WHATSAPP_BUSINESS_ACCOUNT_ID`).
   - Copy your **Temporary access token** (or generate a permanent System User token under Business Settings -> System Users -> Generate New Token with `whatsapp_business_messaging` permission).
4. Go back to your Render dashboard and add those two ID variables plus `WHATSAPP_ACCESS_TOKEN` to your Environment Variables, then save.

### Connect the Webhook:
1. In Meta App Dashboard under **WhatsApp -> Configuration**, click **Edit** next to Webhook.
2. **Callback URL**: Enter `https://promptpilot-backend.onrender.com/api/v1/webhooks/whatsapp`
3. **Verify Token**: Enter `promptpilot_secret_verify_token_2026`
4. Click **Verify and Save**. You should see a green checkmark indicating successful verification!
5. Click **Manage** next to Webhook fields and check the `messages` subscription box.

---

## Step 5: Prevent Free Container Sleep (Uptime Ping)

Render free instances sleep after 15 minutes of inactivity. When a user sends a WhatsApp message while asleep, there will be a ~35-second cold start delay. To ensure **instant zero-latency replies 24/7**:

1. Go to [https://cron-job.org](https://cron-job.org) (completely free service) and sign up.
2. Click **Create Cronjob**.
3. **Title**: `PromptPilot Keep-Alive`
4. **URL**: `https://promptpilot-backend.onrender.com/api/v1/health`
5. **Execution Schedule**: Every `14 minutes`.
6. Save and enable the job. Your backend container will now remain continuously warm and responsive at zero cost!

---

## Step 6: Test End-to-End on WhatsApp

1. Open WhatsApp on your phone and send `Hello` to your test/business phone number.
2. You will receive an instant greeting from PromptPilot!
3. Type `/projects` to see your active workspaces.
4. Type `Draft a clean Express & TypeScript backend structure for a fintech dashboard` to witness the **12-Point Universal Prompt Architect** construct, review, and score your prompt live!
