import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {Dashboard} from './Dashboard.jsx';
import {Settings} from './Settings.jsx';

function App({page}) {
  // In-memory only: the preview origin is opaque, so appearance resets on every load.
  const [isDark, setIsDark] = useState(false);
  return (
    <Theme theme={neutralTheme} mode={isDark ? 'dark' : 'light'}>
      {page === 'settings' ? <Settings isDark={isDark} onDarkChange={setIsDark} /> : <Dashboard />}
    </Theme>
  );
}

const root = document.getElementById('root');
createRoot(root).render(<App page={root.dataset.page} />);
