import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { AppRuntime } from './runtime.js';
import { applyTheme, readTheme } from './preferences.js';
import { onDocumentExit } from './document-lifecycle.js';
import './styles.css';
import './accessibility.css';
import './thinking-indicator.css';
applyTheme(readTheme());
const runtime = new AppRuntime(location.origin);
const removeExit = onDocumentExit(window, () => runtime.dispose());
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { removeExit(); runtime.dispose(); }
  render() { return this.state.failed ? <main className="fatal-error"><h1>The interface could not be displayed.</h1><p>Your conversations remain in Hermes. Reload to reconnect; no prompt will be replayed.</p><button onClick={() => location.reload()}>Reload interface</button><a href="/diagnostic">Open connection diagnostic</a></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App runtime={runtime}/></ErrorBoundary>);
