'use client'

import { useChat } from '@ai-sdk/react'
import ChatInput from '@/components/chat-input'
import { useCallback } from 'react'
import useSmoothScrollToBottom from '@/hooks/useSmoothScrollToBottom'
import ReactMarkdown from 'react-markdown'
import Image from 'next/image'

// Tipi aggiornati per seguire la documentazione ai-sdk
type TextPart = { type: 'text'; text: string }
type Role = 'user' | 'assistant' | 'system' | 'tool'

interface UIMessage {
  id: string
  role: Role
  parts: TextPart[]
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block w-2 h-2 rounded-full animate-typing-dot bg-violet-400" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  )
}

export default function Chat() {
  const { error, status, sendMessage, messages, regenerate, stop, setMessages } = useChat()
  useSmoothScrollToBottom(messages, status)

  const handleNewChat = useCallback(() => {
    stop()
    setMessages([])
  }, [setMessages, stop])

  return (
    <div className={`w-screen min-h-screen ${messages.length === 0 ? 'overflow-y-hidden' : ''}`}>
      <div className="flex flex-col w-[92%] sm:w-[80%] md:w-[65%] lg:w-[55%] mx-auto stretch pb-20 sm:pb-16">
        {messages
          .filter((msg) => {
            const uiMessage = msg as UIMessage
            const text = extractText(uiMessage)
            // Mostra messaggi utente sempre, assistente se ha contenuto o se è in streaming (anche se vuoto)
            return uiMessage.role === 'user' || text.trim() !== '' || (uiMessage.role === 'assistant' && status === 'streaming')
          })
          .map((msg) => {
            const uiMessage = msg as UIMessage
            const text = extractText(uiMessage)
            const isEmpty = text.trim() === ''

            return (
              <div key={uiMessage.id} className={`mb-3 text-sm leading-relaxed flex ${uiMessage.role === 'user' ? 'justify-end' : 'justify-start items-start gap-2'}`}>
                {uiMessage.role === 'assistant' && !isEmpty && (
                  <Image src="/logo-chatbot.png" alt="Garby" width={40} height={40} style={{ width: 'auto', height: 'auto' }} className="mt-2 rounded-full shrink-0" />
                )}
                <div
                  className={`${
                    uiMessage.role === 'user'
                      ? 'bg-pink-200 rounded-2xl shadow-sm px-4 pt-2 max-w-[85%] sm:max-w-[70%] text-right whitespace-pre-wrap animate-fade-slide-right'
                      : `bg-green-50 rounded-2xl px-4 py-2 text-left animate-fade-slide-left ${isEmpty ? 'w-fit' : 'border-l border-purple-300'}`
                  }`}
                >
                  {isEmpty && uiMessage.role === 'assistant' ? (
                    <TypingDots />
                  ) : uiMessage.role === 'assistant' ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-gray-800">{children}</strong>,
                        em: ({ children }) => <em className="italic">{children}</em>,
                        ul: ({ children }) => <ul className="pl-4 mb-2 space-y-1 list-disc">{children}</ul>,
                        ol: ({ children }) => <ol className="pl-4 mb-2 space-y-1 list-decimal">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        h1: ({ children }) => <h1 className="mb-1 text-base font-bold">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-1 text-sm font-bold">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
                        code: ({ children }) => <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">{children}</code>,
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800 transition-colors">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {text}
                    </ReactMarkdown>
                  ) : (
                    text
                  )}
                </div>
              </div>
            )
          })}

        {/* Loading / Streaming indicator */}
        {status === 'submitted' && (
          <div className="animate-fade-slide-left">
            <div className="px-4 py-2 mb-3 mr-auto text-left bg-green-50 rounded-2xl w-fit animate-fade-slide-left">
              <TypingDots />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className="animate-pulse-glow">Elaborazione...</span>
              <button
                type="button"
                className="px-3 py-1 text-sm text-black transition-all border border-red-500 rounded-full hover:border-purple-50 hover:bg-black hover:text-purple-50 active:scale-95"
                onClick={stop}
              >
                Stop
              </button>
            </div>
          </div>
        )}
        {status === 'streaming' && !messages.some((m) => (m as UIMessage).role === 'assistant' && extractText(m as UIMessage).trim() !== '') && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="animate-pulse-glow">Risposta in arrivo...</span>
            <button
              type="button"
              className="px-3 py-1 text-sm text-black transition-all border border-red-500 rounded-full hover:border-purple-50 hover:bg-black hover:text-purple-50 active:scale-95"
              onClick={stop}
            >
              Stop
            </button>
          </div>
        )}

        {error && (
          <div className="relative mt-4 text-sm animate-fade-slide-in">
            <div className="mb-2 text-red-500">Si è verificato un errore: {error.message}</div>
            <button type="button" className="px-3 py-1 text-blue-500 transition-all border border-blue-500 rounded-md hover:bg-blue-50 active:scale-95" onClick={() => regenerate()}>
              Riprova
            </button>
          </div>
        )}

        {/* Landing: logo top-left + centered input */}
        {messages.length === 0 ? (
          <>
            {/* Top-left navbar */}
            <div className="fixed top-5 left-5 flex items-center gap-1.5 select-none z-10">
              <Image src="/logo-chatbot.png" alt="Garby logo" width={82} height={82} style={{ width: 'auto', height: 'auto' }} className="rounded-full drop-shadow-sm" priority />
              <span className="text-base font-semibold tracking-tight text-gray-800">Garby</span>
            </div>

            {/* Centered: subtitle + chatbox */}
            <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-5 animate-fade-slide-in">
              <p className="text-base text-left text-gray-500 select-none sm:text-lg md:text-center">Il tuo assistente per la raccolta differenziata in Sicilia</p>
              <div className="w-full max-w-2xl ">
                <ChatInput status={status} hasMessages={false} onNewChat={handleNewChat} onSubmit={(text) => sendMessage({ text })} />
              </div>
            </div>
          </>
        ) : (
          <div className="pb-2 fixed bottom-2 left-1/2 -translate-x-1/2 w-[92%] sm:w-[80%] md:w-[65%] lg:w-[55%]">
            <ChatInput status={status} hasMessages={messages.length > 0} onNewChat={handleNewChat} onSubmit={(text) => sendMessage({ text })} />
          </div>
        )}
      </div>
    </div>
  )
}
