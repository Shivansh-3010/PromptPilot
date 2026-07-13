import { prisma } from '../database';
import { TelegramService, TelegramInteractiveSection, TelegramInteractiveRow } from './telegram';
import { AccessControlService } from './accessControl';
import { ActivityLogger } from './activityLogger';

export class AdminService {
  /**
   * Main router for admin slash commands (`/admin ...`) and inline button actions (`admin_...`).
   * Verifies admin status before executing any operation.
   */
  static async handleAdminTurn(
    chatId: string,
    rawInput: string,
    actionId?: string
  ): Promise<boolean> {
    if (!AccessControlService.isAdmin(chatId)) {
      await TelegramService.sendTextMessage(chatId, '❌ Unauthorized.');
      return true;
    }

    // Handle interactive button callbacks (`admin_*`)
    if (actionId) {
      if (actionId === 'admin_menu_home') {
        await this.sendAdminPanel(chatId);
        return true;
      }
      if (actionId === 'admin_menu_stats') {
        await this.sendStatsDashboard(chatId);
        return true;
      }
      if (actionId === 'admin_menu_pending') {
        await this.listPendingUsers(chatId);
        return true;
      }
      if (actionId === 'admin_menu_users') {
        await this.listApprovedUsers(chatId);
        return true;
      }
      if (actionId === 'admin_menu_blocked') {
        await this.listBlockedUsers(chatId);
        return true;
      }
      if (actionId === 'admin_menu_activity') {
        await this.showActivityTimeline(chatId);
        return true;
      }
      if (actionId === 'admin_menu_searches') {
        await this.showSearchMonitoring(chatId);
        return true;
      }
      if (actionId === 'admin_menu_conversations') {
        await this.showConversationMonitoring(chatId);
        return true;
      }
      if (actionId === 'admin_menu_files') {
        await this.showFileMonitoring(chatId);
        return true;
      }
      if (actionId === 'admin_menu_projects') {
        await this.showProjectMonitoring(chatId);
        return true;
      }
      if (actionId.startsWith('admin_approve_')) {
        const targetId = actionId.replace('admin_approve_', '');
        await AccessControlService.approveUser(targetId);
        await TelegramService.sendTextMessage(chatId, `✅ Approved user \`${targetId}\`.`);
        return true;
      }
      if (actionId.startsWith('admin_reject_')) {
        const targetId = actionId.replace('admin_reject_', '');
        await AccessControlService.rejectUser(targetId);
        await TelegramService.sendTextMessage(chatId, `❌ Rejected user \`${targetId}\`.`);
        return true;
      }
      if (actionId.startsWith('admin_block_')) {
        const targetId = actionId.replace('admin_block_', '');
        await AccessControlService.blockUser(targetId);
        await TelegramService.sendTextMessage(chatId, `🚫 Blocked user \`${targetId}\`.`);
        return true;
      }
      if (actionId.startsWith('admin_unblock_')) {
        const targetId = actionId.replace('admin_unblock_', '');
        await AccessControlService.unblockUser(targetId);
        await TelegramService.sendTextMessage(chatId, `🎉 Unblocked user \`${targetId}\`.`);
        return true;
      }
      if (actionId.startsWith('admin_user_projects_')) {
        const targetId = actionId.replace('admin_user_projects_', '');
        await this.showProjectMonitoring(chatId, targetId);
        return true;
      }
      if (actionId.startsWith('admin_user_convos_')) {
        const targetId = actionId.replace('admin_user_convos_', '');
        await this.showConversationMonitoring(chatId, targetId);
        return true;
      }
      if (actionId.startsWith('admin_user_searches_')) {
        const targetId = actionId.replace('admin_user_searches_', '');
        await this.showSearchMonitoring(chatId, targetId);
        return true;
      }
      if (actionId.startsWith('admin_user_files_')) {
        const targetId = actionId.replace('admin_user_files_', '');
        await this.showFileMonitoring(chatId, targetId);
        return true;
      }
      if (actionId.startsWith('admin_user_inspect_')) {
        const targetId = actionId.replace('admin_user_inspect_', '');
        await this.inspectUser(chatId, targetId);
        return true;
      }
    }

    // Handle text commands (`/admin ...`)
    const lower = rawInput.trim().toLowerCase();
    const parts = rawInput.trim().split(/\s+/);

    if (lower === '/admin') {
      await this.sendAdminPanel(chatId);
      return true;
    }
    if (lower === '/admin stats') {
      await this.sendStatsDashboard(chatId);
      return true;
    }
    if (lower === '/admin pending') {
      await this.listPendingUsers(chatId);
      return true;
    }
    if (lower === '/admin approved') {
      await this.listApprovedUsers(chatId);
      return true;
    }
    if (lower === '/admin rejected') {
      await this.listRejectedUsers(chatId);
      return true;
    }
    if (lower === '/admin blocked') {
      await this.listBlockedUsers(chatId);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'approve' && parts[2]) {
      await AccessControlService.approveUser(parts[2]);
      await TelegramService.sendTextMessage(chatId, `✅ Approved user \`${parts[2]}\`.`);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'reject' && parts[2]) {
      await AccessControlService.rejectUser(parts[2]);
      await TelegramService.sendTextMessage(chatId, `❌ Rejected user \`${parts[2]}\`.`);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'block' && parts[2]) {
      await AccessControlService.blockUser(parts[2]);
      await TelegramService.sendTextMessage(chatId, `🚫 Blocked user \`${parts[2]}\`.`);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'unblock' && parts[2]) {
      await AccessControlService.unblockUser(parts[2]);
      await TelegramService.sendTextMessage(chatId, `🎉 Unblocked user \`${parts[2]}\`.`);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'user' && parts[2]) {
      await this.inspectUser(chatId, parts[2]);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'searches') {
      await this.showSearchMonitoring(chatId, parts[2]);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'conversations') {
      await this.showConversationMonitoring(chatId, parts[2]);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && (parts[1]?.toLowerCase() === 'projects' || parts[1]?.toLowerCase() === 'project')) {
      await this.showProjectMonitoring(chatId, parts[2]);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'files') {
      await this.showFileMonitoring(chatId, parts[2]);
      return true;
    }
    if (parts[0].toLowerCase() === '/admin' && parts[1]?.toLowerCase() === 'activity') {
      await this.showActivityTimeline(chatId, parts[2]);
      return true;
    }

    return false;
  }

  /**
   * Renders the 👑 PromptPilot Admin Panel interactive command hub.
   */
  private static async sendAdminPanel(chatId: string): Promise<void> {
    const buttons: TelegramInteractiveRow[] = [
      { id: 'admin_menu_users', title: '👥 Users' },
      { id: 'admin_menu_stats', title: '📊 Stats' },
      { id: 'admin_menu_activity', title: '📋 Activity' },
      { id: 'admin_menu_searches', title: '📝 Searches' },
      { id: 'admin_menu_conversations', title: '💬 Conversations' },
      { id: 'admin_menu_files', title: '📁 Files' },
      { id: 'admin_menu_projects', title: '🏢 Projects' },
      { id: 'admin_menu_pending', title: '⏳ Pending Requests' },
      { id: 'admin_menu_blocked', title: '🚫 Blocked Users' },
    ];

    await TelegramService.sendButtonsMessage(
      chatId,
      'Welcome to the Super-Admin Control Center.\nSelect any module below to inspect real-time platform metrics and manage users:',
      buttons,
      '👑 PromptPilot Admin Panel',
      'Administrator Access Granted'
    );
  }

  /**
   * /admin stats: Aggregates system metrics across existing telemetry and new access tables.
   */
  private static async sendStatsDashboard(chatId: string): Promise<void> {
    const [
      totalUsers,
      approvedUsers,
      pendingUsers,
      blockedUsers,
      totalProjects,
      totalFiles,
      totalPrompts,
      recentActivity,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.approvedUser.count({ where: { status: 'APPROVED' } }),
      prisma.approvedUser.count({ where: { status: 'PENDING' } }),
      prisma.approvedUser.count({ where: { status: 'BLOCKED' } }),
      prisma.project.count({ where: { isArchived: false } }),
      prisma.uploadedFile.count(),
      prisma.prompt.count(),
      prisma.activityLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    ]);

    const body = `📊 *PromptPilot Admin Statistics Dashboard*\n
*Users & Onboarding:*
- **Total Users:** \`${totalUsers}\`
- **Approved Users:** \`${approvedUsers}\`
- **Pending Users:** \`${pendingUsers}\`
- **Blocked Users:** \`${blockedUsers}\`

*AI & Knowledge Telemetry:*
- **Total Projects:** \`${totalProjects}\`
- **Total Uploaded Files:** \`${totalFiles}\`
- **Total Prompts Generated:** \`${totalPrompts}\`
- **Activity in Last 24 Hours:** \`${recentActivity}\` events`;

    await TelegramService.sendButtonsMessage(
      chatId,
      body,
      [
        { id: 'admin_menu_pending', title: '⏳ View Pending' },
        { id: 'admin_menu_home', title: '👑 Admin Panel' },
      ],
      'System Metrics & Health'
    );
  }

  /**
   * Lists pending user access requests.
   */
  private static async listPendingUsers(chatId: string): Promise<void> {
    const pending = await prisma.approvedUser.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (pending.length === 0) {
      await TelegramService.sendTextMessage(chatId, '⏳ *No pending access requests right now.*');
      return;
    }

    for (const u of pending) {
      const msg = `⏳ *Pending Access Request*\n*Name:* ${u.firstName || 'N/A'}\n*Username:* @${u.username || 'none'}\n*Telegram ID:* \`${u.telegramId}\`\n*Requested:* ${u.createdAt.toLocaleString()}`;
      await TelegramService.sendButtonsMessage(
        chatId,
        msg,
        [
          { id: `admin_approve_${u.telegramId}`, title: '✅ Approve' },
          { id: `admin_reject_${u.telegramId}`, title: '❌ Reject' },
          { id: `admin_block_${u.telegramId}`, title: '🚫 Block' },
        ],
        'Pending Onboarding'
      );
    }
  }

  /**
   * Lists top approved users.
   */
  private static async listApprovedUsers(chatId: string): Promise<void> {
    const approved = await prisma.approvedUser.findMany({
      where: { status: 'APPROVED' },
      orderBy: { approvedAt: 'desc' },
      take: 10,
    });

    if (approved.length === 0) {
      await TelegramService.sendTextMessage(chatId, '👥 *No approved users found.*');
      return;
    }

    const rows: TelegramInteractiveRow[] = approved.map((u) => ({
      id: `admin_user_inspect_${u.telegramId}`,
      title: `${u.firstName || 'User'} (@${u.username || u.telegramId.slice(-4)})`.slice(0, 30),
      description: `ID: ${u.telegramId}`,
    }));

    await TelegramService.sendButtonsMessage(
      chatId,
      `👥 *Approved Users Directory (${approved.length} shown)*\nClick a user below to inspect their full workspace and activity profile:`,
      rows,
      'Users Directory'
    );
  }

  /**
   * Lists rejected users.
   */
  private static async listRejectedUsers(chatId: string): Promise<void> {
    const rejected = await prisma.approvedUser.findMany({
      where: { status: 'REJECTED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (rejected.length === 0) {
      await TelegramService.sendTextMessage(chatId, '📋 *No rejected requests found.*');
      return;
    }

    let report = `❌ *Rejected Access Requests:*\n\n`;
    for (const u of rejected) {
      report += `- \`${u.telegramId}\` (@${u.username || 'none'} - ${u.firstName || 'N/A'})\n`;
    }
    await TelegramService.sendTextMessage(chatId, report);
  }

  /**
   * Lists blocked users.
   */
  private static async listBlockedUsers(chatId: string): Promise<void> {
    const blocked = await prisma.approvedUser.findMany({
      where: { status: 'BLOCKED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (blocked.length === 0) {
      await TelegramService.sendTextMessage(chatId, '🚫 *No blocked users right now.*');
      return;
    }

    for (const u of blocked) {
      const msg = `🚫 *Blocked User*\n*Name:* ${u.firstName || 'N/A'}\n*Username:* @${u.username || 'none'}\n*Telegram ID:* \`${u.telegramId}\``;
      await TelegramService.sendButtonsMessage(
        chatId,
        msg,
        [{ id: `admin_unblock_${u.telegramId}`, title: '🎉 Unblock User' }],
        'Blocked Profile'
      );
    }
  }

  /**
   * /admin user <telegramId>: Detailed user profile inspection.
   */
  private static async inspectUser(chatId: string, telegramId: string): Promise<void> {
    const approvedUser = await prisma.approvedUser.findUnique({ where: { telegramId } });
    const user = await prisma.user.findUnique({ where: { phoneNumber: telegramId } });

    const [promptsCount, searchesCount, projectsCount, filesCount, lastActivity] = await Promise.all([
      prisma.prompt.count({ where: { message: { conversation: { project: { user: { phoneNumber: telegramId } } } } } }),
      prisma.activityLog.count({ where: { telegramId, action: 'SEARCH_PERFORMED' } }),
      prisma.project.count({ where: { user: { phoneNumber: telegramId }, isArchived: false } }),
      prisma.uploadedFile.count({ where: { project: { user: { phoneNumber: telegramId } } } }),
      prisma.activityLog.findFirst({ where: { telegramId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const status = AccessControlService.isAdmin(telegramId)
      ? 'ADMIN'
      : approvedUser?.status || 'UNKNOWN';

    const body = `🔍 *User Inspection: \`${telegramId}\`*\n
- **Username:** @${approvedUser?.username || 'none'}
- **First Name:** ${approvedUser?.firstName || user?.name || 'N/A'}
- **Access Status:** *${status}*
- **Total Prompts Generated:** \`${promptsCount}\`
- **Total Searches Performed:** \`${searchesCount}\`
- **Total Active Workspaces:** \`${projectsCount}\`
- **Total Files Uploaded:** \`${filesCount}\`
- **Last Active:** ${lastActivity ? lastActivity.createdAt.toLocaleString() : user ? user.updatedAt.toLocaleString() : 'Never'}`;

    await TelegramService.sendButtonsMessage(
      chatId,
      body,
      [
        { id: `admin_user_projects_${telegramId}`, title: '🏢 View Projects' },
        { id: `admin_user_convos_${telegramId}`, title: '💬 View Conversations' },
        { id: `admin_user_searches_${telegramId}`, title: '📝 View Searches' },
        { id: `admin_user_files_${telegramId}`, title: '📁 View Files' },
        status === 'BLOCKED'
          ? { id: `admin_unblock_${telegramId}`, title: '🎉 Unblock User' }
          : { id: `admin_block_${telegramId}`, title: '🚫 Block User' },
        { id: 'admin_menu_home', title: '👑 Admin Panel' },
      ],
      'User Inspection & Telemetry'
    );
  }

  /**
   * Search history monitoring across the platform or specific user.
   */
  private static async showSearchMonitoring(chatId: string, targetId?: string): Promise<void> {
    const where = targetId ? { telegramId: targetId, action: 'SEARCH_PERFORMED' } : { action: 'SEARCH_PERFORMED' };
    const searches = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (searches.length === 0) {
      await TelegramService.sendTextMessage(chatId, `📝 No recent search history logged ${targetId ? `for \`${targetId}\`` : 'across platform'}.`);
      return;
    }

    let report = `📝 *Recent Search Operations ${targetId ? `for \`${targetId}\`` : ''}:*\n\n`;
    searches.forEach((s) => {
      report += `- \`${s.createdAt.toLocaleTimeString()}\` | ID: \`${s.telegramId}\` -> "${s.details || 'Search query'}"\n`;
    });

    await TelegramService.sendTextMessage(chatId, report);
  }

  /**
   * Conversation monitoring across the platform or specific user.
   */
  private static async showConversationMonitoring(chatId: string, targetId?: string): Promise<void> {
    const where = targetId ? { project: { user: { phoneNumber: targetId } } } : {};
    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        project: { include: { user: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    if (conversations.length === 0) {
      await TelegramService.sendTextMessage(chatId, `💬 No active conversations found ${targetId ? `for \`${targetId}\`` : ''}.`);
      return;
    }

    let report = `💬 *Conversation Monitoring ${targetId ? `for \`${targetId}\`` : ''}:*\n\n`;
    conversations.forEach((c) => {
      const lastMsg = c.messages[0]?.text || 'No messages yet';
      report += `*Project:* "${c.project.name}" (User: \`${c.project.user.phoneNumber}\`)\n*Last Message:* "${lastMsg.slice(0, 100)}..."\n*Updated:* ${c.updatedAt.toLocaleString()}\n---\n`;
    });

    await TelegramService.sendTextMessage(chatId, report);
  }

  /**
   * Project workspace monitoring across the platform or specific user/project.
   */
  private static async showProjectMonitoring(chatId: string, targetIdOrProjectId?: string): Promise<void> {
    let where: any = { isArchived: false };
    if (targetIdOrProjectId) {
      // Check if it's a UUID (projectId) or numeric/string Telegram ID
      if (targetIdOrProjectId.includes('-') && targetIdOrProjectId.length > 30) {
        where = { id: targetIdOrProjectId };
      } else {
        where = { user: { phoneNumber: targetIdOrProjectId }, isArchived: false };
      }
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        user: true,
        _count: { select: { conversations: true, projectMemory: true, uploadedFiles: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });

    if (projects.length === 0) {
      await TelegramService.sendTextMessage(chatId, `🏢 No workspaces found matching query.`);
      return;
    }

    let report = `🏢 *Project Workspaces Directory:*\n\n`;
    projects.forEach((p) => {
      report += `*${p.name}* ${p.isActive ? '(Active ✅)' : ''}\n*Owner ID:* \`${p.user.phoneNumber}\`\n*Telemetry:* ${p._count.conversations} chats | ${p._count.projectMemory} vectors | ${p._count.uploadedFiles} files\n*Updated:* ${p.updatedAt.toLocaleString()}\n---\n`;
    });

    await TelegramService.sendTextMessage(chatId, report);
  }

  /**
   * File upload monitoring across the platform or specific user.
   */
  private static async showFileMonitoring(chatId: string, targetId?: string): Promise<void> {
    const where = targetId ? { project: { user: { phoneNumber: targetId } } } : {};
    const files = await prisma.uploadedFile.findMany({
      where,
      include: { project: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    if (files.length === 0) {
      await TelegramService.sendTextMessage(chatId, `📁 No uploaded files found ${targetId ? `for \`${targetId}\`` : ''}.`);
      return;
    }

    let report = `📁 *Ingested Files & Documents:*\n\n`;
    files.forEach((f) => {
      report += `*File:* \`${f.fileName}\` (${(f.fileSize / 1024).toFixed(1)} KB - \`${f.mimeType}\`)\n*Workspace:* "${f.project.name}" (Owner: \`${f.project.user.phoneNumber}\`)\n*Uploaded:* ${f.createdAt.toLocaleString()}\n---\n`;
    });

    await TelegramService.sendTextMessage(chatId, report);
  }

  /**
   * Activity log timeline view.
   */
  private static async showActivityTimeline(chatId: string, targetId?: string): Promise<void> {
    const where = targetId ? { telegramId: targetId } : {};
    const logs = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    if (logs.length === 0) {
      await TelegramService.sendTextMessage(chatId, `📋 No recent activity timeline events found.`);
      return;
    }

    let report = `📋 *Platform Activity Timeline ${targetId ? `for \`${targetId}\`` : ''}:*\n\n`;
    logs.forEach((l) => {
      report += `\`${l.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\` | \`${l.telegramId}\` -> *${l.action}*\n${l.details ? `_${l.details}_\n` : ''}\n`;
    });

    await TelegramService.sendTextMessage(chatId, report);
  }
}
