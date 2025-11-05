import { consumeStream, convertToModelMessages, streamText, type UIMessage } from "ai"
import { createXai } from '@ai-sdk/xai'; // Create instance for key
import { createClient } from '@supabase/supabase-js';  // Add this for Supabase

export const maxDuration = 30

const xai = createXai({ apiKey: process.env.GROK_API_KEY! }); // Inject key

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);  // Add this for Supabase client

const SYSTEM_PROMPT = `  // Add this system prompt with context placeholder
You are an AI assistant for Established Traffic Control, specializing in MUTCD-based bid estimation for traffic plans.
- Use the retrieved context from MUTCD docs and historical bids/jobs to answer accurately.
- For bid estimates, prompt for missing details one at a time (e.g., "What DBE value do you want (e.g., 0%)?").
- Key fields to prompt if missing: dbe, county, rated (RATED/NON-RATED), emergencyJob (true/false), personnel, onSiteJobHours, division (PUBLIC/PRIVATE), etc.
- Once all details gathered, estimate using formulas from data (e.g., markupRate=50%, calculate revenue/cost/gross_profit).
- Reference edge cases from instructions if relevant.
- Keep responses concise and professional.
`;

async function embedQuery(query: string): Promise<number[]> {  // Add this function
  const response = await fetch('https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: [query] }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('HF full response:', errorBody);
    throw new Error(`HF Embedding error: ${response.status} - ${response.statusText}`);
  }

  const result = await response.json();
  return Array.isArray(result) ? result[0] : result;  // 384-dim vector
}

async function retrieveChunks(query: string, topK = 5): Promise<any[]> {  // Add this function
  try {
    const queryEmbedding = await embedQuery(query);
    const { data } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: topK,
    });
    console.log('Retrieved chunks:', data?.length || 0);  // Debug
    return data || [];
  } catch (error) {
    console.error('Retrieval error:', error);
    return [];
  }
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const prompt = convertToModelMessages(messages)

  // Extract last user query for RAG  // Add this block
  const lastMessage = messages[messages.length - 1];
  let userQuery = '';
  if (lastMessage?.role === 'user') {
    userQuery = lastMessage.parts?.[0]?.text || '';
  }

  let enrichedPrompt = prompt;

  if (userQuery) {  // Add this if block for RAG
    const chunks = await retrieveChunks(userQuery);
    const context = chunks.map(c => `Source: ${c.metadata.source} (Chunk ${c.metadata.chunk_index})\n${c.content}`).join('\n\n');
    enrichedPrompt = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
      ...prompt,
    ];
  }

  const result = streamText({
    model: xai('grok-4-fast'), // Use instance
    prompt: enrichedPrompt,  // Pass enriched prompt with context
    abortSignal: req.signal,
  })

  return result.toUIMessageStreamResponse({
    onFinish: async ({ isAborted }) => {
      if (isAborted) {
        console.log("Aborted")
      }
    },
    consumeSseStream: consumeStream,
  })
}
