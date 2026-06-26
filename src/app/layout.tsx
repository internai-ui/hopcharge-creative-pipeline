import type { Metadata } from 'next'
import { Nunito, Geist_Mono } from 'next/font/google'
import './globals.css'

const nunito = Nunito({ variable: '--font-nunito', subsets: ['latin'], weight: ['300', '400', '500', '600', '700'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Hopcharge Ad Engine',
  description: 'Automated ad creative pipeline for Hopcharge',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${geistMono.variable}`}>
      <body className="bg-brand-bg text-brand-dark min-h-screen antialiased">
        {children}
      </body>
    </html>
  )
}
