import { consumeStream, convertToModelMessages, streamText, type UIMessage } from "ai"
import { createXai } from '@ai-sdk/xai'; 
import { createClient } from '@supabase/supabase-js';  

export const maxDuration = 30

const xai = createXai({ apiKey: process.env.GROK_API_KEY! }); 
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);  
// Assuming KG is in the same Supabase project as MUTCD
// If not, create a separate client: const kgSupabase = createClient(...)

const SYSTEM_PROMPT = `
You are an AI assistant for Established Traffic Control.
- Use MUTCD context for standards and rules.
- Use Knowledge Graph (KG) context for equipment counts, contracts, jobs, and quantities.
- KG has nodes (type, label, properties) and edges (source → relationship → target).
- Always cite sources: [MUTCD: Section X], [KG: Contract #123]
- For equipment queries (e.g., "How many Type 3s on JOB-789?"), use KG.
- For rules (e.g., "When to use Type 3?"), use MUTCD.
- Prompt for missing info one at a time.
- Keep responses concise and professional.
`;

async function embedQuery(query: string): Promise<number[]> {  
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
  return Array.isArray(result) ? result[0] : result;
}

// === MUTCD RAG ===
async function retrieveMUTCD(query: string, topK = 5): Promise<string> {  
  try {
    const queryEmbedding = await embedQuery(query);
    const { data } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: topK,
    });
    return data?.map(c => 
      `[MUTCD: ${c.metadata.source}, Chunk ${c.metadata.chunk_index}]\n${c.content}`
    ).join('\n\n') || '';
  } catch (error) {
    console.error('MUTCD retrieval error:', error);
    return '';
  }
}

// === KG SQL via LLM ===
async function retrieveKG(userQuery: string): Promise<string> {
  const sqlPrompt = `You are a SQL expert for a traffic control Knowledge Graph.
Tables:
- kg_nodes(id uuid, type text, label text, properties jsonb, embedding vector)
- kg_edges(id uuid, source_id uuid, target_id uuid, relationship text, properties jsonb)

Generate a SAFE SELECT query to answer: "${userQuery}"
- Use JOINs to traverse relationships.
- Access JSONB with ->> 'key'
- Return ONLY the SQL, no explanation.

Examples:
Q: "How many Type 3 barricades on contract JOB-789?"
→ SELECT n1.properties->>'quantity' FROM kg_edges e
   JOIN kg_nodes n1 ON e.source_id = n1.id
   JOIN kg_nodes n2 ON e.target_id = n2.id
   WHERE n1.type = 'equipment' AND n1.label ILIKE 'Type 3%'
     AND n2.type = 'contract' AND n2.label = 'JOB-789';

Q: "List all equipment on contract ABC123"
→ SELECT n1.label, n1.properties->>'quantity' FROM ...

Return ONLY SQL.`;

  try {
    const sqlResult = await streamText({
      model: xai('grok-4-fast'),
      prompt: sqlPrompt,
    });
    const sql = (await sqlResult.text()).trim();

    // Safety check
    if (!sql.toUpperCase().startsWith('SELECT') || /DROP|INSERT|UPDATE|DELETE/i.test(sql)) {
      return '[KG: Unsafe query blocked]';
    }

    const { data, error } = await supabase.rpc('execute_custom_sql', { sql_query: sql });

    if (error) {
      console.error('KG SQL error:', error);
      return '[KG: Query failed]';
    }

    if (!data || data.length === 0) return '[KG: No data found]';

    return data.map((row, i) => `[KG Result ${i+1}]\n${JSON.stringify(row, null, 2)}`).join('\n');
  } catch (error) {
    console.error('KG retrieval error:', error);
    return '[KG: Retrieval failed]';
  }
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const prompt = convertToModelMessages(messages);

  const lastUserMsg = messages[messages.length - 1];
  const userQuery = lastUserMsg?.role === 'user' 
    ? (lastUserMsg.parts?.[0] as any)?.text || '' 
    : '';

  let mutcdContext = '';
  let kgContext = '';

  if (userQuery) {
    // Parallel retrieval
    [mutcdContext, kgContext] = await Promise.all([
      retrieveMUTCD(userQuery),
      retrieveKG(userQuery)
    ]);
  }

  const fullContext = [mutcdContext, kgContext].filter(Boolean).join('\n\n');

  const enrichedPrompt = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${fullContext}` },
    ...prompt,
  ];

  const result = streamText({
    model: xai('grok-4-fast'),
    prompt: enrichedPrompt,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ isAborted }) => {
      if (isAborted) console.log("Stream aborted");
    },
    consumeSseStream: consumeStream,
  });
}
