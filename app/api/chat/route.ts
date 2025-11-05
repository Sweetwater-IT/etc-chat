import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { grok } from '@ai-sdk/xai';  // AI SDK + xAI for easy streaming

export const maxDuration = 30;

const SYSTEM_PROMPT = `
You are an AI assistant for Established Traffic Control, specializing in MUTCD-based bid estimation for traffic plans.
- Keep responses concise and professional.
`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  // Safe extraction for TS (uses AI SDK's conversion)
  let enrichedMessages = convertToModelMessages(messages);

  // Basic: Skip RAG for baseline test
  enrichedMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...enrichedMessages,
  ];

  console.log('Sending to Grok:', enrichedMessages.length, 'messages');  // Debug

  const result = streamText({
    model: grok('grok-4-fast'),  // Your model + AI SDK streaming
    messages: enrichedMessages,
    temperature: 0.7,
    maxTokens: 500,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ isAborted }) => {
      if (isAborted) console.log('Stream aborted');  // Debug
    },
    consumeSseStream: consumeStream,
  });
}
