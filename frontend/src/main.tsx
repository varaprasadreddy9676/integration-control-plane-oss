import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { TenantProvider } from './app/tenant-context';
import { ThemeProvider } from './app/theme-provider';
import { AuthProvider } from './app/auth-context';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { setupGlobalErrorHandlers } from './utils/error-logger';
import { createAppQueryClient } from './app/query-client';
import './design-system/theme/global.css';
import './design-system/theme/motion.css';
import './design-system/theme/surfaces.css';
import { installSpotlight } from './design-system/spotlight';
import { dissolve } from './design-system/delight';
import { setRemovalEffect } from './services/api';

// Setup global error handlers
setupGlobalErrorHandlers();
installSpotlight();
// Every delete looks the same: the removed record's row dissolves before the list refreshes.
setRemovalEffect((recordId) =>
  dissolve(document.querySelector(`.ant-table-row[data-row-key="${CSS.escape(recordId)}"], [data-record-id="${CSS.escape(recordId)}"]`))
);

const queryClient = createAppQueryClient();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <TenantProvider>
                <App />
              </TenantProvider>
            </AuthProvider>
          </QueryClientProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
