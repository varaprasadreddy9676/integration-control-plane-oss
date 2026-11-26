import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { cssVar, useDesignTokens } from '../../design-system/utils';

interface Props {
  label: string;
  value: string;
  delta?: string;
  icon?: ReactNode;
  color?: string;
  sparkline?: ReactNode;
}

export const MetricCard = ({ label, value, delta, icon, color, sparkline }: Props) => {
  const { spacing } = useDesignTokens();

  return (
    <Section
      variant="section"
      padding={3}
      style={{
        minWidth: 220,
        flex: 1,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: spacing[3],
      }}
    >
      <div className="console-min-width-0">
        <Text as="div" type="supporting" className="console-type-caption">
          {label}
        </Text>
        <Heading
          level={3}
          style={{
            margin: `${spacing[1]} 0 0`,
            fontSize: 'var(--console-type-numeral)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </Heading>
        {delta && (
          <Text
            as="div"
            style={{
              marginTop: spacing[1],
              fontSize: 'var(--console-type-caption)',
              color: delta.startsWith('-') ? cssVar.error.text : cssVar.success.text,
            }}
          >
            {delta}
          </Text>
        )}
      </div>
      {icon && (
        <span
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            flex: '0 0 36px',
            borderRadius: 'var(--radius-base)',
            background: cssVar.bg.subtle,
            display: 'grid',
            placeItems: 'center',
            color: color ?? cssVar.text.secondary,
            fontSize: 'var(--console-type-section)',
          }}
        >
          {icon}
        </span>
      )}
      {sparkline}
    </Section>
  );
};
