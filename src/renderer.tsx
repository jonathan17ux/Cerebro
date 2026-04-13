import './i18n'; // Initialize i18next synchronously (English default)
import i18n from './i18n';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadSetting } from './lib/settings';

const root = createRoot(document.getElementById('root'));

// Load saved language before first render to prevent flash of wrong language.
// If load fails (backend still starting), English is the correct fallback.
loadSetting<string>('ui_language').then((lang) => {
  if (lang && lang !== 'en') {
    i18n.changeLanguage(lang);
  }
  root.render(<App />);
}).catch(() => {
  root.render(<App />);
});
