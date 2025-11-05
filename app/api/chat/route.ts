import { consumeStream, convertToModelMessages, streamText, type UIMessage } from "ai"
import { createXai } from '@ai-sdk/xai'; // Create instance for key
import { createClient } from '@supabase/supabase-js';  // Add this for Supabase

export const maxDuration = 30

const xai = createXai({ apiKey: process.env.GROK_API_KEY! }); // Inject key

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);  // Add this for Supabase client
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

async function retrieveBidxData(userQuery: string): Promise<string> {
  try {
    // Dynamic parsing: Extract county, month, or "last/recent"
    const countyMatch = userQuery.match(/(bucks|montgomery|bedford|county\s+(\w+))/i);
    const county = countyMatch ? (countyMatch[1] || countyMatch[2]).toLowerCase() : null;
    const monthMatch = userQuery.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|1|2|3|4|5|6|7|8|9|10|11|12)/i);
    const monthName = monthMatch ? monthMatch[1].toLowerCase() : null;
    const monthNum = monthName ? new Date(`${monthName} 1, 2024`).getMonth() + 1 : null;
    const yearMatch = userQuery.match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
    const lastMatch = userQuery.match(/last|recent|top\s+3?/i);  // Detect "last 3 bids"

    // Query jobs_complete (historical WON jobs/estimates)
    let query = bidxSupabase.from('jobs_complete').select('id, total_revenue, total_cost, admin_data, created_at, job_number').eq('status', 'WON').limit(lastMatch ? 3 : 5).order('created_at', { ascending: false });  // Top 3 recent if "last"
    if (county) {
      query = query.eq('admin_data->county->name', county.charAt(0).toUpperCase() + county.slice(1));
    }
    if (monthNum) {
      const startDate = `${year}-${monthNum.toString().padStart(2, '0')}-01`;
      const endDate = `${year}-${monthNum.toString().padStart(2, '0')}-31`;
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data } = await query;

    console.log('Retrieved Bidx data:', data?.length || 0);
    return data?.map(row => {
      const admin = JSON.parse(row.admin_data || '{}');
      return `Job #${row.job_number} (ID ${row.id}): Revenue $${row.total_revenue || 'N/A'}, Cost $${row.total_cost || 'N/A'}, County ${admin.county?.name || 'N/A'}, Date ${row.created_at.slice(0, 10)}`;
    }).join('\n') || 'No matching jobs found - try more details like county or date.';
  } catch (error) {
    console.error('Bidx retrieval error:', error);
    return '';
  }
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const prompt = convertToModelMessages(messages)

  // Extract last user query for RAG  // Add this block
  const lastMessage = messages[messages.length - 1];
  let userQuery = '';
  if (lastMessage?.role === 'user') {
    userQuery = (lastMessage.parts?.[0] as any)?.text || '';
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
