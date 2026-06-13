import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {installCompatLayer} from './compat';

// Install the SillyTavern compatibility layer before React mounts so the
// window.SillyTavern global and event bus exist by the time any extension or
// the render pipeline runs. Idempotent: safe under StrictMode's double-invoke.
installCompatLayer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
