import { useState, useRef, useEffect } from 'react'
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
  const [isMobile, setIsMobile] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const isDisabled = status === 'submitted' || status === 'streaming'
  const buttonRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Detect mobile viewport after mount to avoid hydration mismatch
  useEffect(() => {
    setIsMounted(true)
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const triggerSubmit = () => {
    if (text.trim() === '' || isDisabled) return
    buttonRef.current?.classList.add('animate-send-pop')
    setTimeout(() => buttonRef.current?.classList.remove('animate-send-pop'), 200)
    onSubmit(text)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    triggerSubmit()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      triggerSubmit()
    }
  }

  return (
    <form className="w-full" onSubmit={handleSubmit}>
      <div className="flex items-end gap-3 px-4 py-3 transition-all bg-white border border-gray-300 shadow-lg rounded-2xl focus-within:border-violet-400 focus-within:shadow-violet-100">
        {hasMessages && (
          <button
            type="button"
            onClick={onNewChat}
            title="Nuova chat"
            className="flex items-center justify-center w-9 h-9 mb-0.5 text-white transition-all rounded-full bg-violet-500 hover:bg-violet-600 active:scale-90 shrink-0 animate-fade-slide-in"
          >
            <HiOutlinePlus className="text-base" />
          </button>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          className="w-full py-2 pl-4 pr-2 ml-2 overflow-hidden text-base leading-relaxed text-gray-800 resize-none sm:text-lg focus:outline-none placeholder:text-gray-400 max-h-48"
          placeholder="Qualche dubbio sui tuoi rifiuti?"
          disabled={isDisabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          ref={buttonRef}
          type="submit"
          disabled={isDisabled || text.trim() === ''}
          className="flex items-center justify-center w-10 h-10 mb-0.5 text-white transition-all rounded-xl bg-violet-500 hover:bg-violet-600 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-violet-500 shrink-0"
        >
          <IoSend className="text-base" />
        </button>
      </div>
      {isMounted && !hasMessages && !isMobile && <p className="mt-2 text-xs text-center text-gray-400 select-none">Invio per inviare · Shift+Invio per andare a capo</p>}
    </form>
  )
}
