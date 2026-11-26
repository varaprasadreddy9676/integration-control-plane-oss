import React from 'react';
import { Result, Collapse } from '@/components/common/LegacyAntdControls';
import { logError } from '../../utils/error-logger';
import { Button } from './LegacyButton';
import { Typography } from './LegacyTypography';

const { Paragraph, Text } = Typography;
const { Panel } = Collapse;

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error Boundary caught error:', error, errorInfo);

    // Store error info for display in development mode
    this.setState({ errorInfo });

    logError(
      error,
      {
        componentStack: errorInfo.componentStack,
        type: 'react_error',
        errorBoundary: true,
      },
      'ui_error' // Category: UI/React component error
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    // Use the Vite base URL to ensure we respect the /integration-gateway basename
    const baseUrl = import.meta.env.BASE_URL || '/';
    // Remove trailing slash from baseUrl and leading slash from path to avoid double slashes
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    window.location.href = `${cleanBaseUrl}/dashboard`;
  };

  render() {
    if (this.state.hasError) {
      const isDevelopment = import.meta.env.DEV;

      return (
        <div role="alert" aria-live="assertive" aria-atomic="true" className="console-error-boundary">
          <div className="console-error-boundary-content">
            <Result
              status="error"
              title="Something went wrong"
              subTitle={
                isDevelopment && this.state.error
                  ? this.state.error.message
                  : 'The error has been logged and our team will investigate. Please try refreshing the page.'
              }
              extra={[
                <Button type="primary" key="refresh" onClick={this.handleReset}>
                  Refresh Page
                </Button>,
                <Button key="home" onClick={this.handleGoHome}>
                  Go to Dashboard
                </Button>,
              ]}
            />

            {isDevelopment && (this.state.error || this.state.errorInfo) && (
              <div className="console-error-boundary-details">
                <Collapse>
                  <Panel header="Error Details (Development Mode Only)" key="1">
                    {this.state.error && (
                      <div className="console-error-boundary-section">
                        <Text strong>Error Message:</Text>
                        <Paragraph className="console-error-boundary-code">{this.state.error.message}</Paragraph>
                      </div>
                    )}

                    {this.state.error?.stack && (
                      <div className="console-error-boundary-section">
                        <Text strong>Stack Trace:</Text>
                        <Paragraph className="console-error-boundary-code console-error-boundary-stack">
                          {this.state.error.stack}
                        </Paragraph>
                      </div>
                    )}

                    {this.state.errorInfo?.componentStack && (
                      <div>
                        <Text strong>Component Stack:</Text>
                        <Paragraph className="console-error-boundary-code console-error-boundary-stack">
                          {this.state.errorInfo.componentStack}
                        </Paragraph>
                      </div>
                    )}
                  </Panel>
                </Collapse>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
