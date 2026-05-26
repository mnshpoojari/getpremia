import type { Metadata } from 'next'
import { Young_Serif, Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'
import './globals.css'

const youngSerif = Young_Serif({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'block',
})

const instrumentSans = Instrument_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Premia — Understanding where money is moving',
  description: "Type a sector and country. Get an analysis in seconds.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${youngSerif.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://unpkg.com" />
        <link rel="dns-prefetch" href="https://unpkg.com" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
