import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export interface MemoryMatchResult {
  id: string;
  key: string;
  value: string;
  similarity: number;
}

export class DatabaseService {
  /**
   * Performs semantic similarity search inside Supabase Postgres using pgvector.
   */
  static async searchProjectMemory(
    projectId: string,
    queryEmbedding: number[],
    threshold = 0.5,
    limit = 5
  ): Promise<MemoryMatchResult[]> {
    try {
      const vectorString = `[${queryEmbedding.join(',')}]`;
      const results = await prisma.$queryRaw<MemoryMatchResult[]>`
        SELECT id, key, value, similarity
        FROM match_project_memory(
          ${vectorString}::vector(768),
          ${threshold},
          ${limit},
          ${projectId}
        )
      `;
      return results;
    } catch (error) {
      console.error('Error executing vector search in Postgres:', error);
      // Fallback to basic key/value lookup if vector query fails
      const fallback = await prisma.projectMemory.findMany({
        where: { projectId },
        take: limit,
      });
      return fallback.map((m) => ({
        id: m.id,
        key: m.key,
        value: m.value,
        similarity: 1.0,
      }));
    }
  }

  /**
   * Saves a new semantic memory snippet to the active project.
   */
  static async addProjectMemory(
    projectId: string,
    key: string,
    value: string,
    embedding: number[]
  ): Promise<void> {
    const vectorString = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      INSERT INTO "ProjectMemory" ("id", "projectId", "key", "value", "embedding", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid()::text,
        ${projectId},
        ${key},
        ${value},
        ${vectorString}::vector(768),
        NOW(),
        NOW()
      )
    `;
  }

  /**
   * Retrieves or creates a user by WhatsApp Phone ID.
   */
  static async getOrCreateUser(phoneNumber: string, name?: string) {
    let user = await prisma.user.findUnique({
      where: { phoneNumber },
      include: {
        projects: {
          where: { isActive: true, isArchived: false },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          phoneNumber,
          name: name || `User ${phoneNumber.slice(-4)}`,
          projects: {
            create: {
              name: '🚀 General Workspace',
              description: 'Default multi-purpose project for generating AI prompts.',
              isActive: true,
            },
          },
        },
        include: {
          projects: true,
        },
      });
    }
    return user;
  }

  /**
   * Gets active project for user or defaults to first project.
   */
  static async getActiveProject(userId: string) {
    const activeProject = await prisma.project.findFirst({
      where: { userId, isActive: true, isArchived: false },
    });
    if (activeProject) return activeProject;

    // If none marked active, return most recently updated project
    return prisma.project.findFirst({
      where: { userId, isArchived: false },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
