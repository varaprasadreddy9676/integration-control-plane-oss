import { Col, Form, Input, InputNumber, Row, Select, Space } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import { spacingToNumber } from '../../../../design-system/utils';
import { InlineHint } from '../../../../components/common/InlineHint';
import { Button } from '../../../../components/common/LegacyButton';
import { Row as ItemRow, RowList } from '../../../../design-system/primitives';

const MAX_CHECKS = 5;

interface PreDeliveryChecksSectionProps {
  spacing: any;
}

/**
 * PreDeliveryChecksSection - URLs to check before each delivery
 *
 * For targets that accept a request and download a linked URL later (a
 * document or image inside a message). The gateway fetches the URL first;
 * a temporary failure retries the delivery, a permanent one fails it.
 */
export const PreDeliveryChecksSection = ({ spacing }: PreDeliveryChecksSectionProps) => (
  <Form.List name="preDeliveryChecks">
    {(fields, { add, remove }) => (
      <Space direction="vertical" size={spacing[3]} className="console-width-full">
        {fields.length === 0 && (
          <InlineHint tone="info">No checks. Deliveries are sent without fetching any linked URL first.</InlineHint>
        )}

        <RowList label="Pre-delivery checks">
          {fields.map((field, index) => (
            <ItemRow
              key={field.key}
              title={`Check ${index + 1}`}
              actions={
                <Button
                  type="text"
                  danger
                  icon={<GatewayIcon name="DeleteOutlined" />}
                  aria-label={`Remove check ${index + 1}`}
                  onClick={() => remove(field.name)}
                />
              }
            >
              <Row gutter={[spacingToNumber(spacing[4]), 0]}>
                <Col xs={24} md={12}>
                  <Form.Item name={[field.name, 'name']} label="Name">
                    <Input placeholder="Document link" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name={[field.name, 'urlPath']}
                    label="URL field"
                    rules={[{ required: true, message: 'Enter the field that holds the URL' }]}
                    tooltip="Dot path to the URL, for example template.header.document.link. Use numbers for list items: components.0.url"
                  >
                    <Input placeholder="template.header.document.link" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name={[field.name, 'source']}
                    label="Read URL from"
                    initialValue="request"
                    tooltip="The transformed request that is sent to the target, or the original event"
                  >
                    <Select
                      options={[
                        { value: 'request', label: 'Transformed request' },
                        { value: 'event', label: 'Original event' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name={[field.name, 'method']}
                    label="Method"
                    initialValue="GET"
                    tooltip="GET downloads the whole response, which also warms any cache on the URL's server. HEAD only checks the status."
                  >
                    <Select
                      options={[
                        { value: 'GET', label: 'GET (download)' },
                        { value: 'HEAD', label: 'HEAD (status only)' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name={[field.name, 'timeoutMs']} label="Timeout" initialValue={30000}>
                    <InputNumber min={1000} max={120000} step={1000} addonAfter="ms" className="console-width-full" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name={[field.name, 'onMissingUrl']} label="When the field is empty" initialValue="PASS">
                    <Select
                      options={[
                        { value: 'PASS', label: 'Send anyway' },
                        { value: 'FAIL', label: 'Fail the delivery' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name={[field.name, 'expectedContentTypes']}
                    label="Expected content types"
                    tooltip="Optional. The response must start with one of these, for example application/pdf"
                  >
                    <Select mode="tags" placeholder="application/pdf" tokenSeparators={[',']} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name={[field.name, 'minBytes']}
                    label="Minimum size"
                    tooltip="Optional. Smaller responses fail the check (GET only)"
                  >
                    <InputNumber min={0} addonAfter="bytes" className="console-width-full" />
                  </Form.Item>
                </Col>
              </Row>
            </ItemRow>
          ))}
        </RowList>

        {fields.length > 0 && (
          <InlineHint tone="warning">
            Timeouts, network errors and HTTP 408, 425, 429 or 5xx retry the delivery with the usual backoff. Any other
            status, a wrong content type or a too-small response fails it without retrying.
          </InlineHint>
        )}

        {fields.length < MAX_CHECKS && (
          <Button type="dashed" icon={<GatewayIcon name="PlusOutlined" />} onClick={() => add()}>
            Add URL check
          </Button>
        )}
      </Space>
    )}
  </Form.List>
);
