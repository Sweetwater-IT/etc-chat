import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createXai } from '@ai-sdk/xai';  // Correct export for v1+

export const maxDuration = 30;

const SYSTEM_PROMPT = `
You are an AI assistant for Established Traffic Control, specializing in MUTCD-based bid estimation for traffic plans.
- Keep responses concise and professional.
`;

const xai = createXai({ apiKey: process.env.GROK_API_KEY! });  // Inject key

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  // Safe extraction for TS
  const lastMessage = messages[messages.length - 1];
  let userQuery = '';
  if (lastMessage?.role === 'user' && lastMessage.parts?.length > 0) {
    const firstPart = lastMessage.parts[0];
    if (firstPart.type === 'text') {
      userQuery = firstPart.text || '';
    }
  }

  let enrichedMessages = convertToModelMessages(messages);

  // Basic: Skip RAG for baseline test
  enrichedMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...enrichedMessages,
  ];

  console.log('Sending to Grok:', enrichedMessages.length, 'messages');  // Debug

  const result = streamText({
    model: xai('grok-4-fast'),  // Your model + SDK streaming
    messages: enrichedMessages,
    temperature: 0.7,
    max_Tokens: 500,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ isAborted }) => {
      if (isAborted) console.log('Stream aborted');  // Debug
    },
    consumeSseStream: consumeStream,
  });
}
