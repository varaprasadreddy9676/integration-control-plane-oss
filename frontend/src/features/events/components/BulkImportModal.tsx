import { useState } from 'react';
import { Modal, Upload, Progress, Space, Input, message, Checkbox } from "@/components/common/LegacyAntdControls";
import { Banner } from '@astryxdesign/core/Banner';
import { Tab, TabList } from '@astryxdesign/core';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import type { UploadFile } from "@/components/common/LegacyAntdControls";
import { bulkImportEvents, bulkImportEventsJSON, downloadImportTemplate } from '../../../services/api';
import { cssVar } from '../../../design-system/utils';
import { Button } from '../../../components/common/LegacyButton';

interface ImportResult {
  success: boolean;
  summary: {
    total: number;
    successful: number;
    failed: number;
    duplicates: number;
  };
  results: {
    successful: Array<{
      index: number;
      eventId?: string;
      eventType: string;
      status: string;
    }>;
    failed: Array<{
      index: number;
      eventType: string;
      error: string;
      code: string;
    }>;
    duplicates: Array<{
      index: number;
      eventType: string;
      error: string;
      code: string;
    }>;
  };
  parseErrors?: Array<{
    row: number;
    error: string;
  }>;
}

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const BulkImportModal = ({ open, onClose, onSuccess }: BulkImportModalProps) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importMode, setImportMode] = useState<'file' | 'json'>('file');
  const [jsonInput, setJsonInput] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [continueOnError, setContinueOnError] = useState(true);

  const handleImport = async (validateOnly: boolean) => {
    setImporting(true);
    setResult(null);

    try {
      let data: ImportResult;

      if (importMode === 'file') {
        if (fileList.length === 0) {
          message.error('Please select a file to import');
          setImporting(false);
          return;
        }

        data = await bulkImportEvents(fileList[0].originFileObj as File, validateOnly, continueOnError);
      } else {
        if (!jsonInput.trim()) {
          message.error('Please enter JSON data to import');
          setImporting(false);
          return;
        }

        try {
          const parsedData = JSON.parse(jsonInput);
          const events = Array.isArray(parsedData) ? parsedData : parsedData.events;

          if (!events || !Array.isArray(events)) {
            message.error('JSON must contain an "events" array or be an array');
            setImporting(false);
            return;
          }

          data = await bulkImportEventsJSON(events, validateOnly, continueOnError);
        } catch (error: any) {
          message.error('Invalid JSON: ' + error.message);
          setImporting(false);
          return;
        }
      }

      setResult(data);

      if (data.success && !validateOnly) {
        message.success(`Successfully imported ${data.summary.successful} events`);
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 2000);
      } else if (validateOnly) {
        if (data.summary.failed === 0) {
          message.success(`Validation complete. All ${data.summary.total} events are valid.`);
        } else {
          message.warning(`Validation complete. ${data.summary.failed} events have errors.`);
        }
      } else if (data.summary.failed > 0) {
        message.warning(
          `Partial import: ${data.summary.successful} successful, ${data.summary.failed} failed, ${data.summary.duplicates} duplicates`
        );
      }
    } catch (error: any) {
      message.error('Import failed: ' + (error.message || 'Unknown error'));
      console.error('Import error:', error);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setFileList([]);
    setJsonInput('');
    setResult(null);
    setDryRun(false);
    onClose();
  };

  const handleDownloadTemplate = (format: 'csv' | 'xlsx' | 'json') => {
    downloadImportTemplate(format);
  };

  return (
    <Modal
      title="Bulk Import Events"
      open={open}
      onCancel={handleClose}
      width={900}
      footer={[
        <Button key="close" onClick={handleClose} disabled={importing}>
          Close
        </Button>,
        <Button key="validate" onClick={() => handleImport(true)} disabled={importing} loading={importing}>
          Validate Only
        </Button>,
        <Button
          key="import"
          type="primary"
          onClick={() => handleImport(false)}
          loading={importing}
          disabled={importing}
        >
          Import Events
        </Button>,
      ]}
    >
      <Space direction="vertical" className="console-width-full" size="large">
        <Banner
          title="Import up to 1000 events at once"
          description="Events will be processed through existing OUTBOUND integrations automatically. Supported formats: CSV, Excel (XLSX/XLS), JSON."
          status="info"
        />

        <TabList
          role="tablist"
          aria-label="Import input format"
          value={importMode}
          onChange={(key) => {
            setImportMode(key as 'file' | 'json');
            setResult(null);
          }}
          hasDivider
        >
          <Tab id="file-upload-tab" value="file" label="File Upload" panelId="file-upload-panel" />
          <Tab id="json-input-tab" value="json" label="JSON Input" panelId="json-input-panel" />
        </TabList>

        <div
          id="file-upload-panel"
          role="tabpanel"
          aria-labelledby="file-upload-tab"
          hidden={importMode !== 'file'}
          tabIndex={0}
        >
          <Space direction="vertical" className="console-width-full" size="middle">
            <Upload
              maxCount={1}
              fileList={fileList}
              onChange={({ fileList: newFileList }) => {
                setFileList(newFileList);
                setResult(null);
              }}
              beforeUpload={() => false}
              accept=".csv,.xlsx,.xls,.json"
              onRemove={() => {
                setFileList([]);
                setResult(null);
              }}
            >
              <Button icon={<GatewayIcon name="UploadOutlined" />}>Select File (CSV, Excel, JSON)</Button>
            </Upload>

            <div>
              <strong>Download Templates:</strong>
              <Space className="ui-extracted-6d1808fc27">
                <Button
                  size="small"
                  icon={<GatewayIcon name="DownloadOutlined" />}
                  onClick={() => handleDownloadTemplate('xlsx')}
                >
                  Excel
                </Button>
                <Button
                  size="small"
                  icon={<GatewayIcon name="DownloadOutlined" />}
                  onClick={() => handleDownloadTemplate('csv')}
                >
                  CSV
                </Button>
                <Button
                  size="small"
                  icon={<GatewayIcon name="DownloadOutlined" />}
                  onClick={() => handleDownloadTemplate('json')}
                >
                  JSON
                </Button>
              </Space>
            </div>
          </Space>
        </div>

        <div
          id="json-input-panel"
          role="tabpanel"
          aria-labelledby="json-input-tab"
          hidden={importMode !== 'json'}
          tabIndex={0}
        >
          <Space direction="vertical" className="console-width-full" size="middle">
            <Input.TextArea
              rows={12}
              placeholder={`Paste JSON array or object with events array:
[
  {
    "eventType": "APPOINTMENT_SCHEDULED",
    "tenantId": 12345,
    "payload": {
      "entityId": 100,
      "doctorId": 50,
      "appointmentDate": "2024-03-20"
    },
    "source": "BULK_IMPORT",
    "sourceId": "optional-id"
  }
]`}
              value={jsonInput}
              onChange={(e) => {
                setJsonInput(e.target.value);
                setResult(null);
              }}
              className="console-mono-caption"
            />

            <Button
              size="small"
              icon={<GatewayIcon name="DownloadOutlined" />}
              onClick={() => handleDownloadTemplate('json')}
            >
              Download JSON Template
            </Button>
          </Space>
        </div>

        <Checkbox checked={continueOnError} onChange={(e) => setContinueOnError(e.target.checked)}>
          Continue on error (import valid events even if some fail)
        </Checkbox>

        {importing && (
          <div>
            <Progress percent={100} status="active" />
            <div className="ui-extracted-e22abc11d6">
              Processing import...
            </div>
          </div>
        )}

        {result && (
          <Space direction="vertical" className="console-width-full" size="middle">
            <Banner
              status={result.success ? 'success' : result.summary.successful > 0 ? 'warning' : 'error'}
              title={`Import ${result.summary.failed === 0 && result.summary.duplicates === 0 ? 'Successful' : 'Completed with Issues'}`}
              description={
                <div className="console-type-body">
                  <div>
                    <strong>Total:</strong> {result.summary.total}
                  </div>
                  <div className="console-text-success">
                    <strong>Successful:</strong> {result.summary.successful}
                  </div>
                  <div style={{ color: cssVar.warning.text }}>
                    <strong>Duplicates:</strong> {result.summary.duplicates}
                  </div>
                  <div className="console-text-error">
                    <strong>Failed:</strong> {result.summary.failed}
                  </div>
                </div>
              }
            />

            {result.parseErrors && result.parseErrors.length > 0 && (
              <Banner
                status="warning"
                title={`${result.parseErrors.length} Parse Errors`}
                description={
                  <div
                    className="ui-extracted-85050fcaa5"
                  >
                    {result.parseErrors.slice(0, 10).map((err, idx) => (
                      <div key={idx} className="console-margin-bottom-1">
                        <strong>Row {err.row}:</strong> {err.error}
                      </div>
                    ))}
                    {result.parseErrors.length > 10 && (
                      <div className="ui-extracted-f40f2d91e4">
                        ... and {result.parseErrors.length - 10} more parse errors
                      </div>
                    )}
                  </div>
                }
              />
            )}

            {result.results.failed.length > 0 && (
              <Banner
                status="error"
                title={`${result.results.failed.length} Validation Failures`}
                description={
                  <div
                    className="ui-extracted-85050fcaa5"
                  >
                    {result.results.failed.slice(0, 10).map((err, idx) => (
                      <div key={idx} className="console-margin-bottom-1">
                        <strong>Event {err.index + 1}</strong> ({err.eventType || 'unknown'}): {err.error}
                      </div>
                    ))}
                    {result.results.failed.length > 10 && (
                      <div className="ui-extracted-f40f2d91e4">
                        ... and {result.results.failed.length - 10} more validation errors
                      </div>
                    )}
                  </div>
                }
              />
            )}

            {result.results.duplicates.length > 0 && (
              <Banner
                status="warning"
                title={`${result.results.duplicates.length} Duplicate Events Skipped`}
                description={
                  <div className="ui-extracted-17a1ad90e6">
                    Events with duplicate eventKey were skipped to avoid reprocessing.
                  </div>
                }
              />
            )}

            {result.summary.successful > 0 && result.summary.failed === 0 && result.summary.duplicates === 0 && (
              <Banner
                status="success"
                title="All events imported successfully"
                description="Events are now being processed through OUTBOUND integrations."
              />
            )}
          </Space>
        )}
      </Space>
    </Modal>
  );
};
