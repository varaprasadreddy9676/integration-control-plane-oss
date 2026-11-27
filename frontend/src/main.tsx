import React from 'react';
import ReactDOM from 'react-dom/client';
import '@ant-design/v5-patch-for-react-19';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { BrandingProvider } from './app/branding-provider';
import { TenantProvider } from './app/tenant-context';
import { ThemeProvider } from './app/theme-provider';
import { AuthProvider } from './app/auth-context';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { setupGlobalErrorHandlers } from './utils/error-logger';
import { createAppQueryClient } from './app/query-client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@astryxdesign/core/astryx.css';
import './design-system/theme/medics-theme.css';
import './design-system/theme/global.css';
import './components/common/primitives.css';
import './design-system/theme/motion.css';
import './design-system/theme/surfaces.css';
import './design-system/theme/corners.css';
import './design-system/theme/product-foundations.css';
import './design-system/extracted-static-styles.css';
import { dissolve } from './design-system/delight';
import { setRemovalEffect } from './services/api';

// Setup global error handlers
setupGlobalErrorHandlers();
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
                <BrandingProvider>
                  <App />
                </BrandingProvider>
              </TenantProvider>
            </AuthProvider>
          </QueryClientProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
