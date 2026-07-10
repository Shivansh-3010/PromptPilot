import { GeminiService } from '../services/gemini';

export type UserIntent =
  | 'GENERATE_PROMPT'
  | 'REFINE_PROMPT'
  | 'CREATE_PROJECT'
  | 'SWITCH_PROJECT'
  | 'LIST_PROJECTS'
  | 'SEARCH_HISTORY'
  | 'HELP_MENU'
  | 'GENERAL_CHAT';

export interface IntentAnalysis {
  intent: UserIntent;
  category: string; // e.g., SOFTWARE_ENG, MARKETING, BUSINESS, DATA_SCIENCE, AUTOMATION, GENERAL
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  extractedGoal: string;
  targetEntity?: string; // e.g., Project name to switch to or query string
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
}

export class IntentAgent {
  private static systemPrompt = `You are the Intent & Classification Agent inside PromptPilot, a WhatsApp-first AI Intent Translator & Prompt Architect.
Analyze the user's raw input (or audio transcription) and determine what action they want to perform.

Return ONLY a JSON object with this structure:
{
  "intent": "GENERATE_PROMPT" | "REFINE_PROMPT" | "CREATE_PROJECT" | "SWITCH_PROJECT" | "LIST_PROJECTS" | "SEARCH_HISTORY" | "HELP_MENU" | "GENERAL_CHAT",
  "category": "SOFTWARE_ENG" | "AI_SYSTEMS" | "WEB_APP" | "MOBILE_APP" | "BACKEND" | "DATA_SCIENCE" | "MARKETING" | "BUSINESS_PLAN" | "CONTENT_WRITING" | "GENERAL",
  "complexity": "LOW" | "MEDIUM" | "HIGH",
  "extractedGoal": "A clear, concise 1-sentence summary of what prompt or goal the user wants to achieve",
  "targetEntity": "Optional parameter (e.g., project name if switching, or search query)",
  "clarificationNeeded": false,
  "clarificationQuestion": "Only provide if the request is completely incomprehensible"
}

Rules:
- If input starts with /projects, /switch, or says "switch project to X", intent is SWITCH_PROJECT (or LIST_PROJECTS).
- If input starts with /new or says "create project X", intent is CREATE_PROJECT.
- If input starts with /search or asks "show previous prompts about X", intent is SEARCH_HISTORY.
- If user asks to modify, shorten, expand, or fix the last prompt, intent is REFINE_PROMPT.
- If user gives any rough idea or task (e.g. "Draft a python script for scraping" or "Need a SaaS marketing funnel"), intent is GENERATE_PROMPT.`;

  static async analyze(rawInput: string, previousMessageContext?: string): Promise<IntentAnalysis> {
    const prompt = `Analyze this user input from WhatsApp:
User Input: "${rawInput}"
Previous Context: "${previousMessageContext || 'None'}"`;

    try {
      const jsonResponse = await GeminiService.generateFlash(prompt, this.systemPrompt, true);
      const parsed = JSON.parse(jsonResponse);
      return {
        intent: parsed.intent || 'GENERATE_PROMPT',
        category: parsed.category || 'GENERAL',
        complexity: parsed.complexity || 'MEDIUM',
        extractedGoal: parsed.extractedGoal || rawInput,
        targetEntity: parsed.targetEntity,
        clarificationNeeded: Boolean(parsed.clarificationNeeded),
        clarificationQuestion: parsed.clarificationQuestion,
      };
    } catch (error) {
      console.error('Failed to parse IntentAgent JSON output, using heuristic fallback:', error);
      // Heuristic fallback
      const lower = rawInput.toLowerCase().trim();
      if (lower.startsWith('/projects') || lower.includes('switch project')) {
        return { intent: 'LIST_PROJECTS', category: 'GENERAL', complexity: 'LOW', extractedGoal: 'List projects', clarificationNeeded: false };
      }
      if (lower.startsWith('/new') || lower.includes('create project')) {
        return { intent: 'CREATE_PROJECT', category: 'GENERAL', complexity: 'LOW', extractedGoal: rawInput, clarificationNeeded: false };
      }
      if (lower.startsWith('/search')) {
        return { intent: 'SEARCH_HISTORY', category: 'GENERAL', complexity: 'LOW', extractedGoal: rawInput, clarificationNeeded: false };
      }
      return {
        intent: 'GENERATE_PROMPT',
        category: 'GENERAL',
        complexity: 'MEDIUM',
        extractedGoal: rawInput,
        clarificationNeeded: false,
      };
    }
  }
}
