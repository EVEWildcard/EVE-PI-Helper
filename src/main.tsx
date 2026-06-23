import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installApi } from './api'
import './styles/global.css'

installApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
