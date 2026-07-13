import { prisma } from '../database';
import { config } from '../config';
import { TelegramService } from './telegram';
import { ActivityLogger } from './activityLogger';

export class AccessControlService {
  /**
   * Checks whether a given Telegram ID is a configured Administrator (Bot Owner).
   */
  static isAdmin(telegramId: string): boolean {
    if (!telegramId) return false;
    return config.admin.telegramIds.includes(telegramId.toString());
  }

  /**
   * Verifies if a user has access to PromptPilot.
   * Handles onboarding for new users by creating PENDING requests and alerting admins.
   */
  static async checkAccess(
    telegramId: string,
    username?: string,
    firstName?: string
  ): Promise<{ allowed: boolean; status: string; reason?: string }> {
    const idStr = telegramId.toString();

    // Admins always have unrestricted access
    if (this.isAdmin(idStr)) {
      return { allowed: true, status: 'APPROVED' };
    }

    let approvedUser = await prisma.approvedUser.findUnique({
      where: { telegramId: idStr },
    });

    if (!approvedUser) {
      // New user discovery -> automatically submit access request
      approvedUser = await prisma.approvedUser.create({
        data: {
          telegramId: idStr,
          username: username || null,
          firstName: firstName || null,
          status: 'PENDING',
        },
      });

      await ActivityLogger.log(idStr, 'ACCESS_REQUESTED', `Requested access: @${username || 'none'} (${firstName || 'N/A'})`);

      // Alert all configured administrators via Telegram
      const adminNoticeText = `🆕 *New PromptPilot Access Request*\n\n*Name:* ${firstName || 'N/A'}\n*Username:* @${username || 'none'}\n*Telegram ID:* \`${idStr}\`\n\nApprove or Reject?`;
      for (const adminId of config.admin.telegramIds) {
        try {
          await TelegramService.sendButtonsMessage(
            adminId,
            adminNoticeText,
            [
              { id: `admin_approve_${idStr}`, title: '✅ Approve' },
              { id: `admin_reject_${idStr}`, title: '❌ Reject' },
            ],
            'Admin Action Required'
          );
        } catch (err) {
          console.error(`[AccessControl] Failed to send notification to admin ${adminId}:`, err);
        }
      }

      return {
        allowed: false,
        status: 'PENDING',
        reason: '🔒 PromptPilot is currently invite-only.\n\nYour access request has been submitted successfully.\n\nPlease wait for administrator approval.',
      };
    }

    // Keep profile info updated if it changed
    if ((username && username !== approvedUser.username) || (firstName && firstName !== approvedUser.firstName)) {
      await prisma.approvedUser.update({
        where: { telegramId: idStr },
        data: {
          username: username || approvedUser.username,
          firstName: firstName || approvedUser.firstName,
        },
      });
    }

    if (approvedUser.status === 'PENDING') {
      return {
        allowed: false,
        status: 'PENDING',
        reason: '🔒 PromptPilot is currently invite-only.\n\nYour access request has been submitted successfully.\n\nPlease wait for administrator approval.',
      };
    }

    if (approvedUser.status === 'REJECTED') {
      return {
        allowed: false,
        status: 'REJECTED',
        reason: 'Your PromptPilot access request has been declined.',
      };
    }

    if (approvedUser.status === 'BLOCKED') {
      return {
        allowed: false,
        status: 'BLOCKED',
        reason: '❌ Your access has been disabled.',
      };
    }

    // Status is APPROVED
    return { allowed: true, status: 'APPROVED' };
  }

  /**
   * Approves a user request (`PENDING` -> `APPROVED`).
   */
  static async approveUser(telegramId: string): Promise<boolean> {
    const idStr = telegramId.toString();
    const existing = await prisma.approvedUser.findUnique({ where: { telegramId: idStr } });

    if (!existing) {
      await prisma.approvedUser.create({
        data: {
          telegramId: idStr,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
    } else {
      await prisma.approvedUser.update({
        where: { telegramId: idStr },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
    }

    await ActivityLogger.log(idStr, 'USER_APPROVED', 'Approved by administrator');

    try {
      await TelegramService.sendTextMessage(
        idStr,
        '🎉 *Your PromptPilot access has been approved.*\n\nYou can now use PromptPilot.'
      );
    } catch (err) {
      console.warn(`[AccessControl] Could not send approval notice to ${idStr}:`, err);
    }

    return true;
  }

  /**
   * Rejects a user request (`PENDING` -> `REJECTED`).
   */
  static async rejectUser(telegramId: string): Promise<boolean> {
    const idStr = telegramId.toString();
    const existing = await prisma.approvedUser.findUnique({ where: { telegramId: idStr } });

    if (!existing) {
      await prisma.approvedUser.create({
        data: {
          telegramId: idStr,
          status: 'REJECTED',
        },
      });
    } else {
      await prisma.approvedUser.update({
        where: { telegramId: idStr },
        data: { status: 'REJECTED' },
      });
    }

    await ActivityLogger.log(idStr, 'USER_REJECTED', 'Rejected by administrator');

    try {
      await TelegramService.sendTextMessage(idStr, 'Your PromptPilot access request has been declined.');
    } catch (err) {
      console.warn(`[AccessControl] Could not send rejection notice to ${idStr}:`, err);
    }

    return true;
  }

  /**
   * Blocks a user (`status` -> `BLOCKED`).
   */
  static async blockUser(telegramId: string): Promise<boolean> {
    const idStr = telegramId.toString();
    const existing = await prisma.approvedUser.findUnique({ where: { telegramId: idStr } });

    if (!existing) {
      await prisma.approvedUser.create({
        data: {
          telegramId: idStr,
          status: 'BLOCKED',
        },
      });
    } else {
      await prisma.approvedUser.update({
        where: { telegramId: idStr },
        data: { status: 'BLOCKED' },
      });
    }

    await ActivityLogger.log(idStr, 'USER_BLOCKED', 'Blocked by administrator');

    try {
      await TelegramService.sendTextMessage(idStr, '❌ Your access has been disabled.');
    } catch (err) {
      console.warn(`[AccessControl] Could not send block notice to ${idStr}:`, err);
    }

    return true;
  }

  /**
   * Unblocks a user (`status` -> `APPROVED`).
   */
  static async unblockUser(telegramId: string): Promise<boolean> {
    const idStr = telegramId.toString();
    const existing = await prisma.approvedUser.findUnique({ where: { telegramId: idStr } });

    if (!existing) {
      await prisma.approvedUser.create({
        data: {
          telegramId: idStr,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
    } else {
      await prisma.approvedUser.update({
        where: { telegramId: idStr },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
    }

    await ActivityLogger.log(idStr, 'ADMIN_ACTION', 'Unblocked user to APPROVED status');

    try {
      await TelegramService.sendTextMessage(
        idStr,
        '🎉 *Your PromptPilot access has been restored.*\n\nYou can now use PromptPilot.'
      );
    } catch (err) {
      console.warn(`[AccessControl] Could not send unblock notice to ${idStr}:`, err);
    }

    return true;
  }
}
