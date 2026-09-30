import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from './lib/auth'
import { LanguageProvider } from './lib/i18n'
import { AppearanceProvider } from './lib/appearance'
import { PresenceProvider } from './lib/presence'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem><LanguageProvider><BrowserRouter>
      <AuthProvider>
        <AppearanceProvider><PresenceProvider><App /></PresenceProvider></AppearanceProvider>
      </AuthProvider>
    </BrowserRouter></LanguageProvider></ThemeProvider>
  </StrictMode>,
)

// Installable app: register the service worker in production builds only, so dev never serves stale files.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}
