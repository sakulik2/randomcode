import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles/tokens.css'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root 不在页面里')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
