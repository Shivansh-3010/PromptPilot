import express, { Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import apiRoutes from './routes/api';

const app = express();

app.set('trust proxy', 1);

// Capture raw body for exact HMAC-SHA256 Meta webhook validation
app.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Configure token bucket rate limiter to stay within free tier capacity limits
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.security.rateLimitMaxRequests || 15,
  message: { error: 'Rate limit exceeded. Please wait a minute before making more requests to protect free-tier API quotas.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/v1', apiLimiter, apiRoutes);

// Root sitemap
app.get('/', (req: Request, res: Response) => {
  res.send(`
    <html>
      <head>
        <title>PromptPilot Zero-Cost AI Platform</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; background: #0f172a; color: #f8fafc; }
          h1 { color: #38bdf8; }
          .card { background: #1e293b; padding: 1.5rem; border-radius: 8px; border: 1px solid #334155; margin-top: 1.5rem; }
          code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; color: #a5b4fc; }
        </style>
      </head>
      <body>
        <h1>🚀 PromptPilot API Gateway</h1>
        <p>Telegram-first AI Intent Translator & Universal Prompt Architect running entirely on <strong>Zero-Cost Free-Tier Cloud Infrastructure</strong>.</p>
        <div class="card">
          <h3>Active Endpoints:</h3>
          <ul>
            <li><code>GET /api/v1/health</code> : Service status & uptime monitoring</li>
            <li><code>POST /api/v1/webhooks/telegram</code> : Telegram Bot API Direct Webhook</li>
            <li><code>POST /api/v1/prompts/generate</code> : REST API prompt generation service</li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

const PORT = config.server.port || 3000;

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 PromptPilot Zero-Cost Server started on port ${PORT}`);
  console.log(`🌍 Environment: ${config.server.env}`);
  console.log(`💾 Vector Engine: Supabase Postgres + pgvector`);
  console.log(`💬 Telegram Mode: Telegram Bot API Direct`);
  console.log(`🤖 AI Engine: Google Gemini 1.5 + Groq Llama 3`);
  console.log(`====================================================`);
});

export default app;
