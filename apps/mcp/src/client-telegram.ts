import type { PostEngineerClient } from './client.js';
import type { ResponseOf } from './contracts/endpoint.js';
import { parseContractResponse } from './contract-response.js';
import { connectTelegramAccount as connectTelegramAccountContract } from './contracts/accounts.js';
import { redactSecretFromError } from './secret-redaction.js';

export async function connectTelegramAccount(
  client: PostEngineerClient,
  botToken: string,
  chatId: string,
  chatType: 'channel' | 'group',
): Promise<ResponseOf<typeof connectTelegramAccountContract>> {
  try {
    const raw = await client.request(
      '/api/telegram-connect',
      { method: 'POST', headers: client.getHeaders(), body: JSON.stringify({ botToken, chatId, chatType }) },
      'connect Telegram account',
    );
    return parseContractResponse(connectTelegramAccountContract, raw);
  } catch (error) {
    throw redactSecretFromError(error, botToken);
  }
}
