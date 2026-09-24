import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

// macOS draws its window buttons at the top-left of our title bar; the CSS
// leaves room for them only there.
const native = (window as unknown as { electronAPI?: { platform?: string; material?: string | null } }).electronAPI
document.documentElement.classList.toggle('is-mac', native?.platform === 'darwin')
// Windows 11 paints Mica behind the window; the CSS then lets it show through.
document.documentElement.classList.toggle('has-mica', native?.material === 'mica')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
