import { useEffect, useRef } from 'react'

function useSmoothScrollToBottom(messages: any[], status: string) {
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastMessageLengthRef = useRef(0)

  useEffect(() => {
    const scrollToBottom = () => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth',
      })
    }

    // Se il modello sta generando testo (streaming)
    if (status === 'streaming' && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      const parts = Array.isArray(lastMessage?.parts) ? lastMessage.parts : []
      const currentMessageLength = parts.filter((p: any) => p.type === 'text').reduce((acc: number, p: any) => acc + (p.text?.length || 0), 0)

      // Solo se il messaggio è cresciuto (nuovo testo aggiunto)
      if (currentMessageLength > lastMessageLengthRef.current) {
        scrollToBottom()
        lastMessageLengthRef.current = currentMessageLength
      }

      // Scroll continuo durante lo streaming per essere sicuri
      scrollIntervalRef.current = setInterval(scrollToBottom, 100)
    } else {
      // Pulisci l'intervallo quando lo streaming finisce
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current)
        scrollIntervalRef.current = null
      }

      // Reset del contatore quando inizia un nuovo messaggio
      if (messages.length > 0) {
        lastMessageLengthRef.current = 0
        // Un ultimo scroll quando il messaggio è completato
        setTimeout(scrollToBottom, 50)
      }
    }

    // Cleanup
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current)
      }
    }
  }, [messages, status])

  // Cleanup quando il componente viene smontato
  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current)
      }
    }
  }, [])
}

export default useSmoothScrollToBottom
