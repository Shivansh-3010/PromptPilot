import { prisma, DatabaseService } from '../database';
import { WhatsAppService, WhatsAppInteractiveSection } from '../services/whatsapp';
import { MemoryService } from '../services/memory';
import { GeminiService } from '../services/gemini';
import { IntentAgent } from './intentAgent';
import { GenerationAgent } from './generationAgent';
import { ScoringAgent } from './scoringAgent';

export class AgentRouter {
  /**
   * Main entrypoint triggered by incoming WhatsApp messages.
   */
  static async handleIncomingMessage(
    fromPhone: string,
    messageId: string,
    messageType: string,
    content: { text?: string; buttonId?: string; listRowId?: string; mediaId?: string; mediaType?: string }
  ): Promise<void> {
    console.log(`[AgentRouter] Processing turn from ${fromPhone}: Type=${messageType}`);

    // Step 1: Ensure User exists in Postgres & retrieve active project
    const user = await DatabaseService.getOrCreateUser(fromPhone);
    const activeProject = await DatabaseService.getActiveProject(user.id);

    if (!activeProject) {
      await WhatsAppService.sendTextMessage(fromPhone, '❌ Error: No active project found. Please type `/new` to create one.');
      return;
    }

    // Step 2: Check current conversational state session
    let session = await prisma.aiSession.findFirst({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
    });

    // Handle interactive button / list item clicks
    if (content.buttonId || content.listRowId) {
      const actionId = content.buttonId || content.listRowId || '';
      await this.handleInteractiveAction(fromPhone, user.id, activeProject.id, actionId, session);
      return;
    }

    // Handle pending state inputs (e.g. user typing new project name)
    if (session && session.currentState === 'WAITING_FOR_PROJECT_NAME' && content.text) {
      await this.handleProjectCreation(fromPhone, user.id, content.text);
      return;
    }

    if (session && session.currentState === 'WAITING_FOR_REFINEMENT' && content.text) {
      await this.handleRefinementRequest(fromPhone, user.id, activeProject.id, content.text, session);
      return;
    }

    // Handle Media (Voice notes / PDFs / Images)
    if (content.mediaId && content.mediaType) {
      await this.handleMediaIngestion(fromPhone, activeProject.id, activeProject.name, content.mediaId, content.mediaType);
      return;
    }

    // Step 3: Standard Text Processing via Intent Agent
    const rawText = content.text || '';
    if (!rawText.trim()) return;

    await WhatsAppService.sendTextMessage(fromPhone, `🤖 *PromptPilot Orchestrator*\nAnalyzing intent & querying memory for workspace: *${activeProject.name}*...`);

    const intentAnalysis = await IntentAgent.analyze(rawText);
    console.log('[AgentRouter] Intent Analysis:', intentAnalysis);

    switch (intentAnalysis.intent) {
      case 'LIST_PROJECTS':
      case 'SWITCH_PROJECT':
        await this.sendProjectSelectionMenu(fromPhone, user.id);
        break;

      case 'CREATE_PROJECT':
        if (intentAnalysis.extractedGoal && intentAnalysis.extractedGoal.length > 3 && !intentAnalysis.extractedGoal.toLowerCase().includes('/new')) {
          await this.handleProjectCreation(fromPhone, user.id, intentAnalysis.extractedGoal);
        } else {
          await this.promptForProjectName(fromPhone, user.id);
        }
        break;

      case 'SEARCH_HISTORY':
        await this.handleSearchHistory(fromPhone, activeProject.id, rawText);
        break;

      case 'HELP_MENU':
        await this.sendHelpMenu(fromPhone);
        break;

      case 'REFINE_PROMPT':
        await this.handleRefinementRequest(fromPhone, user.id, activeProject.id, rawText, session);
        break;

      case 'GENERATE_PROMPT':
      default:
        await this.executePromptPipeline(fromPhone, user.id, activeProject.id, activeProject.name, activeProject.description || undefined, rawText, intentAnalysis.category, intentAnalysis.complexity);
        break;
    }
  }

  /**
   * Pipeline that builds, reviews, and scores a prompt using 12-point framework + pgvector context.
   */
  private static async executePromptPipeline(
    fromPhone: string,
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

    // 5. Send results to user on WhatsApp
    const header = `✨ *Prompt Architect Output* | Quality Score: *${evaluation.overallScore}/100*`;
    const body = `${header}\n\n*Category:* ${category} | *Workspace:* ${projectName}\n*QA Review:* ${evaluation.critique}\n\nHere is your production-ready prompt:\n\`\`\`\n${finalPromptText}\n\`\`\``;

    // Send formatted markdown text
    await WhatsAppService.sendTextMessage(fromPhone, body);

    // Send quick action buttons
    await WhatsAppService.sendButtonsMessage(
      fromPhone,
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
   * Handles button click actions or list selections from interactive messages.
   */
  private static async handleInteractiveAction(
    fromPhone: string,
    userId: string,
    activeProjectId: string,
    actionId: string,
    session: any
  ): Promise<void> {
    if (actionId.startsWith('switch_proj_')) {
      const targetProjectId = actionId.replace('switch_proj_', '');
      await prisma.project.updateMany({ where: { userId }, data: { isActive: false } });
      const updated = await prisma.project.update({ where: { id: targetProjectId }, data: { isActive: true } });
      await WhatsAppService.sendTextMessage(fromPhone, `🚀 Workspace switched successfully to: *${updated.name}*.\nAll vector memory context loaded.`);
      return;
    }

    if (actionId === 'btn_create_project') {
      await this.promptForProjectName(fromPhone, userId);
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
      await WhatsAppService.sendTextMessage(fromPhone, '🛠️ *Prompt Refinement Mode*\nWhat adjustments would you like? (e.g., "Make it more professional", "Add error handling constraints", "Shorten it to 3 bullet points")');
      return;
    }

    if (actionId.startsWith('copy_')) {
      const promptId = actionId.replace('copy_', '');
      const promptRecord = await prisma.prompt.findUnique({ where: { id: promptId } });
      if (promptRecord) {
        await WhatsAppService.sendTextMessage(fromPhone, promptRecord.optimizedText);
      }
      return;
    }

    if (actionId === 'btn_new_prompt') {
      await WhatsAppService.sendTextMessage(fromPhone, '✨ Send me any rough idea, voice note, or screenshot to generate a new prompt!');
      return;
    }
  }

  /**
   * Handles prompt refinement when user provides follow-up instructions.
   */
  private static async handleRefinementRequest(
    fromPhone: string,
    userId: string,
    projectId: string,
    feedbackText: string,
    session: any
  ): Promise<void> {
    const contextData: any = session?.contextData || {};
    const previousPrompt = contextData.lastPromptText || '';

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    await WhatsAppService.sendTextMessage(fromPhone, '⚙️ Refining your prompt using your feedback and project rules...');

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

    await WhatsAppService.sendTextMessage(fromPhone, `✨ *Refined Prompt Output*\n\`\`\`\n${refined}\n\`\`\``);
  }

  /**
   * Renders interactive WhatsApp List Message with all user projects.
   */
  private static async sendProjectSelectionMenu(fromPhone: string, userId: string): Promise<void> {
    const projects = await prisma.project.findMany({
      where: { userId, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      take: 9,
    });

    const sections: WhatsAppInteractiveSection[] = [
      {
        title: 'Your Workspaces',
        rows: projects.map((p) => ({
          id: `switch_proj_${p.id}`,
          title: `${p.isActive ? '✅ ' : '📁 '}${p.name}`.slice(0, 24),
          description: p.description || 'Active AI project memory',
        })),
      },
      {
        title: 'Actions',
        rows: [{ id: 'btn_create_project', title: '➕ New Project', description: 'Create an isolated workspace' }],
      },
    ];

    await WhatsAppService.sendListMessage(
      fromPhone,
      '📁 *PromptPilot Project Workspaces*\nSelect a project below to load its vector memory context:',
      'View Workspaces',
      sections,
      'Project Selection'
    );
  }

  /**
   * Prompts user for new project name.
   */
  private static async promptForProjectName(fromPhone: string, userId: string): Promise<void> {
    await prisma.aiSession.create({
      data: {
        userId,
        currentState: 'WAITING_FOR_PROJECT_NAME',
        expiresAt: new Date(Date.now() + 900000), // 15 mins
      },
    });
    await WhatsAppService.sendTextMessage(fromPhone, '🚀 Please reply with the *Name* of your new project workspace (e.g., "SaaS Marketing Campaign" or "E-Commerce App Architecture"):');
  }

  /**
   * Creates new workspace in Postgres.
   */
  private static async handleProjectCreation(fromPhone: string, userId: string, projectName: string): Promise<void> {
    await prisma.project.updateMany({ where: { userId }, data: { isActive: false } });
    const newProject = await prisma.project.create({
      data: {
        userId,
        name: projectName.trim(),
        description: `Project workspace created via WhatsApp on ${new Date().toLocaleDateString()}`,
        isActive: true,
      },
    });

    await prisma.aiSession.updateMany({ where: { userId }, data: { currentState: 'IDLE' } });
    await WhatsAppService.sendTextMessage(fromPhone, `🎉 Project *"${newProject.name}"* created and set as active workspace!\nAny documents, screenshots, or voice notes sent now will be embedded into this project's pgvector memory.`);
  }

  /**
   * Downloads and embeds media from WhatsApp.
   */
  private static async handleMediaIngestion(fromPhone: string, projectId: string, projectName: string, mediaId: string, mediaType: string): Promise<void> {
    await WhatsAppService.sendTextMessage(fromPhone, `📥 Downloading & processing ${mediaType.toLowerCase()} to vector memory for *${projectName}*...`);

    try {
      const { buffer, mimeType } = await WhatsAppService.downloadMediaBytes(mediaId);
      let extractedText = '';

      if (mimeType.includes('audio')) {
        extractedText = await GeminiService.processMediaInput(mimeType, buffer, 'Transcribe this voice note exactly word for word. If it contains project ideas or instructions, summarize key requirements concisely.');
      } else if (mimeType.includes('image') || mimeType.includes('pdf')) {
        extractedText = await GeminiService.processMediaInput(mimeType, buffer, 'Extract all text and summarize the core technical specifications, diagrams, or business requirements contained in this file.');
      } else {
        extractedText = `Uploaded media: ${mimeType}`;
      }

      await MemoryService.ingestDocumentText(projectId, `${mediaType}_${Date.now()}`, extractedText);
      await WhatsAppService.sendTextMessage(fromPhone, `✅ Media processed successfully!\n*Extracted Context Snapshot:*\n"${extractedText.slice(0, 180)}..."\n\nVector embeddings generated and stored in *${projectName}* workspace.`);
    } catch (error: any) {
      console.error('Failed to ingest media:', error);
      await WhatsAppService.sendTextMessage(fromPhone, '❌ Failed to process media file. Please ensure the file format is supported and try again.');
    }
  }

  /**
   * Searches past prompts.
   */
  private static async handleSearchHistory(fromPhone: string, projectId: string, query: string): Promise<void> {
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
      await WhatsAppService.sendTextMessage(fromPhone, `🔍 No previous prompts found matching "${cleanQuery}" in the current workspace.`);
      return;
    }

    let report = `🔍 *Search Results for "${cleanQuery}":*\n\n`;
    prompts.forEach((p, idx) => {
      report += `*#${idx + 1}. [Score: ${p.qualityScore}/100]*\nIdea: "${p.rawIdea.slice(0, 60)}..."\n\`\`\`\n${p.optimizedText.slice(0, 150)}...\n\`\`\`\n\n`;
    });

    await WhatsAppService.sendTextMessage(fromPhone, report);
  }

  /**
   * Sends help menu.
   */
  private static async sendHelpMenu(fromPhone: string): Promise<void> {
    const helpText = `✨ *PromptPilot Commands & Guide*\n
*Commands:*
- \`/projects\` or \`/switch\` : View & switch active project workspaces.
- \`/new [name]\` : Create a new project workspace.
- \`/search [keyword]\` : Search previous generated prompts.
- \`/help\` : Display this command sitemap.

*Multi-Modal Context:*
- Send *Voice Notes* to transcribe and add context.
- Send *PDFs or Screenshots* to extract architecture details to vector memory.
- Type any rough idea and let the 12-point AI Engine build your elite prompt!`;

    await WhatsAppService.sendTextMessage(fromPhone, helpText);
  }
}
