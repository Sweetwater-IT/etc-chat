import { consumeStream, convertToModelMessages, streamText, type UIMessage } from "ai"
import { xai } from '@ai-sdk/xai';  // Add this for Grok

export const maxDuration = 30

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const prompt = convertToModelMessages(messages)

  const result = streamText({
    model: xai('grok-4-fast'),  // Swap to Grok
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
