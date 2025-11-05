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

// === EMBEDDING FUNCTION (HF Router - bge-large-en-v1.5) ===
async function embedQuery(query: string): Promise<number[]> {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/BAAI/bge-large-en-v1.5",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: [query] }),
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

// === SCHEMA FETCHER (Enhanced: Include Sample JSON Paths if Known) ===
let cachedSchema: { columns: string; jsonPaths: string } | null = null;
async function getSchema(): Promise<{ columns: string; jsonPaths: string }> {
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
    if (error || !data) return { columns: "Schema unavailable", jsonPaths: "" };

    const columns = data
      .map(row => `${row.table_name}.${row.column_name}: ${row.data_type}`)
      .join("\n");

    // TODO: If you have sample JSON structures, hardcode common paths here for better guidance.
    // Example (adjust based on your actual data):
    const jsonPaths = `
Common JSON Paths (use ->> or -> for extraction):
- admin_data->>'contractNumber' (string)
- equipment_rental: array of objects, e.g., elements->>'type' (string), elements->>'quantity' (int)
- Use json_array_elements(json_column) AS elem LATERAL JOIN for arrays.
`;

    cachedSchema = { columns, jsonPaths };
    return cachedSchema;
  } catch {
    return { columns: "Schema fetch failed", jsonPaths: "" };
  }
}

// === HELPER: Validate SQL Columns ===
function validateSQLColumns(sql: string, schemaColumns: string[]): boolean {
  // Simple regex to extract potential column references (e.g., table.col or just col).
  const columnMatches = sql.match(/\b(?:\w+\.)?\w+\b/g) || [];
  const invalidColumns = columnMatches.filter(col => 
    !schemaColumns.some(schemaCol => schemaCol.includes(col.replace(/\./, '.')))
  );
  // Whitelist common SQL keywords to avoid false positives.
  const sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'AS', 'JOIN', 'LATERAL', 'json_array_elements'];
  return invalidColumns.filter(col => !sqlKeywords.includes(col.toUpperCase())).length === 0;
}

// === HELPER: Extract Error Message ===
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// === KG SQL VIA LLM (Enhanced: Stricter Prompt + Validation) ===
async function retrieveKG(userQuery: string): Promise<string> {
  const { columns: schema, jsonPaths } = await getSchema();
  if (schema.startsWith("Schema")) return schema; // Early bail on schema issues.

  // Extract schema columns for validation (e.g., ["estimate_complete.admin_data", ...]).
  const schemaColumns = schema.split('\n').map(line => line.split(':')[0].trim());

  // Stricter prompt with examples to reduce hallucinations.
  const sqlPrompt = `You are a SQL expert. Generate PostgreSQL for Supabase. USE ONLY these exact tables and columns. NO OTHER COLUMNS OR TABLES.

SCHEMA:
${schema}

JSON GUIDANCE:
${jsonPaths}

USER QUERY: "${userQuery}"

RULES (MANDATORY):
- "bid", "estimate", "pending" → estimate_complete table only.
- "job", "won", "completed" → jobs_complete table only.
- For JSON arrays in columns like equipment_rental: Use EXACTLY: SELECT ... FROM table, LATERAL json_array_elements(equipment_rental) AS elem WHERE elem->>'type' = 'Type 3'
- Extract contract: admin_data->>'contractNumber'
- ALWAYS qualify columns with table (e.g., estimate_complete.admin_data).
- Return ONLY the SQL query. No explanations. No semicolons. Start with SELECT.
- If query can't be answered with schema, return "SELECT NULL AS error;"

EXAMPLE for "How many Type 3s on JOB-789?":
SELECT count(*) FROM jobs_complete, LATERAL json_array_elements(jobs_complete.equipment_rental) AS elem WHERE jobs_complete.admin_data->>'contractNumber' = 'JOB-789' AND elem->>'type' = 'Type 3';

Generate SQL now.`;

  let attempts = 0;
  const maxAttempts = 2;
  let sql = "";

  while (attempts < maxAttempts) {
    try {
      const sqlResult = await streamText({
        model: xai("grok-4-fast"),
        prompt: sqlPrompt,
      });
      sql = (await sqlResult.text).trim();
      if (sql.endsWith(";")) sql = sql.slice(0, -1).trim();

      // Safety checks (existing + new validation).
      if (!sql.toUpperCase().startsWith("SELECT") || /DROP|INSERT|UPDATE|DELETE/i.test(sql)) {
        throw new Error("Unsafe SQL");
      }
      if (!validateSQLColumns(sql, schemaColumns)) {
        throw new Error("Invalid columns referenced");
      }

      // If we reach here, SQL is valid—execute.
      const { data, error } = await bidxSupabase.rpc("execute_custom_sql", { sql_query: sql });
      if (error) {
        console.error("KG SQL error:", error);
        if (attempts < maxAttempts - 1) {
          attempts++;
          continue; // Retry on execution error.
        }
        return `[KG: Query failed - ${getErrorMessage(error)}]`;
      }
      if (!data || data.length === 0) return "[KG: No data found]";
      return data
        .map((row: any, i: number) => `[KG Result ${i + 1}]\n${JSON.stringify(row, null, 2)}`)
        .join("\n");
    } catch (error) {
      console.error(`KG SQL attempt ${attempts + 1} error:`, error);
      attempts++;
      if (attempts >= maxAttempts) {
        return `[KG: Generation failed after ${maxAttempts} attempts - ${getErrorMessage(error)}]`;
      }
      // Optional: Adjust prompt for retry, e.g., append "Fix column error from previous attempt."
    }
  }
  return "[KG: Unexpected failure]";
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
