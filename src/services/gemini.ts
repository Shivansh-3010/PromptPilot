import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';

const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey || 'mock_key');

export class GeminiService {
  /**
   * Generates text using Gemini 1.5 Flash (for high-speed classification, intent detection, and scoring).
   */
  static async generateFlash(prompt: string, systemInstruction?: string, jsonMode = false): Promise<string> {
    if (!config.ai.geminiApiKey || config.ai.geminiApiKey === 'test_gemini_key') {
      return this.getMockResponse(prompt, jsonMode);
    }

    try {
      const model = genAI.getGenerativeModel({
        model: config.ai.routingModel,
        systemInstruction,
        generationConfig: jsonMode ? { responseMimeType: 'application/json' } : undefined,
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      return responseText;
    } catch (error: any) {
      console.error('Error in Gemini Flash generation:', error.message);
      throw error;
    }
  }

  /**
   * Generates text using Gemini 1.5 Pro (for deep 12-point prompt synthesis & complex reasoning).
   */
  static async generatePro(prompt: string, systemInstruction?: string): Promise<string> {
    if (!config.ai.geminiApiKey || config.ai.geminiApiKey === 'test_gemini_key') {
      return this.getMockResponse(prompt, false);
    }

    try {
      const model = genAI.getGenerativeModel({
        model: config.ai.generationModel,
        systemInstruction,
      });

      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error: any) {
      console.error('Error in Gemini Pro generation, falling back to Flash:', error.message);
      return this.generateFlash(prompt, systemInstruction);
    }
  }

  /**
   * Generates 768-dimensional embeddings using `text-embedding-004` for zero-cost pgvector storage.
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    if (!config.ai.geminiApiKey || config.ai.geminiApiKey === 'test_gemini_key') {
      // Return dummy 768-dimensional vector for mock dev testing
      return Array.from({ length: 768 }, () => Math.random() * 0.1);
    }

    try {
      const model = genAI.getGenerativeModel({ model: config.ai.embeddingModel });
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (error: any) {
      console.error('Error generating embedding:', error.message);
      // Return zero vector fallback
      return Array.from({ length: 768 }, () => 0.0);
    }
  }

  /**
   * Multi-modal content processing: processes audio voice notes, images, or extracted text.
   */
  static async processMediaInput(
    mimeType: string,
    buffer: Buffer,
    promptInstruction: string
  ): Promise<string> {
    if (!config.ai.geminiApiKey || config.ai.geminiApiKey === 'test_gemini_key') {
      return `[Mock Transcribed/Analyzed Media Content]: Raw idea extracted from uploaded ${mimeType}.`;
    }

    try {
      const model = genAI.getGenerativeModel({ model: config.ai.routingModel });
      const base64Data = buffer.toString('base64');

      const result = await model.generateContent([
        {
          inlineData: {
            data: base64Data,
            mimeType,
          },
        },
        promptInstruction,
      ]);

      return result.response.text();
    } catch (error: any) {
      console.error('Error processing media with Gemini:', error.message);
      throw new Error(`Failed to extract text from media: ${error.message}`);
    }
  }

  private static getMockResponse(prompt: string, jsonMode: boolean): string {
    if (jsonMode) {
      if (prompt.includes('Classify the incoming message') || prompt.includes('INTENT_DETECTION')) {
        return JSON.stringify({
          intent: 'GENERATE_PROMPT',
          category: 'SOFTWARE_ENG',
          complexity: 'MEDIUM',
          extractedGoal: prompt.slice(0, 80),
          clarificationNeeded: false,
        });
      }
      if (prompt.includes('Evaluate the quality')) {
        return JSON.stringify({
          overallScore: 92,
          clarity: 95,
          contextDensity: 90,
          alignment: 92,
          actionability: 91,
          critique: 'Clean modular structure. All constraints and tools explicitly defined.',
        });
      }
      return JSON.stringify({ status: 'mock_success' });
    }

    return `# Role
Principal AI Systems Architect

# Objective
${prompt.slice(0, 100)}...

# Context
Active workspace project memory and requirements applied.

# Requirements
- Implement clean architectural boundaries
- Ensure high resilience and type safety

# Output Format
Markdown code structure with explanation.`;
  }
}
