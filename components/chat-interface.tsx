"use client"

import type React from "react"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Send, Sparkles, Menu, Plus, MoreVertical, Paperclip } from "lucide-react"
import { useRef, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export default function ChatInterface() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [hoveredChatId, setHoveredChatId] = useState<number | null>(null)

  const [chatHistory] = useState([
    { id: 1, title: "Traffic control procedures", date: new Date() },
    { id: 2, title: "Safety guidelines discussion", date: new Date() },
    { id: 3, title: "Equipment requirements", date: new Date(Date.now() - 86400000) },
    { id: 4, title: "Permit application help", date: new Date(Date.now() - 86400000) },
    { id: 5, title: "Road closure planning", date: new Date(Date.now() - 3 * 86400000) },
    { id: 6, title: "Signage requirements", date: new Date(Date.now() - 3 * 86400000) },
  ])

  const groupChatsByDate = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const groups: { [key: string]: typeof chatHistory } = {}

    chatHistory.forEach((chat) => {
      const chatDate = new Date(chat.date)
      chatDate.setHours(0, 0, 0, 0)

      let groupKey: string

      if (chatDate.getTime() === today.getTime()) {
        groupKey = "Today"
      } else if (chatDate.getTime() === yesterday.getTime()) {
        groupKey = "Yesterday"
      } else {
        groupKey = chatDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      }

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(chat)
    })

    return groups
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const textarea = textareaRef.current
    if (!textarea || !textarea.value.trim()) return

    sendMessage({ text: textarea.value })
    textarea.value = ""
    textarea.style.height = "auto"
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }

  const handleNewChat = () => {
    console.log("[v0] Starting new chat")
  }

  const groupedChats = groupChatsByDate()

  return (
    <div className="flex h-screen bg-white">
      <div className="fixed left-4 top-4 z-50 flex gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`h-10 w-10 bg-white text-gray-600 shadow-md transition-all duration-300 hover:bg-gray-50 hover:text-gray-900 ${
            isSidebarOpen ? "translate-x-64" : "translate-x-0"
          }`}
        >
          <Menu className="h-5 w-5" />
        </Button>
        {!isSidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNewChat}
            className="h-10 w-10 bg-white text-gray-600 shadow-md hover:bg-gray-50 hover:text-gray-900"
          >
            <Plus className="h-5 w-5" />
          </Button>
        )}
      </div>

      <aside
        className={`fixed left-0 top-0 z-40 h-full w-64 bg-gray-100 transition-transform duration-300 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 p-4">
            <div className="flex-1">
              <h1 className="text-base font-bold text-gray-900">Established Traffic Control</h1>
              <p className="text-xs text-gray-600">AI Assistant</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewChat}
              className="h-8 w-8 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {Object.entries(groupedChats).map(([dateGroup, chats]) => (
              <div key={dateGroup}>
                <h2 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{dateGroup}</h2>
                <div className="space-y-1">
                  {chats.map((chat) => (
                    <div
                      key={chat.id}
                      className="group relative"
                      onMouseEnter={() => setHoveredChatId(chat.id)}
                      onMouseLeave={() => setHoveredChatId(null)}
                    >
                      <button className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-200">
                        <div className="truncate text-sm text-gray-700">{chat.title}</div>
                      </button>
                      {hoveredChatId === chat.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 text-gray-600 hover:bg-gray-300 hover:text-gray-900"
                          onClick={(e) => {
                            e.stopPropagation()
                            console.log("[v0] Action menu clicked for chat", chat.id)
                          }}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className={`flex flex-1 flex-col transition-all duration-300 ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-4 py-8">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col justify-center">
                <div className="space-y-4">
                  <div>
                    <h1 className="text-4xl font-bold tracking-tight text-gray-900">Hello there!</h1>
                  </div>
                  <p className="text-xl text-gray-600 leading-relaxed">
                    Established Traffic Control's AI assistant for analyzing traffic plans, estimating bids, monitoring
                    jobs, managing equipment inventory, and coordinating rental schedules.
                  </p>
                  <p className="text-base text-gray-500">Select a prompt below or type your question.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {message.role === "assistant" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900">
                        <Sparkles className="h-4 w-4 text-white" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        message.role === "user" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-900"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {message.parts.map((part, index) => {
                          if (part.type === "text") {
                            return <span key={index}>{part.text}</span>
                          }
                          return null
                        })}
                      </div>
                    </div>
                    {message.role === "user" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                        <div className="h-5 w-5 rounded-full bg-gray-300" />
                      </div>
                    )}
                  </div>
                ))}
                {status === "in_progress" && (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900">
                      <Sparkles className="h-4 w-4 text-white" />
                    </div>
                    <div className="max-w-[80%] rounded-2xl bg-gray-100 px-4 py-3">
                      <div className="flex gap-1">
                        <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {messages.length === 0 && (
          <div className="mx-auto w-full max-w-4xl px-4 pb-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => {
                  if (textareaRef.current) {
                    textareaRef.current.value =
                      "Do we have enough Type 3 barricades and channeling devices for the Route 30 project?"
                    textareaRef.current.focus()
                  }
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
              >
                <div className="text-gray-700">
                  Do we have enough Type 3 barricades and channeling devices for the Route 30 project?
                </div>
              </button>
              <button
                onClick={() => {
                  if (textareaRef.current) {
                    textareaRef.current.value = "What's the status on our TMAs and message boards for this week?"
                    textareaRef.current.focus()
                  }
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
              >
                <div className="text-gray-700">What's the status on our TMAs and message boards for this week?</div>
              </button>
              <button
                onClick={() => {
                  if (textareaRef.current) {
                    textareaRef.current.value = "What jobs are scheduled for today?"
                    textareaRef.current.focus()
                  }
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
              >
                <div className="text-gray-700">What jobs are scheduled for today?</div>
              </button>
              <button
                onClick={() => {
                  if (textareaRef.current) {
                    textareaRef.current.value = "Can you help me prepare a bid for a new traffic control project?"
                    textareaRef.current.focus()
                  }
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
              >
                <div className="text-gray-700">Can you help me prepare a bid for a new traffic control project?</div>
              </button>
            </div>
          </div>
        )}

        <div className="bg-white">
          <div className="mx-auto max-w-4xl px-4 py-4">
            <form onSubmit={handleSubmit} className="relative">
              <div className="relative flex items-end gap-2 rounded-lg border border-gray-200 bg-white p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-gray-600 hover:text-gray-900"
                  onClick={() => console.log("[v0] File attachment clicked")}
                >
                  <Paperclip className="h-4 w-4" />
                  <span className="sr-only">Attach file</span>
                </Button>
                <Textarea
                  ref={textareaRef}
                  placeholder="Type your message..."
                  className="min-h-[80px] max-h-[200px] flex-1 resize-none border-0 bg-transparent p-2 text-gray-900 focus-visible:ring-0 focus-visible:ring-offset-0"
                  onKeyDown={handleKeyDown}
                  onInput={handleInput}
                  disabled={status === "in_progress"}
                  rows={1}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="h-10 w-10 shrink-0 bg-gray-900 hover:bg-gray-800"
                  disabled={status === "in_progress"}
                >
                  <Send className="h-4 w-4" />
                  <span className="sr-only">Send message</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
