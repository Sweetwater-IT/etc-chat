"use client"

import type React from "react"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import {
  Send,
  Sparkles,
  Plus,
  MoreVertical,
  Paperclip,
  MessageSquare,
  Briefcase,
  FileText,
  Package,
  Calendar,
  RotateCcw,
  ExternalLink,
  PenSquare,
  ChevronLeft,
  User,
} from "lucide-react"
import { useRef, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export default function ChatInterface() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [hoveredChatId, setHoveredChatId] = useState<number | null>(null)
  const [activeView, setActiveView] = useState("chat")

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
      <aside
        className={`fixed left-0 top-0 z-40 h-full w-64 bg-[#fafafa] transition-transform duration-300 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between bg-[#fafafa] p-4">
            <div className="flex-1">
              <h1 className="text-sm font-semibold text-gray-900">Established Traffic Control</h1>
              <p className="text-xs text-gray-500">AI Assistant</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <nav className="space-y-1">
              <button
                onClick={() => setActiveView("chat")}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  activeView === "chat"
                    ? "font-bold text-gray-900"
                    : "font-medium text-gray-700 hover:bg-white hover:text-gray-900"
                }`}
              >
                <MessageSquare className="h-4 w-4" />
                Chat
              </button>

              <button
                onClick={() => setActiveView("bids")}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  activeView === "bids"
                    ? "font-bold text-gray-900"
                    : "font-medium text-gray-700 hover:bg-white hover:text-gray-900"
                }`}
              >
                <FileText className="h-4 w-4" />
                Bids
              </button>

              <button
                onClick={() => setActiveView("jobs")}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  activeView === "jobs"
                    ? "font-bold text-gray-900"
                    : "font-medium text-gray-700 hover:bg-white hover:text-gray-900"
                }`}
              >
                <Briefcase className="h-4 w-4" />
                Jobs
              </button>

              <button
                onClick={() => setActiveView("schedule")}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  activeView === "schedule"
                    ? "font-bold text-gray-900"
                    : "font-medium text-gray-700 hover:bg-white hover:text-gray-900"
                }`}
              >
                <Calendar className="h-4 w-4" />
                Project Schedule
              </button>

              <button
                onClick={() => setActiveView("inventory")}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  activeView === "inventory"
                    ? "font-bold text-gray-900"
                    : "font-medium text-gray-700 hover:bg-white hover:text-gray-900"
                }`}
              >
                <Package className="h-4 w-4" />
                Rental Yard Inventory
              </button>

              <div className="mt-6">
                <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700">
                  <RotateCcw className="h-4 w-4" />
                  History
                </div>

                <div className="ml-3 mt-2 space-y-4 border-l-2 border-gray-200 pl-4">
                  {Object.entries(groupedChats).map(([dateGroup, chats]) => (
                    <div key={dateGroup}>
                      <h3 className="mb-2 text-xs font-medium text-gray-500">{dateGroup}</h3>
                      <div className="space-y-1">
                        {chats.map((chat) => (
                          <div
                            key={chat.id}
                            className="group relative"
                            onMouseEnter={() => setHoveredChatId(chat.id)}
                            onMouseLeave={() => setHoveredChatId(null)}
                          >
                            <button className="w-full rounded-lg px-3 py-2 text-left transition-all hover:bg-white hover:shadow-sm">
                              <div className="truncate text-sm text-gray-700">{chat.title}</div>
                            </button>
                            {hoveredChatId === chat.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
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
            </nav>
          </div>

          <div className="bg-[#fafafa] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-300">
                <User className="h-5 w-5 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-600 truncate">user@establishedtc.com</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(false)}
                className="h-8 w-8 shrink-0 text-gray-600 hover:bg-white hover:text-gray-900"
                title="Collapse sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <div className={`flex flex-1 flex-col transition-all duration-300 ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <header className="relative z-30 border-b border-gray-100 bg-white">
          <div className="flex h-14 items-center justify-end gap-3 px-6">
            <Button
              variant="ghost"
              className="gap-2 rounded-lg border-2 border-black bg-white text-black hover:bg-gray-50"
              onClick={() => console.log("[v0] Go to BidX clicked")}
            >
              Go to BidX
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewChat}
              className="h-9 w-9 rounded-lg bg-white text-gray-900 hover:bg-gray-50"
            >
              <PenSquare className="h-6 w-6" />
            </Button>
          </div>
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 translate-y-full bg-gradient-to-b from-white to-transparent" />
        </header>

        {activeView === "chat" && (
          <>
            <div className="relative flex-1 overflow-y-auto">
              <div className="mx-auto max-w-4xl px-4 pb-8 pt-8">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col justify-center">
                    <div className="space-y-4">
                      <div>
                        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Hello there!</h1>
                      </div>
                      <p className="text-base leading-relaxed text-gray-600">
                        Established Traffic Control's AI assistant for analyzing traffic plans, estimating bids,
                        monitoring jobs, managing equipment inventory, and coordinating rental schedules.
                      </p>
                      <p className="text-sm text-gray-500">Select a prompt below or type your question.</p>
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
                    {status === "streaming" && (
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
                    <div className="font-semibold text-gray-900">
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
                    <div className="font-semibold text-gray-900">
                      What's the status on our TMAs and message boards for this week?
                    </div>
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
                    <div className="font-semibold text-gray-900">What jobs are scheduled for today?</div>
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
                    <div className="font-semibold text-gray-900">
                      Can you help me prepare a bid for a new traffic control project?
                    </div>
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
                      disabled={status !== "ready"}
                      rows={1}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="h-10 w-10 shrink-0 bg-gray-900 hover:bg-gray-800"
                      disabled={status !== 0}
                    >
                      <Send className="h-4 w-4" />
                      <span className="sr-only">Send message</span>
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}

        {activeView === "jobs" && (
          <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="mx-auto max-w-7xl">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">Jobs</h2>
                <Button className="gap-2 rounded-lg bg-gray-900 hover:bg-gray-800">
                  <Plus className="h-4 w-4" />
                  New Job
                </Button>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
                <div className="mx-auto max-w-sm">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                    <Briefcase className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">No jobs yet</h3>
                  <p className="text-sm text-gray-500">Get started by creating your first job</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeView === "bids" && (
          <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="mx-auto max-w-7xl">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">Bids</h2>
                <Button className="gap-2 rounded-lg bg-gray-900 hover:bg-gray-800">
                  <Plus className="h-4 w-4" />
                  New Bid
                </Button>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
                <div className="mx-auto max-w-sm">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                    <FileText className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">No bids yet</h3>
                  <p className="text-sm text-gray-500">Start tracking your bids here</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeView === "schedule" && (
          <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="mx-auto max-w-7xl">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">Project Schedule</h2>
                <Button className="gap-2 rounded-lg bg-gray-900 hover:bg-gray-800">
                  <Plus className="h-4 w-4" />
                  Add Event
                </Button>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
                <div className="mx-auto max-w-sm">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                    <Calendar className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">No scheduled projects</h3>
                  <p className="text-sm text-gray-500">Your project schedule will appear here</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeView === "inventory" && (
          <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="mx-auto max-w-7xl">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">Rental Yard Inventory</h2>
                <Button className="gap-2 rounded-lg bg-gray-900 hover:bg-gray-800">
                  <Plus className="h-4 w-4" />
                  Add Equipment
                </Button>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
                <div className="mx-auto max-w-sm">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                    <Package className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">No equipment tracked</h3>
                  <p className="text-sm text-gray-500">Start managing your rental inventory here</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
