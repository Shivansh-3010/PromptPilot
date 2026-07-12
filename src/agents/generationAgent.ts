import { GeminiService } from '../services/gemini';
import { GroqService } from '../services/groq';

export interface PromptGenerationInput {
  rawIdea: string;
  category: string;
  complexity: string;
  projectName: string;
  projectDescription?: string;
  semanticContextChunks: string[];
  refinementFeedback?: string;
  previousDraft?: string;
}

export class GenerationAgent {
  private static getSystemInstruction(category: string, complexity: string): string {
    return `You are PromptPilot's Universal Prompt Architect & Intent Translator.
Your mission is to transform a user's rough idea into an elite, production-ready, context-aware prompt tailored for AI execution.

You strictly enforce the **PromptPilot 12-Point Framework**:
1. [ROLE]: Define the precise professional persona and domain expertise required.
2. [OBJECTIVE]: State the definitive goal with zero ambiguity.
3. [CONTEXT]: Synthesize project goals and any retrieved background memory/rules.
4. [INPUTS & VARIABLES]: Explicitly list all dynamic parameters needed.
5. [REQUIREMENTS]: Step-by-step technical or creative deliverables.
6. [CONSTRAINTS]: Boundary limitations (e.g., tech stack choices, tone limits, performance goals).
7. [TOOLS & ENVIRONMENT]: Specify target frameworks, libraries, APIs, or AI tools.
8. [REASONING APPROACH]: Provide explicit Chain-of-Thought (CoT) / step-by-step reasoning instructions.
9. [OUTPUT FORMAT]: Define exact output structure (e.g., Markdown blocks, JSON schema, table layout).
10. [QUALITY STANDARDS]: Definition of done and architectural/writing best practices.
11. [SUCCESS CRITERIA]: Measurable outcomes that prove the response is correct.
12. [ASSUMPTIONS & EDGE CASES]: Explicitly note what assumptions were made and how edge cases should be handled.

Domain Category: ${category}
Task Complexity: ${complexity}

Output ONLY the final formatted Markdown prompt. Do not add introductory chit-chat before "# Role".`;
  }

  static async generatePrompt(input: PromptGenerationInput): Promise<string> {
    const contextSection = input.semanticContextChunks.length > 0
      ? input.semanticContextChunks.join('\n')
      : 'No specific vector memories found for this project.';

    let promptQuery = `Project Workspace: "${input.projectName}" (${input.projectDescription || 'No description'})
Retrieved Project Context / Memories:
---
${contextSection}
---

User's Raw Idea / Request:
"${input.rawIdea}"`;

    if (input.refinementFeedback && input.previousDraft) {
      promptQuery += `\n\n---
PREVIOUS DRAFT:
${input.previousDraft}

USER REFINEMENT INSTRUCTIONS:
Please adjust the prompt above according to this feedback: "${input.refinementFeedback}"`;
    }

    try {
      // Primary High-Intelligence Generation with Gemini Pro
      const generated = await GeminiService.generatePro(
        promptQuery,
        this.getSystemInstruction(input.category, input.complexity)
      );

      if (!generated || generated.length < 50) {
        throw new Error('Generated prompt too short or empty.');
      }

      return generated.trim();
    } catch (error) {
      console.error('Gemini Pro generation failed, falling back to Groq Llama 3:', error);
      // Fast fallback using Groq Llama 3 8B
      const fallback = await GroqService.generateText(
        `${this.getSystemInstruction(input.category, input.complexity)}\n\n${promptQuery}`
      );
      return fallback.trim();
    }
  }
}
