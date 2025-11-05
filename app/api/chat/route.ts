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

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-4-fast',
      messages: enrichedMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 500,  // Snake_case for xAI API (no SDK type error)
    }),
  });

  console.log('Grok response status:', response.status);  // Debug

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Grok full error:', errorBody);
    throw new Error(`Grok API error: ${response.statusText}`);
  }

  // Adapt SSE to ai SDK stream
  const stream = new ReadableStream({
    start(controller) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const pump = () => {
        reader?.read().then(({ done, value }) => {
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(new TextEncoder().encode(delta));
                }
              } catch {}
            }
          }
          pump();
        }).catch(err => controller.error(err));
      };
      pump();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
