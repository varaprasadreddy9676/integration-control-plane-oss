import { useState } from 'react';
import { Form, Input } from "@/components/common/LegacyAntdControls";
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button } from '../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../components/common';

const LoginStyles = () => (
  <style>{`
    .login-workspace {
      display: grid;
      min-height: 100vh;
      place-items: center;
      padding: 32px 20px;
      background: var(--color-bg-base);
      color: var(--color-text-primary);
    }

    .login-content {
      width: 100%;
      max-width: 380px;
    }

    .login-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 32px;
    }

    .login-brand-icon {
      display: grid;
      width: 32px;
      height: 32px;
      flex: 0 0 32px;
      place-items: center;
      border: 1px solid var(--color-border-default);
      border-radius: 4px;
      color: var(--color-accent-text);
      background: var(--color-bg-surface);
    }

    .login-brand-name {
      color: var(--color-text-primary) !important;
      font-size: 14px;
      font-weight: 600;
    }

    .login-heading {
      margin-bottom: 24px;
    }

    .login-title {
      margin: 0 0 6px !important;
      color: var(--color-text-primary) !important;
      font-size: 22px !important;
      font-weight: 600 !important;
      line-height: 1.3;
    }

    .login-description {
      color: var(--color-text-secondary);
      font-size: 13px;
      line-height: 1.5;
    }

    .login-form .ant-form-item {
      margin-bottom: 16px;
    }

    .login-form .ant-form-item-label > label {
      color: var(--color-text-secondary);
      font-size: 12px;
      font-weight: 500;
    }

    .login-form .ant-input-affix-wrapper {
      min-height: 38px;
      border-radius: 4px;
    }

    .login-form .ant-input-prefix {
      margin-inline-end: 8px;
      color: var(--color-text-muted);
    }

    .login-submit.ant-btn {
      height: 38px;
      margin-top: 4px;
      border-radius: 4px;
      font-weight: 600;
    }

    .login-access-note {
      display: block;
      margin-top: 20px;
      color: var(--color-text-muted);
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
    }

    @media (max-width: 480px) {
      .login-workspace {
        padding: 24px 20px;
      }

      .login-brand {
        margin-bottom: 28px;
      }
    }
  `}</style>
);

export const LoginRoute = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: { email: string; password: string }) => {
    setError(null);
    setLoading(true);
    try {
      localStorage.removeItem('integration_gateway_entity_rid');
      sessionStorage.removeItem('integration_gateway_entity_rid');
      await login(values.email, values.password);
      const redirect = sessionStorage.getItem('auth_redirect') || '/dashboard';
      sessionStorage.removeItem('auth_redirect');
      navigate(redirect, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-workspace">
      <LoginStyles />
      <section className="login-content" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="login-brand-icon" aria-hidden="true">
            <GatewayIcon name="ApiOutlined" />
          </span>
          <Text className="login-brand-name">Integration Gateway</Text>
        </div>

        <header className="login-heading">
          <Heading id="login-title" level={1} className="login-title">
            Sign in
          </Heading>
          <Text className="login-description">Access your organization's integration workspace.</Text>
        </header>

        {error && <Notice type="error" message={error} className="console-margin-bottom-4" />}

        <Form className="login-form" layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: 'Enter your email address' },
              { type: 'email', message: 'Enter a valid email address' },
            ]}
          >
            <Input
              prefix={<GatewayIcon name="MailOutlined" aria-hidden="true" />}
              placeholder="name@company.com"
              autoComplete="username"
              inputMode="email"
            />
          </Form.Item>

          <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Enter your password' }]}>
            <Input.Password
              prefix={<GatewayIcon name="LockOutlined" aria-hidden="true" />}
              placeholder="Password"
              autoComplete="current-password"
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={loading} block className="login-submit">
            Sign in
          </Button>
        </Form>

        <Text className="login-access-note">Need access? Contact your system administrator.</Text>
      </section>
    </main>
  );
};
