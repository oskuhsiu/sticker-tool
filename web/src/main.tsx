import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './app.css';

const el = document.getElementById('root');
if (!el) throw new Error('找不到 #root');
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
