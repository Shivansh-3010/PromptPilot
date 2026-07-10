import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'promptpilot_secret_verify_token_2026',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    graphApiVersion: 'v20.0',
  },
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    // Use free models
    routingModel: 'gemini-1.5-flash',
    generationModel: 'gemini-1.5-pro',
    scoringModel: 'gemini-1.5-flash',
    fallbackModel: 'llama3-8b-8192',
    embeddingModel: 'text-embedding-004',
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || 'default_jwt_secret',
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '15', 10),
  },
};
