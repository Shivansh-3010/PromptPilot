import { Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { AgentRouter } from '../agents/router';

export class WebhookController {
  /**
   * GET /api/v1/webhooks/whatsapp
   * Verification handshake required when connecting Meta App Dashboard.
   */
  static verifyWebhook(req: Request, res: Response) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
        console.log('[WebhookController] WhatsApp Webhook verified successfully!');
        return res.status(200).send(challenge);
      }
      console.warn('[WebhookController] Webhook verification failed: Invalid verify token.');
      return res.status(403).json({ error: 'Verification token mismatch' });
    }

    return res.status(400).json({ error: 'Missing hub parameters' });
  }

  /**
   * POST /api/v1/webhooks/whatsapp
   * Receives real-time incoming messages, interactive button clicks, and media notifications from Meta.
   */
  static async handleIncomingEvents(req: Request, res: Response) {
    // Validate HMAC-SHA256 signature if appSecret is configured in production
    if (config.whatsapp.appSecret && config.whatsapp.appSecret !== 'test_app_secret' && config.server.env === 'production') {
      const signatureHeader = req.headers['x-hub-signature-256'] as string;
      if (
  	!signatureHeader ||
  	!WebhookController.validateSignature(
    	JSON.stringify(req.body),
    	signatureHeader
  	)
	) {
        console.warn('[WebhookController] Rejected webhook due to invalid HMAC signature.');
        return res.status(401).json({ error: 'Invalid HMAC signature' });
      }
    }

    // Always immediately respond with 200 OK so Meta doesn't retry/time out during long AI reasoning turns
    res.status(200).send('EVENT_RECEIVED');

    try {
      const body = req.body;
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value;
            if (value && value.messages && value.messages.length > 0) {
              const message = value.messages[0];
              const fromPhone = message.from;
              const messageId = message.id;
              const messageType = message.type;

              let content: { text?: string; buttonId?: string; listRowId?: string; mediaId?: string; mediaType?: string } = {};

              if (messageType === 'text' && message.text) {
                content.text = message.text.body;
              } else if (messageType === 'interactive' && message.interactive) {
                if (message.interactive.type === 'button_reply') {
                  content.buttonId = message.interactive.button_reply.id;
                } else if (message.interactive.type === 'list_reply') {
                  content.listRowId = message.interactive.list_reply.id;
                }
              } else if (messageType === 'audio' || messageType === 'voice') {
                content.mediaId = message[messageType]?.id;
                content.mediaType = 'AUDIO';
              } else if (messageType === 'image') {
                content.mediaId = message.image?.id;
                content.mediaType = 'IMAGE';
              } else if (messageType === 'document') {
                content.mediaId = message.document?.id;
                content.mediaType = 'PDF';
              }

              // Process asynchronously in background
              AgentRouter.handleIncomingMessage(fromPhone, messageId, messageType, content).catch((err) => {
                console.error(`[WebhookController] Unhandled error in AgentRouter for ${fromPhone}:`, err);
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('[WebhookController] Error parsing webhook payload:', error);
    }
  }

  /**
   * Validates Meta X-Hub-Signature-256 header using SHA-256 HMAC of app secret.
   */
  private static validateSignature(rawPayload: string, headerSignature: string): boolean {
    if (!headerSignature.startsWith('sha256=')) return false;
    const signature = headerSignature.split('sha256=')[1];
    const expected = crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawPayload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  }
}
