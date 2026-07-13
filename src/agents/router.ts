import { prisma, DatabaseService } from '../database';
import { TelegramService, TelegramInteractiveSection } from '../services/telegram';
import { MemoryService } from '../services/memory';
import { GeminiService } from '../services/gemini';
import { IntentAgent } from './intentAgent';
import { GenerationAgent } from './generationAgent';
import { ScoringAgent } from './scoringAgent';
import { AccessControlService } from '../services/accessControl';
import { AuthorizationService } from '../services/authorizationService';
import { AdminService } from '../services/adminService';
import { ActivityLogger } from '../services/activityLogger';
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

export class AgentRouter {
  /**
   * Main entrypoint triggered by incoming Telegram messages or inline button callbacks.
   */
  static async handleIncomingMessage(
    chatId: string,
    messageId: string,
    messageType: string,
    content: {
      text?: string;
      buttonId?: string;
      listRowId?: string;
      mediaId?: string;
      mediaType?: string;
      fileName?: string;
      telegramMimeType?: string;
      username?: string;
      firstName?: string;
    }
  ): Promise<void> {
    console.log(`[AgentRouter] Processing turn from Telegram chat ${chatId}: Type=${messageType}`);

    // Early Interception 1: Check if admin turn (`/admin...` or `admin_...` action)
    const actionId = content.buttonId || content.listRowId;
    const rawInputText = content.text || '';
    if (
      (rawInputText && rawInputText.trim().toLowerCase().startsWith('/admin')) ||
      (actionId && actionId.startsWith('admin_'))
    ) {
      const handled = await AdminService.handleAdminTurn(chatId, rawInputText, actionId);
      if (handled) return;
    }

    // Early Interception 2: Strict Access Control check before any user onboarding / AI processing
    const access = await AccessControlService.checkAccess(chatId, content.username, content.firstName);
    if (!access.allowed) {
      if (access.reason) {
        await TelegramService.sendTextMessage(chatId, access.reason);
      }
      return;
    }

    // Step 1: Ensure User exists in Postgres & retrieve active project (chatId is stored safely in User.phoneNumber field)
    const user = await DatabaseService.getOrCreateUser(chatId, content.firstName || `Telegram User ${chatId.slice(-4)}`);
    const activeProject = await DatabaseService.getActiveProject(user.id);

    if (!activeProject) {
      await TelegramService.sendTextMessage(chatId, '❌ Error: No active project found. Please type `/new` to create one.');
      return;
    }

    // Step 2: Check current conversational state session
    let session = await prisma.aiSession.findFirst({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
    });

    // Handle interactive button / list item clicks (`callback_data`)
    if (content.buttonId || content.listRowId) {
      const actionId = content.buttonId || content.listRowId || '';
      await this.handleInteractiveAction(chatId, user.id, activeProject.id, actionId, session);
      return;
    }

    // Handle pending state inputs (e.g. user typing new project name)
    if (session && session.currentState === 'WAITING_FOR_PROJECT_NAME' && content.text) {
      await this.handleProjectCreation(chatId, user.id, content.text);
      return;
    }

    if (session && session.currentState === 'WAITING_FOR_REFINEMENT' && content.text) {
      await this.handleRefinementRequest(chatId, user.id, activeProject.id, content.text, session);
      return;
    }

    // Handle Media (Voice notes / PDFs / Images / Documents)
    if (content.mediaId && content.mediaType) {
      await this.handleMediaIngestion(
        chatId,
        activeProject.id,
        activeProject.name,
        content.mediaId,
        content.mediaType,
        content.fileName,
        content.telegramMimeType
      );
      return;
    }

    // Step 3: Standard Text Processing via Intent Agent
    const rawText = content.text || '';
    if (!rawText.trim()) return;

    // Handle explicit Telegram slash commands immediately
    const lowerText = rawText.toLowerCase().trim();
    if (lowerText === '/start' || lowerText === '/help') {
      await this.sendHelpMenu(chatId);
      return;
    }
    if (lowerText === '/projects' || lowerText === '/switch') {
      await this.sendProjectSelectionMenu(chatId, user.id);
      return;
    }
    if (lowerText.startsWith('/new')) {
      const newProjName = rawText.replace(/^\/new/i, '').trim();
      if (newProjName.length > 2) {
        await this.handleProjectCreation(chatId, user.id, newProjName);
      } else {
        await this.promptForProjectName(chatId, user.id);
      }
      return;
    }
    if (lowerText.startsWith('/search')) {
      await this.handleSearchHistory(chatId, activeProject.id, rawText);
      return;
    }

    await TelegramService.sendTextMessage(chatId, `🤖 *PromptPilot Orchestrator*\nAnalyzing intent & querying vector memory for workspace: *${activeProject.name}*...`);

    const intentAnalysis = await IntentAgent.analyze(rawText);
    console.log('[AgentRouter] Intent Analysis:', intentAnalysis);

    switch (intentAnalysis.intent) {
      case 'LIST_PROJECTS':
      case 'SWITCH_PROJECT':
        await this.sendProjectSelectionMenu(chatId, user.id);
        break;

      case 'CREATE_PROJECT':
        if (intentAnalysis.extractedGoal && intentAnalysis.extractedGoal.length > 3 && !intentAnalysis.extractedGoal.toLowerCase().includes('/new')) {
          await this.handleProjectCreation(chatId, user.id, intentAnalysis.extractedGoal);
        } else {
          await this.promptForProjectName(chatId, user.id);
        }
        break;

      case 'SEARCH_HISTORY':
        await this.handleSearchHistory(chatId, activeProject.id, rawText);
        break;

      case 'HELP_MENU':
        await this.sendHelpMenu(chatId);
        break;

      case 'REFINE_PROMPT':
        await this.handleRefinementRequest(chatId, user.id, activeProject.id, rawText, session);
        break;

      case 'GENERATE_PROMPT':
      default:
        await this.executePromptPipeline(chatId, user.id, activeProject.id, activeProject.name, activeProject.description || undefined, rawText, intentAnalysis.category, intentAnalysis.complexity);
        break;
    }
  }

  /**
   * Pipeline that builds, reviews, and scores a prompt using 12-point framework + pgvector context.
   */
  private static async executePromptPipeline(
    chatId: string,
    userId: string,
    projectId: string,
    projectName: string,
    projectDesc: string | undefined,
    rawIdea: string,
    category: string,
    complexity: string
  ): Promise<void> {
    // 1. Retrieve semantic memories
    const contextChunks = await MemoryService.retrieveRelevantContext(projectId, rawIdea, 4);

    // 2. Generate initial draft using GenerationAgent
    const draft = await GenerationAgent.generatePrompt({
      rawIdea,
      category,
      complexity,
      projectName,
      projectDescription: projectDesc,
      semanticContextChunks: contextChunks,
    });

    // 3. QA Review & Self-Correction via ScoringAgent
    const evaluation = await ScoringAgent.evaluateAndOptimize(draft, {
      rawIdea,
      category,
      complexity,
      projectName,
      projectDescription: projectDesc,
      semanticContextChunks: contextChunks,
    });

    const finalPromptText = evaluation.improvedDraft || draft;

    // 4. Save to Database
    let conversation = await prisma.conversation.findFirst({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { projectId, title: `Chat: ${rawIdea.slice(0, 30)}...` },
      });
    }

    const messageRecord = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'USER',
        text: rawIdea,
      },
    });

    const promptRecord = await prisma.prompt.create({
      data: {
        messageId: messageRecord.id,
        category,
        rawIdea,
        optimizedText: finalPromptText,
        targetModel: 'Gemini 2.5 Flash (Zero-Cost)',
        qualityScore: evaluation.overallScore,
        critique: evaluation.critique,
      },
    });

    // Log prompt generation activity
    await ActivityLogger.log(chatId, 'PROMPT_GENERATED', `Score: ${evaluation.overallScore}/100 - ${rawIdea.slice(0, 80)}`);

    // Update active session to point to this prompt for easy refinement
    await prisma.aiSession.create({
      data: {
        userId,
        currentState: 'IDLE',
        contextData: { lastPromptId: promptRecord.id, lastPromptText: finalPromptText },
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      },
    });

    // 5. Send results to user on Telegram
    const header = `✨ *Prompt Architect Output* | Quality Score: *${evaluation.overallScore}/100*`;
    const body = `${header}\n\n*Category:* ${category} | *Workspace:* ${projectName}\n*QA Review:* ${evaluation.critique}\n\nHere is your production-ready prompt:\n\`\`\`\n${finalPromptText}\n\`\`\``;

    // Send formatted text
    await TelegramService.sendTextMessage(chatId, body);

    // Send quick action inline buttons
    await TelegramService.sendButtonsMessage(
      chatId,
      'What would you like to do next with this prompt?',
      [
        { id: `refine_${promptRecord.id}`, title: '🛠️ Refine Prompt' },
        { id: `copy_${promptRecord.id}`, title: '📋 Copy Raw Text' },
        { id: 'btn_new_prompt', title: '🚀 New Prompt' },
      ],
      'Quick Actions'
    );
  }

  /**
   * Handles inline button callbacks (`callback_data`) from Telegram messages.
   */
  private static async handleInteractiveAction(
    chatId: string,
    userId: string,
    activeProjectId: string,
    actionId: string,
    session: any
  ): Promise<void> {
    if (actionId.startsWith('switch_proj_')) {
      const targetProjectId = actionId.replace('switch_proj_', '');
      const project = await AuthorizationService.verifyProjectAccess(userId, targetProjectId, chatId);
      if (!project) {
        await TelegramService.sendTextMessage(chatId, '❌ Forbidden: You do not have access to this workspace.');
        return;
      }
      await prisma.project.updateMany({ where: { userId }, data: { isActive: false } });
      const updated = await prisma.project.update({ where: { id: targetProjectId }, data: { isActive: true } });
      await ActivityLogger.log(chatId, 'PROJECT_SWITCHED', `Switched to workspace: ${updated.name}`);
      await TelegramService.sendTextMessage(chatId, `🚀 Workspace switched successfully to: *${updated.name}*.\nAll vector memory context loaded.`);
      return;
    }

    if (actionId === 'btn_create_project') {
      await this.promptForProjectName(chatId, userId);
      return;
    }

    if (actionId.startsWith('refine_')) {
      const promptId = actionId.replace('refine_', '');
      const promptRecord = await AuthorizationService.verifyPromptAccess(userId, promptId, chatId);
      if (!promptRecord) {
        await TelegramService.sendTextMessage(chatId, '❌ Forbidden: Prompt ownership verification failed.');
        return;
      }
      await prisma.aiSession.create({
        data: {
          userId,
          currentState: 'WAITING_FOR_REFINEMENT',
          contextData: { lastPromptId: promptId, lastPromptText: promptRecord.optimizedText },
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
      await ActivityLogger.log(chatId, 'INTERACTIVE_ACTION', `Initiated refinement for prompt ${promptId}`);
      await TelegramService.sendTextMessage(chatId, '🛠️ *Prompt Refinement Mode*\nWhat adjustments would you like? (e.g., "Make it more professional", "Add error handling constraints", "Shorten it to 3 bullet points")');
      return;
    }

    if (actionId.startsWith('copy_')) {
      const promptId = actionId.replace('copy_', '');
      const promptRecord = await AuthorizationService.verifyPromptAccess(userId, promptId, chatId);
      if (!promptRecord) {
        await TelegramService.sendTextMessage(chatId, '❌ Forbidden: Prompt ownership verification failed.');
        return;
      }
      await ActivityLogger.log(chatId, 'INTERACTIVE_ACTION', `Copied raw text for prompt ${promptId}`);
      await TelegramService.sendTextMessage(chatId, promptRecord.optimizedText);
      return;
    }

    if (actionId === 'btn_new_prompt') {
      await TelegramService.sendTextMessage(chatId, '✨ Send me any rough idea, voice note, or document to generate a new prompt!');
      return;
    }
  }

  /**
   * Handles prompt refinement when user provides follow-up instructions.
   */
  private static async handleRefinementRequest(
    chatId: string,
    userId: string,
    projectId: string,
    feedbackText: string,
    session: any
  ): Promise<void> {
    const contextData: any = session?.contextData || {};
    const previousPrompt = contextData.lastPromptText || '';

    const project = await AuthorizationService.verifyProjectAccess(userId, projectId, chatId);
    if (!project) {
      await TelegramService.sendTextMessage(chatId, '❌ Forbidden: Workspace ownership verification failed.');
      return;
    }
    await TelegramService.sendTextMessage(chatId, '⚙️ Refining your prompt using your feedback and project rules...');

    const refined = await GenerationAgent.generatePrompt({
      rawIdea: 'User refinement follow-up',
      category: 'GENERAL',
      complexity: 'HIGH',
      projectName: project?.name || 'General',
      semanticContextChunks: [],
      previousDraft: previousPrompt,
      refinementFeedback: feedbackText,
    });

    await prisma.aiSession.updateMany({ where: { userId }, data: { currentState: 'IDLE' } });

    await TelegramService.sendTextMessage(chatId, `✨ *Refined Prompt Output*\n\`\`\`\n${refined}\n\`\`\``);
  }

  /**
   * Renders interactive Telegram Inline Keyboard with all user projects.
   */
  private static async sendProjectSelectionMenu(chatId: string, userId: string): Promise<void> {
    const projects = await prisma.project.findMany({
      where: { userId, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      take: 9,
    });

    const sections: TelegramInteractiveSection[] = [
      {
        title: 'Your Workspaces',
        rows: projects.map((p) => ({
          id: `switch_proj_${p.id}`,
          title: `${p.isActive ? '✅ ' : '📁 '}${p.name}`.slice(0, 30),
          description: p.description || 'Active AI project memory',
        })),
      },
      {
        title: 'Actions',
        rows: [{ id: 'btn_create_project', title: '➕ New Project', description: 'Create an isolated workspace' }],
      },
    ];

    await TelegramService.sendListMessage(
      chatId,
      '📁 *PromptPilot Project Workspaces*\nClick a workspace below to load its vector memory context:',
      'View Workspaces',
      sections,
      'Project Selection'
    );
  }

  /**
   * Prompts user for new project name.
   */
  private static async promptForProjectName(chatId: string, userId: string): Promise<void> {
    await prisma.aiSession.create({
      data: {
        userId,
        currentState: 'WAITING_FOR_PROJECT_NAME',
        expiresAt: new Date(Date.now() + 900000), // 15 mins
      },
    });
    await TelegramService.sendTextMessage(chatId, '🚀 Please reply with the *Name* of your new project workspace (e.g., "SaaS Marketing Campaign" or "E-Commerce App Architecture"):');
  }

  /**
   * Creates new workspace in Postgres.
   */
  private static async handleProjectCreation(chatId: string, userId: string, projectName: string): Promise<void> {
    await prisma.project.updateMany({ where: { userId }, data: { isActive: false } });
    const newProject = await prisma.project.create({
      data: {
        userId,
        name: projectName.trim(),
        description: `Project workspace created via Telegram on ${new Date().toLocaleDateString()}`,
        isActive: true,
      },
    });

    await ActivityLogger.log(chatId, 'PROJECT_CREATED', `Workspace: ${newProject.name}`);
    await prisma.aiSession.updateMany({ where: { userId }, data: { currentState: 'IDLE' } });
    await TelegramService.sendTextMessage(chatId, `🎉 Project *"${newProject.name}"* created and set as active workspace!\nAny documents, photos, or voice notes sent now will be embedded into this project's pgvector memory.`);
  }

  /**
   * Downloads and embeds media from Telegram with multi-format document extraction and detailed logging.
   */
  private static async handleMediaIngestion(
    chatId: string,
    projectId: string,
    projectName: string,
    mediaId: string,
    mediaType: string,
    fileName?: string,
    telegramMimeType?: string
  ): Promise<void> {
    const displayType = fileName ? fileName : mediaType.toLowerCase();
    await TelegramService.sendTextMessage(chatId, `📥 Downloading & processing ${displayType} to vector memory for *${projectName}*...`);

    try {
      const { buffer, mimeType, fileName: detectedFileName } = await TelegramService.downloadMediaBytes(
        mediaId,
        fileName,
        telegramMimeType
      );
      const ext = (detectedFileName.split('.').pop() || '').toLowerCase();
      let extractedText = '';
      let extractionMethod = 'unknown';

      if (mimeType === 'application/pdf' || ext === 'pdf') {
        extractionMethod = 'pdf-parse';
        try {
          const pdfData = await pdfParse(buffer);
          extractedText = pdfData.text || '';
        } catch (err: any) {
          console.error(`[MediaIngestion] Error during pdf-parse extraction for ${detectedFileName}:`, err.stack || err);
          throw new Error(`Failed to parse PDF document: ${err.message}`);
        }
      } else if (
        mimeType.includes('wordprocessingml') ||
        mimeType.includes('msword') ||
        ext === 'docx' ||
        ext === 'doc'
      ) {
        if (ext === 'docx' || mimeType.includes('wordprocessingml')) {
          extractionMethod = 'mammoth';
          try {
            const result = await mammoth.extractRawText({ buffer });
            extractedText = result.value || '';
          } catch (err: any) {
            console.error(`[MediaIngestion] Error during mammoth extraction for ${detectedFileName}:`, err.stack || err);
            throw new Error(`Failed to parse DOCX document: ${err.message}`);
          }
        } else {
          extractionMethod = 'metadata-summary';
          extractedText = `Document Summary:\nFilename: ${detectedFileName}\nFile Extension: ${ext}\nMIME Type: ${mimeType}\nFile Size: ${buffer.length} bytes\nNote: Legacy binary .doc format not supported for direct extraction. Stored file classification.`;
        }
      } else if (
        mimeType === 'text/plain' ||
        mimeType === 'text/markdown' ||
        mimeType === 'text/csv' ||
        ext === 'txt' ||
        ext === 'md' ||
        ext === 'csv'
      ) {
        extractionMethod = `raw-${ext || 'text'}`;
        extractedText = buffer.toString('utf-8');
      } else if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        extractionMethod = 'gemini-image';
        try {
          extractedText = await GeminiService.processMediaInput(
            mimeType.startsWith('image/') ? mimeType : `image/${ext === 'jpg' ? 'jpeg' : ext}`,
            buffer,
            'Extract all text and summarize the core technical specifications, diagrams, and business requirements contained in this image.'
          );
        } catch (err: any) {
          console.error(`[MediaIngestion] Gemini image processing failed for ${detectedFileName}:`, err.stack || err);
          throw new Error(`Failed to analyze image: ${err.message}`);
        }
      } else if (mimeType.startsWith('audio/') || ['mp3', 'ogg', 'oga', 'wav'].includes(ext)) {
        extractionMethod = 'gemini-audio';
        try {
          extractedText = await GeminiService.processMediaInput(
            mimeType.startsWith('audio/') ? mimeType : `audio/${ext === 'oga' ? 'ogg' : ext}`,
            buffer,
            'Transcribe this voice note exactly word for word. If it contains project ideas or instructions, summarize key requirements concisely.'
          );
        } catch (err: any) {
          console.error(`[MediaIngestion] Gemini audio processing failed for ${detectedFileName}:`, err.stack || err);
          throw new Error(`Failed to transcribe audio: ${err.message}`);
        }
      } else {
        extractionMethod = 'metadata-summary';
        extractedText = `Document Summary:\nFilename: ${detectedFileName}\nFile Extension: ${ext || 'unknown'}\nMIME Type: ${mimeType}\nFile Size: ${buffer.length} bytes\nNote: Unsupported format for direct text extraction. Stored file classification and metadata.`;
      }

      console.log(`[MediaIngestion] Extraction Report:`, {
        originalFilename: detectedFileName,
        fileExtension: ext || 'unknown',
        detectedMimeType: mimeType,
        mediaType,
        bufferSize: buffer.length,
        extractionMethod,
        extractedChars: extractedText.length,
      });

      const chunkCount = await MemoryService.ingestDocumentText(projectId, detectedFileName || `${mediaType}_${Date.now()}`, extractedText);
      await ActivityLogger.log(chatId, 'FILE_UPLOADED', `Media Type: ${mediaType} - ${detectedFileName || 'unknown'}`);
      await TelegramService.sendTextMessage(
        chatId,
        `✅ Media processed successfully!\n*Extraction Method:* \`${extractionMethod}\` | *Chunks Stored:* ${chunkCount}\n*Extracted Context Snapshot:*\n"${extractedText.slice(0, 180)}..."\n\nVector embeddings generated and stored in *${projectName}* workspace.`
      );
    } catch (error: any) {
      console.error('Failed to ingest media from Telegram:', {
        mediaId,
        mediaType,
        fileName,
        telegramMimeType,
        error: error.message,
        stack: error.stack,
      });
      await TelegramService.sendTextMessage(chatId, '❌ Failed to process media file. Please ensure the file format is supported and try again.');
    }
  }

  /**
   * Searches past prompts.
   */
  private static async handleSearchHistory(chatId: string, projectId: string, query: string): Promise<void> {
    const cleanQuery = query.replace('/search', '').trim();
    await ActivityLogger.log(chatId, 'SEARCH_PERFORMED', cleanQuery);
    const prompts = await prisma.prompt.findMany({
      where: {
        message: { conversation: { projectId } },
        rawIdea: { contains: cleanQuery, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    if (prompts.length === 0) {
      await TelegramService.sendTextMessage(chatId, `🔍 No previous prompts found matching "${cleanQuery}" in the current workspace.`);
      return;
    }

    let report = `🔍 *Search Results for "${cleanQuery}":*\n\n`;
    prompts.forEach((p, idx) => {
      report += `*#${idx + 1}. [Score: ${p.qualityScore}/100]*\nIdea: "${p.rawIdea.slice(0, 60)}..."\n\`\`\`\n${p.optimizedText.slice(0, 150)}...\n\`\`\`\n\n`;
    });

    await TelegramService.sendTextMessage(chatId, report);
  }

  /**
   * Sends help menu.
   */
  private static async sendHelpMenu(chatId: string): Promise<void> {
    const helpText = `✨ *PromptPilot Telegram Bot Guide*\n
*Commands:*
- \`/projects\` or \`/switch\` : View & switch active project workspaces.
- \`/new [name]\` : Create a new project workspace.
- \`/search [keyword]\` : Search previous generated prompts.
- \`/help\` : Display this command sitemap.

*Multi-Modal Context:*
- Send *Voice Notes* or *Audio* to transcribe and add context.
- Send *Documents (PDFs)* or *Photos* to extract architecture details to vector memory.
- Type any rough idea and let the 12-point AI Engine build your elite prompt!`;

    await TelegramService.sendTextMessage(chatId, helpText);
  }
}
