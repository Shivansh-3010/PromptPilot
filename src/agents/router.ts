import { prisma, DatabaseService } from '../database';
import { TelegramService, TelegramInteractiveSection } from '../services/telegram';
import { MemoryService } from '../services/memory';
import { GeminiService } from '../services/gemini';
import { IntentAgent } from './intentAgent';
import { GenerationAgent } from './generationAgent';
import { ScoringAgent } from './scoringAgent';

export class AgentRouter {
  /**
   * Main entrypoint triggered by incoming Telegram messages or inline button callbacks.
   */
  static async handleIncomingMessage(
    chatId: string,
    messageId: string,
    messageType: string,
    content: { text?: string; buttonId?: string; listRowId?: string; mediaId?: string; mediaType?: string }
  ): Promise<void> {
    console.log(`[AgentRouter] Processing turn from Telegram chat ${chatId}: Type=${messageType}`);

    // Step 1: Ensure User exists in Postgres & retrieve active project (chatId is stored safely in User.phoneNumber field)
    const user = await DatabaseService.getOrCreateUser(chatId, `Telegram User ${chatId.slice(-4)}`);
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

    // Handle Media (Voice notes / PDFs / Images)
    if (content.mediaId && content.mediaType) {
      await this.handleMediaIngestion(chatId, activeProject.id, activeProject.name, content.mediaId, content.mediaType);
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
        targetModel: 'Gemini 1.5 Pro (Zero-Cost)',
        qualityScore: evaluation.overallScore,
        critique: evaluation.critique,
      },
    });

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
      await prisma.project.updateMany({ where: { userId }, data: { isActive: false } });
      const updated = await prisma.project.update({ where: { id: targetProjectId }, data: { isActive: true } });
      await TelegramService.sendTextMessage(chatId, `🚀 Workspace switched successfully to: *${updated.name}*.\nAll vector memory context loaded.`);
      return;
    }

    if (actionId === 'btn_create_project') {
      await this.promptForProjectName(chatId, userId);
      return;
    }

    if (actionId.startsWith('refine_')) {
      const promptId = actionId.replace('refine_', '');
      const promptRecord = await prisma.prompt.findUnique({ where: { id: promptId } });
      await prisma.aiSession.create({
        data: {
          userId,
          currentState: 'WAITING_FOR_REFINEMENT',
          contextData: { lastPromptId: promptId, lastPromptText: promptRecord?.optimizedText },
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
      await TelegramService.sendTextMessage(chatId, '🛠️ *Prompt Refinement Mode*\nWhat adjustments would you like? (e.g., "Make it more professional", "Add error handling constraints", "Shorten it to 3 bullet points")');
      return;
    }

    if (actionId.startsWith('copy_')) {
      const promptId = actionId.replace('copy_', '');
      const promptRecord = await prisma.prompt.findUnique({ where: { id: promptId } });
      if (promptRecord) {
        await TelegramService.sendTextMessage(chatId, promptRecord.optimizedText);
      }
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

    const project = await prisma.project.findUnique({ where: { id: projectId } });
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

    await prisma.aiSession.updateMany({ where: { userId }, data: { currentState: 'IDLE' } });
    await TelegramService.sendTextMessage(chatId, `🎉 Project *"${newProject.name}"* created and set as active workspace!\nAny documents, photos, or voice notes sent now will be embedded into this project's pgvector memory.`);
  }

  /**
   * Downloads and embeds media from Telegram.
   */
  private static async handleMediaIngestion(chatId: string, projectId: string, projectName: string, mediaId: string, mediaType: string): Promise<void> {
    await TelegramService.sendTextMessage(chatId, `📥 Downloading & processing ${mediaType.toLowerCase()} to vector memory for *${projectName}*...`);

    try {
      const { buffer, mimeType } = await TelegramService.downloadMediaBytes(mediaId);
      let extractedText = '';

      if (mimeType.includes('audio')) {
        extractedText = await GeminiService.processMediaInput(mimeType, buffer, 'Transcribe this voice note exactly word for word. If it contains project ideas or instructions, summarize key requirements concisely.');
      } else if (mimeType.includes('image') || mimeType.includes('pdf')) {
        extractedText = await GeminiService.processMediaInput(mimeType, buffer, 'Extract all text and summarize the core technical specifications, diagrams, or business requirements contained in this file.');
      } else {
        extractedText = `Uploaded media: ${mimeType}`;
      }

      await MemoryService.ingestDocumentText(projectId, `${mediaType}_${Date.now()}`, extractedText);
      await TelegramService.sendTextMessage(chatId, `✅ Media processed successfully!\n*Extracted Context Snapshot:*\n"${extractedText.slice(0, 180)}..."\n\nVector embeddings generated and stored in *${projectName}* workspace.`);
    } catch (error: any) {
      console.error('Failed to ingest media from Telegram:', error);
      await TelegramService.sendTextMessage(chatId, '❌ Failed to process media file. Please ensure the file format is supported and try again.');
    }
  }

  /**
   * Searches past prompts.
   */
  private static async handleSearchHistory(chatId: string, projectId: string, query: string): Promise<void> {
    const cleanQuery = query.replace('/search', '').trim();
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
