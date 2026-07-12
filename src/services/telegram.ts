import axios from 'axios';
import path from 'path';
import mime from 'mime-types';
import fileType from 'file-type';
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
    buttons: TelegramInteractiveRow[],
    headerText?: string,
    footerText?: string
  ): Promise<any> {
    if (!config.telegram.botToken || config.telegram.botToken === 'test_telegram_token') {
      console.log(`[Dev Telegram Mock] Sending Buttons to ${chatId}:\nBody: ${bodyText}\nButtons:`, JSON.stringify(buttons, null, 2));
      return { ok: true, result: { message_id: `mock_${Date.now()}` } };
    }

    const fullText = [headerText ? `*${headerText}*` : '', bodyText, footerText ? `_${footerText}_` : '']
      .filter(Boolean)
      .join('\n\n');

    const inlineKeyboard = buttons.map((btn) => [
      {
        text: btn.title,
        callback_data: btn.id.slice(0, 64), // Telegram max callback_data length is 64 bytes
      },
    ]);

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
   * Fetches raw media bytes from Telegram Bot API using a file_id and performs robust multi-layer MIME detection.
   */
  static async downloadMediaBytes(
    fileId: string,
    telegramFileName?: string,
    telegramMimeType?: string
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    try {
      // Step 1: Get file path from Telegram
      const getFileResp = await axios.get(`${this.baseUrl}/getFile`, {
        params: { file_id: fileId },
      });

      if (!getFileResp.data.ok || !getFileResp.data.result?.file_path) {
        throw new Error('Telegram getFile API did not return a valid file_path.');
      }

      const filePath: string = getFileResp.data.result.file_path;
      const fileUrl = `${this.fileBaseUrl}/${filePath}`;
      const fileResponse = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
      });
      const buffer = Buffer.from(fileResponse.data);

      const finalFileName = telegramFileName || filePath.split('/').pop() || `file_${Date.now()}`;
      const extFromFileName = path.extname(finalFileName).toLowerCase().replace('.', '');
      const extFromPath = path.extname(filePath).toLowerCase().replace('.', '');
      const ext = extFromFileName || extFromPath;

      // Layer 1: Magic byte detection via file-type package
      const magicResult = await fileType.fromBuffer(buffer);
      const magicMime = (magicResult?.mime as string) || null;

      // Layer 2: Extension lookup via mime-types package
      const extMime = (ext && (mime.lookup(ext) as string)) || null;

      // Layer 3: Explicit extension priority mapping (to resolve generic or ambiguous signatures like zip vs docx/xlsx/pptx)
      const extToMimeMap: Record<string, string> = {
        pdf: 'application/pdf',
        txt: 'text/plain',
        md: 'text/markdown',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        csv: 'text/csv',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        mp3: 'audio/mpeg',
        ogg: 'audio/ogg',
        oga: 'audio/ogg',
        wav: 'audio/wav',
      };

      const mappedExtMime = ext ? extToMimeMap[ext] : null;

      let finalMimeType = 'application/octet-stream';

      if (magicMime && magicMime !== 'application/octet-stream') {
        // If magic detected application/zip but extension specifically points to an Office OpenXML docx/xlsx/pptx, prefer specific MIME
        if (magicMime === 'application/zip' && (ext === 'docx' || ext === 'xlsx' || ext === 'pptx')) {
          finalMimeType = mappedExtMime || extMime || magicMime;
        } else {
          finalMimeType = magicMime;
        }
      } else if (mappedExtMime) {
        finalMimeType = mappedExtMime;
      } else if (extMime && extMime !== 'application/octet-stream') {
        finalMimeType = extMime;
      } else if (telegramMimeType && telegramMimeType !== 'application/octet-stream') {
        finalMimeType = telegramMimeType;
      }

      console.log(`[MediaIngestion] Downloaded & analyzed file:`, {
        originalFilename: finalFileName,
        fileExtension: ext || 'unknown',
        telegramMimeType: telegramMimeType || 'none',
        magicByteMime: magicMime || 'none',
        extensionLookupMime: mappedExtMime || extMime || 'none',
        detectedMimeType: finalMimeType,
        bufferSize: buffer.length,
      });

      return {
        buffer,
        mimeType: finalMimeType,
        fileName: finalFileName,
      };
    } catch (error: any) {
      console.error('Error downloading media from Telegram:', error.response?.data || error.message);
      throw new Error(`Failed to download media from Telegram: ${error.message}`);
    }
  }
}
