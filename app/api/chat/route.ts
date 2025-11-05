import { createClient } from '@supabase/supabase-js';
import { HfInference } from '@huggingface/inference';
import { consumeStream, convertToModelMessages, streamText, type UIMessage } from "ai";

export const maxDuration = 30;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY!);

const SYSTEM_PROMPT = `
You are an AI assistant for Established Traffic Control, specializing in MUTCD-based bid estimation for traffic plans.
- Use retrieved context from MUTCD docs and historical bids/jobs.
- For bid estimates, prompt for missing details one at a time (e.g., "What DBE value do you want (e.g., 0%)?") if not provided.
- Key fields to prompt if missing: dbe, county, rated (RATED/NON-RATED), emergencyJob (true/false), personnel, onSiteJobHours, division (PUBLIC/PRIVATE), etc.
- Once all details gathered, estimate using formulas from data (e.g., markupRate=50%, calculate revenue/cost/grossProfit).
- Reference edge cases from instructions if relevant.
- Keep responses concise and professional.
`;

async function embedQuery(query: string): Promise<number[]> {
  const response = await hf.featureExtraction({
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    inputs: [{ text: query }] as Record<string, unknown>[],  // Object wrapper for single input (matches TS)
  });
  // Extract the vector from response (HF returns array or object)
  const embedding = Array.isArray(response) ? response[0] : (response as any)[0];
  return embedding as number[];
}

async function retrieveChunks(query: string, topK = 5): Promise<any[]> {
  try {
    const queryEmbedding = await embedQuery(query);
    const { data } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: topK,
    });
    console.log('Retrieved chunks:', data?.length || 0);  // Debug log
    return data || [];
  } catch (error) {
    console.error('Retrieval error:', error);
    return [];
  }
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  // Extract last user message content from parts (safe TS handling for UIMessagePart types)
  const lastMessage = messages[messages.length - 1];
  let userQuery = '';
  if (lastMessage?.role === 'user' && lastMessage.parts?.length > 0) {
    const firstPart = lastMessage.parts[0];
    if (firstPart.type === 'text') {
      userQuery = (firstPart as any).text || '';
    }
  }

  let enrichedMessages = convertToModelMessages(messages);

  if (userQuery) {
    const chunks = await retrieveChunks(userQuery);
    const context = chunks.map(c => `Source: ${c.metadata.source} (Chunk ${c.metadata.chunk_index})\n${c.content}`).join('\n\n');
    enrichedMessages = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
      ...enrichedMessages,
    ];
  }

  // Stream via Grok API
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: enrichedMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
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
