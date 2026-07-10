import Groq from 'groq-sdk';
import { config } from '../config';

const groq = new Groq({ apiKey: config.ai.groqApiKey || 'mock_key' });

export class GroqService {
  /**
   * Fast fallback generation using Groq Llama 3 8B / 70B (free tier).
   */
  static async generateText(
    prompt: string,
    systemInstruction?: string,
    modelName = 'llama3-8b-8192'
  ): Promise<string> {
    if (!config.ai.groqApiKey || config.ai.groqApiKey === 'test_groq_key') {
      return `[Groq Fallback Output] Processed: ${prompt.slice(0, 80)}`;
    }

    try {
      const messages: any[] = [];
      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
      }
      messages.push({ role: 'user', content: prompt });

      const chatCompletion = await groq.chat.completions.create({
        messages,
        model: modelName,
        temperature: 0.3,
        max_tokens: 2048,
      });

      return chatCompletion.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error('Error generating text with Groq:', error.message);
      throw error;
    }
  }
}
