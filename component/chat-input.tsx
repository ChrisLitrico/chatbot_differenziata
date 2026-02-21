import { useState, useRef } from 'react'
import { IoSend } from 'react-icons/io5'
import { HiOutlinePlus } from 'react-icons/hi'

export default function ChatInput({
  status,
  onSubmit,
  hasMessages = false,
  onNewChat,
}: {
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  onSubmit: (text: string) => void
  hasMessages?: boolean
  onNewChat?: () => void
}) {
  const [text, setText] = useState('')
  const isDisabled = status === 'submitted' || status === 'streaming'
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (text.trim() === '' || isDisabled) return
    buttonRef.current?.classList.add('animate-send-pop')
    setTimeout(() => buttonRef.current?.classList.remove('animate-send-pop'), 200)
    onSubmit(text)
    setText('')
  }

  return (
    <form className="w-full" onSubmit={handleSubmit}>
      <div className="chat-input-wrapper flex gap-3 border border-gray-300 rounded-full bg-purple-50 shadow-md px-4 py-1.5 transition-all">
        {hasMessages && (
          <button
            type="button"
            onClick={onNewChat}
            title="Nuova chat"
            className="flex items-center justify-center w-8 h-8 text-white transition-all rounded-full bg-violet-500 hover:bg-violet-600 active:scale-90 shrink-0 animate-fade-slide-in"
          >
            <HiOutlinePlus className="text-base" />
          </button>
        )}
        <input
          className="w-full bg-transparent rounded-md py-1.5 text-sm focus:outline-none placeholder:text-gray-400"
          placeholder="Qualche dubbio sui tuoi rifiuti?"
          disabled={isDisabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          ref={buttonRef}
          type="submit"
          disabled={isDisabled || text.trim() === ''}
          className="flex items-center w-8 h-8 pl-2 text-white transition-all rounded-full bg-violet-500 hover:bg-violet-600 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-violet-500 shrink-0"
        >
          <IoSend className="text-sm ml-0.5" />
        </button>
      </div>
    </form>
  )
}
