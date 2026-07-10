import axios from 'axios';
import { config } from '../config';

export interface WhatsAppInteractiveRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppInteractiveSection {
  title: string;
  rows: WhatsAppInteractiveRow[];
}

export interface WhatsAppButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export class WhatsAppService {
  private static get headers() {
    return {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private static get baseUrl() {
    return `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.whatsapp.phoneNumberId}`;
  }

  /**
   * Sends a standard text message to a WhatsApp recipient.
   */
  static async sendTextMessage(to: string, text: string): Promise<any> {
    if (!config.whatsapp.accessToken || config.whatsapp.accessToken === 'test_whatsapp_token') {
      console.log(`[Dev WhatsApp Mock] Sending Text to ${to}:\n${text}\n---`);
      return { messages: [{ id: `mock_${Date.now()}` }] };
    }

    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      };

      const response = await axios.post(`${this.baseUrl}/messages`, payload, { headers: this.headers });
      return response.data;
    } catch (error: any) {
      console.error('Error sending WhatsApp text message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Sends an interactive quick reply button message (Max 3 buttons).
   */
  static async sendButtonsMessage(
    to: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
    headerText?: string,
    footerText?: string
  ): Promise<any> {
    if (!config.whatsapp.accessToken || config.whatsapp.accessToken === 'test_whatsapp_token') {
      console.log(`[Dev WhatsApp Mock] Sending Buttons to ${to}:\nBody: ${bodyText}\nButtons:`, buttons);
      return { messages: [{ id: `mock_${Date.now()}` }] };
    }

    try {
      const formattedButtons: WhatsAppButton[] = buttons.slice(0, 3).map((btn) => ({
        type: 'reply',
        reply: {
          id: btn.id,
          title: btn.title.slice(0, 20), // WhatsApp enforces max 20 characters per button title
        },
      }));

      const interactivePayload: any = {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: formattedButtons },
      };

      if (headerText) {
        interactivePayload.header = { type: 'text', text: headerText };
      }
      if (footerText) {
        interactivePayload.footer = { text: footerText };
      }

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: interactivePayload,
      };

      const response = await axios.post(`${this.baseUrl}/messages`, payload, { headers: this.headers });
      return response.data;
    } catch (error: any) {
      console.error('Error sending WhatsApp buttons message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Sends an interactive list menu message (Max 10 rows across sections).
   */
  static async sendListMessage(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: WhatsAppInteractiveSection[],
    headerText?: string,
    footerText?: string
  ): Promise<any> {
    if (!config.whatsapp.accessToken || config.whatsapp.accessToken === 'test_whatsapp_token') {
      console.log(`[Dev WhatsApp Mock] Sending List to ${to}:\nBody: ${bodyText}\nSections:`, JSON.stringify(sections, null, 2));
      return { messages: [{ id: `mock_${Date.now()}` }] };
    }

    try {
      const interactivePayload: any = {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText.slice(0, 20),
          sections: sections.map((sec) => ({
            title: sec.title.slice(0, 24),
            rows: sec.rows.slice(0, 10).map((row) => ({
              id: row.id,
              title: row.title.slice(0, 24),
              description: row.description ? row.description.slice(0, 72) : undefined,
            })),
          })),
        },
      };

      if (headerText) {
        interactivePayload.header = { type: 'text', text: headerText };
      }
      if (footerText) {
        interactivePayload.footer = { text: footerText };
      }

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: interactivePayload,
      };

      const response = await axios.post(`${this.baseUrl}/messages`, payload, { headers: this.headers });
      return response.data;
    } catch (error: any) {
      console.error('Error sending WhatsApp list message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetches raw media bytes from Meta Graph API using a media ID.
   * Used for processing audio notes, PDFs, and images sent via WhatsApp.
   */
  static async downloadMediaBytes(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    try {
      // Step 1: Query media ID to get download URL
      const infoResponse = await axios.get(
        `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${mediaId}`,
        { headers: this.headers }
      );

      const mediaUrl = infoResponse.data.url;
      const mimeType = infoResponse.data.mime_type;

      // Step 2: Download the raw bytes
      const fileResponse = await axios.get(mediaUrl, {
        headers: this.headers,
        responseType: 'arraybuffer',
      });

      return {
        buffer: Buffer.from(fileResponse.data),
        mimeType,
      };
    } catch (error: any) {
      console.error('Error downloading media from WhatsApp:', error.response?.data || error.message);
      throw new Error(`Failed to download media: ${error.message}`);
    }
  }
}
