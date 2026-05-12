import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

function Root() {
  if (window.location.pathname === '/') {
    window.history.replaceState(null, '', '/debug');
  }

  if (window.location.pathname !== '/debug') {
    return (
      <main className="route-placeholder">
        <h1>页面不存在</h1>
        <p>React Host 调试页已移动到 /debug。</p>
        <a href="/debug">打开调试页</a>
      </main>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
