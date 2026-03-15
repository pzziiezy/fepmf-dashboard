import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FEPMF Dashboard — BigC DGT',
  description: 'Front-End Project Management Framework — PM & PO Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
