import { DatabaseService } from '../database';
import { GeminiService } from './gemini';

export class MemoryService {
  /**
   * Chunks text into smaller paragraphs/blocks (~400 characters) and upserts embeddings into Supabase pgvector.
   */
  static async ingestDocumentText(
    projectId: string,
    fileName: string,
    rawText: string
  ): Promise<number> {
    const chunks = this.splitIntoChunks(rawText, 450, 50);
    let count = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const key = `file:${fileName}:chunk_${i + 1}`;
      
      // Generate 768-dim vector embedding using Gemini free tier
      const embedding = await GeminiService.generateEmbedding(chunkText);
      await DatabaseService.addProjectMemory(projectId, key, chunkText, embedding);
      count++;
    }

    return count;
  }

  /**
   * Summarizes and stores a key technical/business rule learned from a conversation.
   */
  static async saveContextRule(projectId: string, ruleKey: string, ruleValue: string): Promise<void> {
    const embedding = await GeminiService.generateEmbedding(`${ruleKey}: ${ruleValue}`);
    await DatabaseService.addProjectMemory(projectId, ruleKey, ruleValue, embedding);
  }

  /**
   * Retrieves semantically relevant context chunks for a user's prompt request.
   */
  static async retrieveRelevantContext(projectId: string, queryText: string, limit = 5): Promise<string[]> {
    const queryEmbedding = await GeminiService.generateEmbedding(queryText);
    const matches = await DatabaseService.searchProjectMemory(projectId, queryEmbedding, 0.4, limit);
    
    return matches.map((m) => `[Memory: ${m.key}] -> ${m.value}`);
  }

  /**
   * Simple paragraph/word sliding window chunker.
   */
  private static splitIntoChunks(text: string, chunkSize = 450, overlap = 50): string[] {
    const cleaned = text.replace(/\r\n/g, '\n').trim();
    if (cleaned.length <= chunkSize) return [cleaned];

    const chunks: string[] = [];
    let start = 0;

    while (start < cleaned.length) {
      let end = start + chunkSize;
      if (end >= cleaned.length) {
        chunks.push(cleaned.slice(start).trim());
        break;
      }

      // Try to break at a newline or period near the end
      const lastPeriod = cleaned.lastIndexOf('.', end);
      const lastNewline = cleaned.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > start + chunkSize * 0.5) {
        end = breakPoint + 1;
      }

      chunks.push(cleaned.slice(start, end).trim());
      start = end - overlap;
    }

    return chunks.filter((c) => c.length > 20);
  }
}
