import { DatabaseService } from '../database';
import { GeminiService } from './gemini';

export class MemoryService {
  /**
   * Cleans raw extracted document text before chunking and embedding.
   */
  private static cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars except \t and \n
      .replace(/\n{3,}/g, '\n\n') // collapse excessive blank lines
      .replace(/[ \t]{2,}/g, ' ') // collapse excessive spacing
      .trim();
  }

  /**
   * Chunks text into blocks (~500-1000 tokens, approx 2800 chars with 420 chars overlap) and upserts embeddings into Supabase pgvector.
   */
  static async ingestDocumentText(
    projectId: string,
    fileName: string,
    rawText: string
  ): Promise<number> {
    const cleanedText = this.cleanText(rawText);
    if (!cleanedText) return 0;

    const chunks = this.splitIntoChunks(cleanedText, 2800, 420);
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
   * Sliding window chunker with natural sentence/paragraph boundaries (~500-1000 tokens).
   */
  private static splitIntoChunks(text: string, chunkSize = 2800, overlap = 420): string[] {
    const cleaned = text.trim();
    if (cleaned.length <= chunkSize) return [cleaned];

    const chunks: string[] = [];
    let start = 0;

    while (start < cleaned.length) {
      let end = start + chunkSize;
      if (end >= cleaned.length) {
        chunks.push(cleaned.slice(start).trim());
        break;
      }

      // Try to break at a double newline, newline, or period near the end
      const lastDoubleNewline = cleaned.lastIndexOf('\n\n', end);
      const lastNewline = cleaned.lastIndexOf('\n', end);
      const lastPeriod = cleaned.lastIndexOf('.', end);
      const breakPoint = Math.max(lastDoubleNewline, lastNewline, lastPeriod);

      if (breakPoint > start + chunkSize * 0.5) {
        end = breakPoint + 1;
      }

      chunks.push(cleaned.slice(start, end).trim());
      start = end - overlap;
    }

    return chunks.filter((c) => c.length > 20);
  }
}
