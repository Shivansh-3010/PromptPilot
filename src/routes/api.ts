import { Router } from 'express';
import { WebhookController } from '../controllers/webhookController';
import { ProjectController } from '../controllers/projectController';
import { authenticateJwt } from '../middleware/auth';

const router = Router();

// ==========================================
// 1. Telegram Bot API Webhook
// ==========================================
router.post('/webhooks/telegram', WebhookController.handleTelegramEvents);

// ==========================================
// 2. WhatsApp Cloud API Webhooks (Optional/Legacy)
// ==========================================
router.get('/webhooks/whatsapp', WebhookController.verifyWebhook);
router.post('/webhooks/whatsapp', WebhookController.handleIncomingEvents);

// ==========================================
// 3. Project Management & Prompt APIs (REST)
// ==========================================
router.get('/projects', authenticateJwt, ProjectController.listProjects);
router.post('/projects', authenticateJwt, ProjectController.createProject);
router.post('/projects/:id/memory/search', authenticateJwt, ProjectController.searchMemory);
router.post('/prompts/generate', authenticateJwt, ProjectController.generatePromptViaApi);

// Health check and ping endpoint (used by Cron-job.org free tier to prevent container sleep)
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'PromptPilot Zero-Cost Backend',
    freeStack: {
      db: 'Supabase Postgres + pgvector',
      messaging: 'Telegram Bot API Direct',
      ai: 'Google Gemini 1.5 Pro/Flash + Groq Llama 3',
    },
  });
});

export default router;
