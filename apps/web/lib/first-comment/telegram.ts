import { callBotApi } from '@/lib/telegram';

export type TelegramFirstCommentOutcome = 'posted' | 'unsupported_chat';

export async function postTelegramFirstComment(input: {
  botToken: string;
  chatId: string;
  messageId: number;
  text: string;
}): Promise<TelegramFirstCommentOutcome> {
  const chat = await callBotApi(input.botToken, 'getChat', { json: { chat_id: input.chatId } });
  if (chat.type === 'channel') return 'unsupported_chat';
  await callBotApi(input.botToken, 'sendMessage', {
    json: { chat_id: input.chatId, text: input.text, reply_parameters: { message_id: input.messageId } },
  });
  return 'posted';
}
