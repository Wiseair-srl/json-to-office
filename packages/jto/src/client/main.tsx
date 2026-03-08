import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { configureMonaco } from './lib/monaco-config';

// Initialize Monaco configuration early for better autocomplete
configureMonaco()
  .then(() => {
    console.log(
      'Monaco editor configured with JSON schemas for better autocomplete'
    );
  })
  .catch((error) => {
    console.error('Failed to configure Monaco:', error);
  });

const rootElement = document.getElementById('root')!;
const root = createRoot(rootElement);

// Only use StrictMode in development
if (import.meta.env.DEV) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} else {
  root.render(<App />);
}
