import { consumeStream, convertToModelMessages, streamText, type UIMessage } from "ai"
import { createXai } from '@ai-sdk/xai'; // Create instance for key
import { createClient } from '@supabase/supabase-js'; // Add this for Supabase

export const maxDuration = 30

const xai = createXai({ apiKey: process.env.GROK_API_KEY! }); // Inject key
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!); // Add this for Supabase client
const bidxSupabase = createClient(process.env.BIDX_SUPABASE_URL!, process.env.BIDX_SUPABASE_SERVICE_KEY!);

const SYSTEM_PROMPT = `
You are an AI assistant for Established Traffic Control, specializing in MUTCD-based bid estimation for traffic plans.
- Use the retrieved context from MUTCD docs and historical bids/jobs to answer accurately.
- Always cite sources from the context at the end of your response (e.g., "[Source: MUTCD-2023, Chunk 106]").
- For bid estimates, prompt for missing details one at a time (e.g., "What DBE value do you want (e.g., 0%)?").
- Key fields to prompt if missing: dbe, county, rated (RATED/NON-RATED), emergencyJob (true/false), personnel, onSiteJobHours, division (PUBLIC/PRIVATE), etc.
- Once all details gathered, estimate using formulas from data (e.g., markupRate=50%, calculate revenue/cost/gross_profit).
- Reference edge cases from instructions if relevant.
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
  return Array.isArray(result) ? result[0] : result; // 384-dim vector
}

async function retrieveChunks(query: string, topK = 5): Promise<any[]> {
  try {
    const queryEmbedding = await embedQuery(query);
    const { data } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: topK,
    });
    console.log('Retrieved chunks:', data?.length || 0); // Debug
    return data || [];
  } catch (error) {
    console.error('Retrieval error:', error);
    return [];
  }
}

async function generateSQLAndExecute(userQuery: string): Promise<string> {
  try {
    // Prompt Grok to generate SQL for Bidx data
    const sqlPrompt = `You are a SQL expert. Generate a safe SELECT query for the following user request on Bidx data (views: jobs_complete, estimate_complete).
    Use jobs_complete (includes estimate data). Only SELECT, no INSERT/UPDATE/DELETE.
    Filter by status='WON' for historical, or use available_jobs for open bids.
    Handle limits (e.g., last 6), conditions (e.g., flagging > 400), and ordering (e.g., created_at DESC).
    Return ONLY the SQL query, no explanation or markdown.
    Request: ${userQuery}`;

    const sqlResult = await streamText({
      model: xai('grok-4-fast'),
      prompt: sqlPrompt,
    });
    const sql = await sqlResult.text().then(text => text.trim());  // Use .then() for Promise resolution
    console.log('Generated SQL:', sql); // Debug

    // Validate SQL (basic safety)
    if (!sql.toUpperCase().startsWith('SELECT') || sql.toUpperCase().includes('DROP') || sql.toUpperCase().includes('INSERT')) {
      console.error('Unsafe SQL generated:', sql);
      return 'Error: Unsafe SQL query.';
    }

    // Execute on Bidx Supabase
    const { data, error } = await bidxSupabase.rpc('execute_custom_sql', { sql_query: sql });
    if (error) {
      console.error('SQL execution error:', error);
    return 'Error querying Bidx data.';
    }

    // Summarize results for prompt
    const summary = data?.map(row => {
      const admin = row.admin_data ? JSON.parse(row.admin_data) : {};
      return `Job #${row.job_number || 'N/A'} (ID ${row.id}): Revenue $${row.total_revenue || 'N/A'}, Cost $${row.total_cost || 'N/A'}, County ${admin.county?.name || 'N/A'}, Date ${row.created_at?.slice(0, 10) || 'N/A'}`;
    }).join('\n') || 'No matching data found.';

    console.log('Retrieved Bidx data:', data?.length || 0);
    return summary;
  } catch (error) {
    console.error('Text-to-SQL error:', error);
    return '';
  }
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const prompt = convertToModelMessages(messages)

  // Extract last user query for RAG
  const lastMessage = messages[messages.length - 1];
  let userQuery = '';
  if (lastMessage?.role === 'user') {
    userQuery = (lastMessage.parts?.[0] as any)?.text || '';
  }

  let enrichedPrompt = prompt;
  let mutcdContext = '';
  let bidxContext = '';

  if (userQuery) {
    // MUTCD retrieval
    const chunks = await retrieveChunks(userQuery);
    mutcdContext = chunks.map(c => `Source: ${c.metadata.source} (Chunk ${c.metadata.chunk_index})\n${c.content}`).join('\n\n');

    // Bidx retrieval (text-to-SQL)
    bidxContext = await generateSQLAndExecute(userQuery);
  }

  const fullContext = [mutcdContext, bidxContext].filter(Boolean).join('\n\n');

  enrichedPrompt = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${fullContext}` },
    ...prompt,
  ];

  const result = streamText({
    model: xai('grok-4-fast'),
    prompt: enrichedPrompt,
    abortSignal: req.json,
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
