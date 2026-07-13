import { prisma } from '../database';

export class ActivityLogger {
  /**
   * Non-blocking asynchronous logging of user and admin activity.
   */
  static async log(telegramId: string, action: string, details?: string): Promise<void> {
    try {
      await prisma.activityLog.create({
        data: {
          telegramId: telegramId.toString(),
          action,
          details: details || null,
        },
      });
    } catch (error) {
      console.error(`[ActivityLogger] Failed to log activity (${action} for ${telegramId}):`, error);
    }
  }
}
