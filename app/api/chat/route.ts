import { consumeStream, convertToModelMessages, streamText, type UIMessage } from "ai"
import { createXai } from '@ai-sdk/xai'; // Create instance for key

export const maxDuration = 30

const xai = createXai({ apiKey: process.env.GROK_API_KEY! });  // Inject key

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const prompt = convertToModelMessages(messages)

  const result = streamText({
    model: xai('grok-4-fast'), // Use instance
    prompt,
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
