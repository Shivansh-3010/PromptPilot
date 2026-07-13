import { Response } from 'express';
import { prisma, DatabaseService } from '../database';
import { AuthenticatedRequest } from '../middleware/auth';
import { MemoryService } from '../services/memory';
import { GenerationAgent } from '../agents/generationAgent';
import { ScoringAgent } from '../agents/scoringAgent';
import { AuthorizationService } from '../services/authorizationService';

export class ProjectController {
  /**
   * GET /api/v1/projects
   */
  static async listProjects(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const projects = await prisma.project.findMany({
        where: { userId, isArchived: false },
        include: {
          _count: {
            select: { conversations: true, projectMemory: true, uploadedFiles: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      res.json({ projects });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/v1/projects
   */
  static async createProject(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: 'Project name is required' });

      await prisma.project.updateMany({ where: { userId }, data: { isActive: false } });
      const newProject = await prisma.project.create({
        data: { userId, name, description, isActive: true },
      });

      res.status(201).json({ project: newProject });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/v1/projects/:id/memory/search
   */
  static async searchMemory(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { id } = req.params;
      const { query, limit = 5 } = req.body;

      if (!query) return res.status(400).json({ error: 'Search query is required' });

      // Enforce centralized ownership verification before vector retrieval
      const project = await AuthorizationService.verifyProjectAccess(userId, id, req.user?.phoneNumber);
      if (!project) {
        return res.status(403).json({ error: 'Forbidden: You do not have permission to access this workspace memory' });
      }

      const results = await MemoryService.retrieveRelevantContext(id, query, limit);
      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/v1/prompts/generate
   */
  static async generatePromptViaApi(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { projectId, rawInput, category = 'GENERAL', complexity = 'MEDIUM' } = req.body;
      if (!rawInput) return res.status(400).json({ error: 'rawInput is required' });

      let targetProject = projectId
        ? await AuthorizationService.verifyProjectAccess(userId, projectId, req.user?.phoneNumber)
        : await DatabaseService.getActiveProject(userId);

      if (!targetProject) {
        return res.status(404).json({ error: 'Active workspace project not found' });
      }

      const contextChunks = await MemoryService.retrieveRelevantContext(targetProject.id, rawInput, 5);
      const draft = await GenerationAgent.generatePrompt({
        rawIdea: rawInput,
        category,
        complexity,
        projectName: targetProject.name,
        projectDescription: targetProject.description || undefined,
        semanticContextChunks: contextChunks,
      });

      const evaluation = await ScoringAgent.evaluateAndOptimize(draft, {
        rawIdea: rawInput,
        category,
        complexity,
        projectName: targetProject.name,
        projectDescription: targetProject.description || undefined,
        semanticContextChunks: contextChunks,
      });

      res.json({
        category,
        targetModel: 'Gemini 2.5 Flash (Zero-Cost)',
        qualityScore: evaluation.overallScore,
        optimizedText: evaluation.improvedDraft || draft,
        critique: evaluation.critique,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
