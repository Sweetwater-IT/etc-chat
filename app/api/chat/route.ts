import {
  consumeStream,
  convertToModelMessages,
  streamText,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { createXai } from "@ai-sdk/xai";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

// === SUPABASE CLIENTS ===
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
const bidxSupabase = createClient(
  process.env.BIDX_SUPABASE_URL!,
  process.env.BIDX_SUPABASE_SERVICE_KEY!
);
const xai = createXai({ apiKey: process.env.GROK_API_KEY! });

// === SYSTEM PROMPT ===
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

// === EMBEDDING FUNCTION (HF Router - sentences payload) ===
async function embedQuery(query: string): Promise<number[]> {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sentences: [query] }), // FIXED: sentences array for router similarity pipeline
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("HF full response:", errorBody);
    throw new Error(`HF Embedding error: ${response.status} - ${response.statusText}`);
  }

  const result = await response.json();
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

// === MUTCD CHUNK TYPE ===
interface MutcdChunk {
  metadata: { source: string; chunk_index: number };
  content: string;
}

// === MUTCD RAG ===
async function retrieveMUTCD(query: string, topK = 5): Promise<string> {
  try {
    const queryEmbedding = await embedQuery(query);
    const { data }: { data: MutcdChunk[] | null } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: topK,
    });

    return (
      data?.map(
        (c: MutcdChunk) =>
          `[MUTCD: ${c.metadata.source}, Chunk ${c.metadata.chunk_index}]\n${c.content}`
      ).join("\n\n") ?? ""
    );
  } catch (error) {
    console.error("MUTCD retrieval error:", error);
    return "";
  }
}

// === SCHEMA FETCHER (All 6 Product Lines + Status) ===
let cachedSchema: string | null = null;
async function getSchema(): Promise<string> {
  if (cachedSchema) return cachedSchema;

  try {
    const { data, error } = await bidxSupabase
      .from("information_schema.columns")
      .select("table_name, column_name, data_type")
      .in("table_name", ["estimate_complete", "jobs_complete"])
      .in("column_name", [
        "admin_data",
        "equipment_rental",
        "mpt_rental",
        "permanent_signs",
        "sale_items",
        "service_work",
        "flagging",
        "status",
      ]);

    if (error || !data) return "Schema unavailable";

    cachedSchema = data
      .map(row => `${row.table_name}.${row.column_name}: ${row.data_type}`)
      .join("\n");

    return cachedSchema;
  } catch {
    return "Schema fetch failed";
  }
}

// === KG SQL VIA LLM (Schema-Driven + Anti-Hallucination) ===
async function retrieveKG(userQuery: string): Promise<string> {
  const schema = await getSchema();

  const sqlPrompt = `You are a SQL expert. USE ONLY THESE COLUMNS. NO OTHER COLUMNS. NO "items". NO "products". ONLY SCHEMA.

SCHEMA (EXACT COLUMNS ONLY):
${schema}

USER QUERY: "${userQuery}"

RULES:
- "bid", "estimate", "pending" → estimate_complete
- "job", "won", "completed" → jobs_complete
- JSON arrays: json_array_elements() + LATERAL
- Filter: item->>'name' or item->>'designation'
- Contract: admin_data->>'contractNumber'
- Return ONLY SQL. No explanation. No semicolon.

Generate SQL now.`;

  try {
    const sqlResult = await streamText({
      model: xai("grok-4-fast"),
      prompt: sqlPrompt,
    });

    let sql = (await sqlResult.text).trim();
    if (sql.endsWith(";")) sql = sql.slice(0, -1).trim();

    if (!sql.toUpperCase().startsWith("SELECT") || /DROP|INSERT|UPDATE|DELETE/i.test(sql)) {
      return "[KG: Unsafe query blocked]";
    }

    const { data, error } = await bidxSupabase.rpc("execute_custom_sql", { sql_query: sql });

    if (error) {
      console.error("KG SQL error:", error);
      return `[KG: Query failed - ${error.message}]`;
    }

    if (!data || data.length === 0) return "[KG: No data found]";

    return data
      .map((row: any, i: number) => `[KG Result ${i + 1}]\n${JSON.stringify(row, null, 2)}`)
      .join("\n");
  } catch (error) {
    console.error("KG retrieval error:", error);
    return "[KG: Retrieval failed]";
  }
}

// === POST HANDLER ===
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const prompt = convertToModelMessages(messages);

  const lastUserMsg = messages[messages.length - 1];
  const userQuery =
    lastUserMsg?.role === "user" ? ((lastUserMsg.parts?.[0] as any)?.text ?? "") : "";

  let mutcdContext = "";
  let kgContext = "";

  if (userQuery) {
    [mutcdContext, kgContext] = await Promise.all([
      retrieveMUTCD(userQuery),
      retrieveKG(userQuery),
    ]);
  }

  const fullContext = [mutcdContext, kgContext].filter(Boolean).join("\n\n");

  const enrichedPrompt: ModelMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\nContext:\n${fullContext}` },
    ...prompt,
  ];

  const result = streamText({
    model: xai("grok-4-fast"),
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
