import { useState } from 'react';
import { Form, Input } from "@/components/common/LegacyAntdControls";
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button } from '../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../components/common';

import './login.css';

const CHIPS = ['Multi-tenant', 'DLQ + Retries', 'Rate Limits', 'Execution Traces', 'OAuth2 / HMAC'];

const PILLARS = [
  {
    icon: 'ThunderboltOutlined',
    title: 'Event-driven delivery',
    text: 'Guaranteed outbound delivery with dead-letter queue, retries and circuit breaker.',
  },
  {
    icon: 'ApiOutlined',
    title: 'Real-time API proxy',
    text: 'Per-tenant routing, auth, payload transformation and rate limiting for inbound requests.',
  },
  {
    icon: 'ClockCircleOutlined',
    title: 'Scheduled automation',
    text: 'Cron and interval jobs that query any data source and deliver to any endpoint.',
  },
] as const;

const HeroPanel = () => (
  <aside className="login-hero" aria-label="About Integration Gateway">
    <div className="login-hero-inner">
      <div className="login-logo">
        <span className="login-logo-mark" aria-hidden="true">
          <GatewayIcon name="ThunderboltOutlined" />
        </span>
        <span className="login-logo-name">Integration Gateway</span>
      </div>

      <div className="login-hero-copy">
        <h2 className="login-headline">
          Enterprise-ready
          <br />
          Integration Control Plane
        </h2>
        <p className="login-subhead">
          Event-driven delivery, real-time proxying and scheduled automation for multi-tenant systems, with built-in
          reliability and observability.
        </p>
        <ul className="login-chips">
          {CHIPS.map((chip) => (
            <li key={chip} className="login-chip">
              {chip}
            </li>
          ))}
        </ul>
        <ul className="login-pillars">
          {PILLARS.map((pillar) => (
            <li key={pillar.title} className="login-pillar">
              <span className="login-pillar-icon" aria-hidden="true">
                <GatewayIcon name={pillar.icon} />
              </span>
              <div>
                <p className="login-pillar-title">{pillar.title}</p>
                <p className="login-pillar-text">{pillar.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div aria-hidden="true" />
    </div>
  </aside>
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
    <main className="login-root">
      <HeroPanel />
      <div className="login-panel">
        <section className="login-content" aria-labelledby="login-title">
          <div className="login-mobile-brand">
            <span className="login-logo-mark" aria-hidden="true">
              <GatewayIcon name="ThunderboltOutlined" />
            </span>
            <Text className="login-mobile-brand-name">Integration Gateway</Text>
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
      </div>
    </main>
  );
};
