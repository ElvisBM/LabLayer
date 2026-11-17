import {lazy, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { ViewBoundary } from './components/ViewBoundary';
import './index.css';

// The public assistant does not need the dashboard or Firebase client.
const App = lazy(() => window.location.pathname === '/assistente'
  ? import('./features/assistant/AssistantChat').then(module => ({ default: module.AssistantChat }))
  : import('./App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ViewBoundary><App /></ViewBoundary>
  </StrictMode>,
);
