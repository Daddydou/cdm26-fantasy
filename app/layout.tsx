import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CDM26 Fantasy',
  description: 'Fantasy football — Coupe du Monde 2026',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gray-950 text-white antialiased">
        {children}
      </body>
    </html>
  )
}

