import axios from 'axios';
import { config } from '../config';

export interface TelegramInteractiveRow {
  id: string;
  title: string;
  description?: string;
}

export interface TelegramInteractiveSection {
  title: string;
  rows: TelegramInteractiveRow[];
}

export class TelegramService {
  private static get baseUrl() {
    return `https://api.telegram.org/bot${config.telegram.botToken}`;
  }

  private static get fileBaseUrl() {
    return `https://api.telegram.org/file/bot${config.telegram.botToken}`;
  }

  /**
   * Sends a standard text message to a Telegram chat.
   * Automatically retries as plain text if Markdown parsing fails due to unescaped symbols.
   */
  static async sendTextMessage(chatId: string, text: string): Promise<any> {
    if (!config.telegram.botToken || config.telegram.botToken === 'test_telegram_token') {
      console.log(`[Dev Telegram Mock] Sending Text to ${chatId}:\n${text}\n---`);
      return { ok: true };
    }

    const MAX_LENGTH = 4000;

    const chunks: string[] = [];

    let remaining = text;

    while (remaining.length > MAX_LENGTH) {
      let splitAt = remaining.lastIndexOf('\n\n', MAX_LENGTH);

      if (splitAt === -1) {
        splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);
      }

      if (splitAt === -1) {
        splitAt = remaining.lastIndexOf(' ', MAX_LENGTH);
      }

      if (splitAt === -1) {
        splitAt = MAX_LENGTH;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    let lastResponse: any;

    for (const chunk of chunks) {
      try {
        const response = await axios.post(`${this.baseUrl}/sendMessage`, {
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        });

        lastResponse = response.data;
      } catch (error: any) {
        const fallbackResponse = await axios.post(`${this.baseUrl}/sendMessage`, {
          chat_id: chatId,
          text: chunk,
        });

        lastResponse = fallbackResponse.data;
      }
    }

    return lastResponse;
  }

  /**
   * Sends an interactive message with inline reply buttons.
   */
  static async sendButtonsMessage(
    chatId: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
    headerText?: string,
    footerText?: string
  ): Promise<any> {
    if (!config.telegram.botToken || config.telegram.botToken === 'test_telegram_token') {
      console.log(`[Dev Telegram Mock] Sending Buttons to ${chatId}:\nBody: ${bodyText}\nButtons:`, buttons);
      return { ok: true, result: { message_id: `mock_${Date.now()}` } };
    }

    const fullText = [headerText ? `*${headerText}*` : '', bodyText, footerText ? `_${footerText}_` : '']
      .filter(Boolean)
      .join('\n\n');

    // Group buttons into rows (e.g. up to 2 per row)
    const inlineKeyboard: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < buttons.length; i += 2) {
      const row = buttons.slice(i, i + 2).map((btn) => ({
        text: btn.title,
        callback_data: btn.id.slice(0, 64), // Telegram max callback_data is 64 bytes
      }));
      inlineKeyboard.push(row);
    }

    try {
      const response = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: chatId,
        text: fullText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      });
      return response.data;
    } catch (error: any) {
      // Fallback without parse_mode if needed
      const fallbackResponse = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: chatId,
        text: fullText,
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      });
      return fallbackResponse.data;
    }
  }

  /**
   * Sends an interactive list menu using Inline Keyboards grouped by section.
   */
  static async sendListMessage(
    chatId: string,
    bodyText: string,
    buttonText: string,
    sections: TelegramInteractiveSection[],
    headerText?: string,
    footerText?: string
  ): Promise<any> {
    if (!config.telegram.botToken || config.telegram.botToken === 'test_telegram_token') {
      console.log(`[Dev Telegram Mock] Sending List to ${chatId}:\nBody: ${bodyText}\nSections:`, JSON.stringify(sections, null, 2));
      return { ok: true, result: { message_id: `mock_${Date.now()}` } };
    }

    const fullText = [headerText ? `*${headerText}*` : '', bodyText, footerText ? `_${footerText}_` : '']
      .filter(Boolean)
      .join('\n\n');

    const inlineKeyboard: { text: string; callback_data: string }[][] = [];

    for (const section of sections) {
      for (const row of section.rows) {
        inlineKeyboard.push([
          {
            text: row.title,
            callback_data: row.id.slice(0, 64),
          },
        ]);
      }
    }

    try {
      const response = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: chatId,
        text: fullText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      });
      return response.data;
    } catch (error: any) {
      const fallbackResponse = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: chatId,
        text: fullText,
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      });
      return fallbackResponse.data;
    }
  }

  /**
   * Fetches raw media bytes from Telegram Bot API using a file_id.
   * Used for processing audio notes, voice messages, PDFs, and photos sent via Telegram.
   */
  static async downloadMediaBytes(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    try {
      // Step 1: Get file path from Telegram
      const getFileResp = await axios.get(`${this.baseUrl}/getFile`, {
        params: { file_id: fileId },
      });

      if (!getFileResp.data.ok || !getFileResp.data.result?.file_path) {
        throw new Error('Telegram getFile API did not return a valid file_path.');
      }

      const filePath = getFileResp.data.result.file_path;

      // Infer mimeType from extension if needed
      let mimeType = 'application/octet-stream';
      if (filePath.endsWith('.oga') || filePath.endsWith('.ogg')) mimeType = 'audio/ogg';
      else if (filePath.endsWith('.mp3')) mimeType = 'audio/mpeg';
      else if (filePath.endsWith('.pdf')) mimeType = 'application/pdf';
      else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
      else if (filePath.endsWith('.png')) mimeType = 'image/png';

      // Step 2: Download raw binary bytes
      const fileUrl = `${this.fileBaseUrl}/${filePath}`;
      const fileResponse = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
      });

      return {
        buffer: Buffer.from(fileResponse.data),
        mimeType,
      };
    } catch (error: any) {
      console.error('Error downloading media from Telegram:', error.response?.data || error.message);
      throw new Error(`Failed to download media from Telegram: ${error.message}`);
    }
  }
}
