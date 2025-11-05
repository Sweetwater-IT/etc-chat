// ──────────────────────────────────────────────────────────────────────
//  POST handler – ONLY MUTCD + BID VECTORS
// ──────────────────────────────────────────────────────────────────────
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

// ────── Supabase clients ──────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
const bidxSupabase = createClient(
  process.env.BIDX_SUPABASE_URL!,
  process.env.BIDX_SUPABASE_SERVICE_KEY!
);
const xai = createXai({ apiKey: process.env.GROK_API_KEY! });

// ────── System prompt ──────
const SYSTEM_PROMPT = `
You are an AI assistant for Established Traffic Control.
- Use [MUTCD] for standards and rules.
- Use [BID] for contract, location, and equipment details.
- Always cite sources exactly as shown.
- Keep answers concise and professional.
`;

// ────── Embedding (bge‑small → 384) ──────
async function embedQuery(query: string): Promise<number[]> {
  const res = await fetch(
    "https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: [query] }),
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HF error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return Array.isArray(data) && Array.isArray(data[0]) ? data[0] : data;
}

// ────── MUTCD RAG ──────
interface MutcdChunk {
  content: string;
  metadata: { source: string; chunk_index: number };
}
async function retrieveMUTCD(query: string, topK = 3): Promise<string> {
  try {
    const emb = await embedQuery(query);
    const { data } = await supabase.rpc("match_documents", {
      query_embedding: emb,
      match_threshold: 0.5,
      match_count: topK,
    });
    if (!data?.length) return "";
    return data
      .map(
        (c: MutcdChunk) =>
          `[MUTCD: ${c.metadata.source}, Chunk ${c.metadata.chunk_index}]\n${c.content}`
      )
      .join("\n\n");
  } catch (e) {
    console.error("MUTCD error:", e);
    return "";
  }
}

// ────── BID VECTOR RAG ──────
interface BidChunk {
  id: number;
  metadata: {
    status: string;
    created_at: string;
    source_idx: number;
    searchable_text: string;
  };
}
async function retrieveBids(query: string, topK = 3): Promise<string> {
  try {
    const emb = await embedQuery(query);
    const { data } = await bidxSupabase.rpc("match_bid_vectors", {
      query_embedding: emb,
      match_threshold: 0.5,
      match_count: topK,
    });
    if (!data?.length) return "";
    return data
      .map(
        (c: BidChunk) =>
          `[BID: #${c.id} – ${c.metadata.searchable_text}]\nStatus: ${c.metadata.status}`
      )
      .join("\n\n");
  } catch (e) {
    console.error("Bid vector error:", e);
    return "";
  }
}

// ────── POST handler ──────
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const userMsg = messages[messages.length - 1];
  const userQuery =
    userMsg?.role === "user" ? ((userMsg.parts?.[0] as any)?.text ?? "") : "";

  let mutcd = "";
  let bids = "";

  if (userQuery) {
    [mutcd, bids] = await Promise.all([
      retrieveMUTCD(userQuery),
      retrieveBids(userQuery),
    ]);
  }

  const context = [mutcd, bids].filter(Boolean).join("\n\n");
  const prompt: ModelMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
    ...convertToModelMessages(messages),
  ];

  const result = streamText({
    model: xai("grok-4-fast"),
    prompt,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({ consumeSseStream: consumeStream });
}
