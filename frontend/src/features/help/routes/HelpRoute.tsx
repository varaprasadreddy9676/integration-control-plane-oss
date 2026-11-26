import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';

export const HelpRoute = () => {
  const navigate = useNavigateWithParams();
  const { spacing } = useDesignTokens();

  return (
    <PageTemplate
      title="Help & documentation"
      description="Reference material for configuring and operating the integration gateway."
      breadcrumb={[{ label: 'Help' }]}
      compact
      contentClassName="help-page-content"
    >
      <div className="ui-extracted-81230cfc0f">
        <Section variant="section" padding={3}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing[3], flexWrap: 'wrap' }}>
            <span
              aria-hidden="true"
              style={{
                color: cssVar.text.secondary,
                display: 'flex',
                fontSize: 'var(--console-type-section)',
                paddingTop: 'var(--spacing-1)',
              }}
            >
              <GatewayIcon name="DatabaseOutlined" />
            </span>
            <div className="ui-extracted-b9b5e1cf82">
              <Text as="div" display="block" weight="semibold" className="console-type-control">
                Lookup tables
              </Text>
              <Text
                as="div"
                display="block"
                type="supporting"
                style={{ fontSize: 'var(--console-type-body)', marginTop: spacing[1] }}
              >
                Learn how mappings resolve source and target codes, entity overrides, and unmapped values.
              </Text>
            </div>
            <Button
              label="Open guide"
              variant="secondary"
              size="sm"
              icon={<GatewayIcon name="ArrowRightOutlined" aria-hidden="true" />}
              className="ui-extracted-dc3476420a"
              onClick={() => navigate('/help/lookup-guide')}
            />
          </div>
        </Section>
      </div>
    </PageTemplate>
  );
};
