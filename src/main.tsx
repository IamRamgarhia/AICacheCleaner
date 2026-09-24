import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

// macOS draws its window buttons at the top-left of our title bar; the CSS
// leaves room for them only there.
const platform = (window as unknown as { electronAPI?: { platform?: string } }).electronAPI?.platform
document.documentElement.classList.toggle('is-mac', platform === 'darwin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
