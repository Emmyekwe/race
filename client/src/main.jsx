import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// StrictMode is intentionally omitted: its development-only double mount would spin up
// the Cannon physics worker and the Socket.io connection twice.
createRoot(document.getElementById('root')).render(<App />)
