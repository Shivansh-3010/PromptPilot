import { prisma } from '../database';
import { AccessControlService } from './accessControl';

export class AuthorizationService {
  /**
   * Verifies if a user has access to a specific Project workspace.
   * Admin users bypass ownership validation safely.
   */
  static async verifyProjectAccess(
    userId: string,
    projectId: string,
    telegramId?: string
  ) {
    if (telegramId && AccessControlService.isAdmin(telegramId)) {
      return prisma.project.findUnique({
        where: { id: projectId },
      });
    }

    return prisma.project.findFirst({
      where: {
        id: projectId,
        userId: userId,
      },
    });
  }

  /**
   * Verifies if a user has access to a specific Conversation.
   * Admin users bypass ownership validation safely.
   */
  static async verifyConversationAccess(
    userId: string,
    conversationId: string,
    telegramId?: string
  ) {
    if (telegramId && AccessControlService.isAdmin(telegramId)) {
      return prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { project: true },
      });
    }

    return prisma.conversation.findFirst({
      where: {
        id: conversationId,
        project: {
          userId: userId,
        },
      },
      include: { project: true },
    });
  }

  /**
   * Verifies if a user has access to a specific Prompt.
   * Admin users bypass ownership validation safely.
   */
  static async verifyPromptAccess(
    userId: string,
    promptId: string,
    telegramId?: string
  ) {
    if (telegramId && AccessControlService.isAdmin(telegramId)) {
      return prisma.prompt.findUnique({
        where: { id: promptId },
        include: {
          message: {
            include: {
              conversation: {
                include: { project: true },
              },
            },
          },
        },
      });
    }

    return prisma.prompt.findFirst({
      where: {
        id: promptId,
        message: {
          conversation: {
            project: {
              userId: userId,
            },
          },
        },
      },
      include: {
        message: {
          include: {
            conversation: {
              include: { project: true },
            },
          },
        },
      },
    });
  }

  /**
   * Verifies if a user has access to a specific UploadedFile.
   * Admin users bypass ownership validation safely.
   */
  static async verifyFileAccess(
    userId: string,
    fileId: string,
    telegramId?: string
  ) {
    if (telegramId && AccessControlService.isAdmin(telegramId)) {
      return prisma.uploadedFile.findUnique({
        where: { id: fileId },
        include: { project: true },
      });
    }

    return prisma.uploadedFile.findFirst({
      where: {
        id: fileId,
        project: {
          userId: userId,
        },
      },
      include: { project: true },
    });
  }
}
