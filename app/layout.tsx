import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Differenziata in Sicilia',
  description: 'Guida alla raccolta differenziata in Sicilia.',
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
}
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className={`bg-violet-200 pt-6 ${inter.className}`}>{children}</body>
    </html>
  )
}
