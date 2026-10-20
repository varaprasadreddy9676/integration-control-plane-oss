import { useMemo, useState, useEffect } from 'react';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Form,
  Input,
  Select,
  Card,
  Space,
  Button,
  Radio,
  Divider,
  Alert,
  message,
  Tabs,
  Tag,
  Typography,
  Collapse,
  Modal,
  Spin,
  Segmented,
} from 'antd';
import {
  SaveOutlined,
  PlayCircleOutlined,
  DatabaseOutlined,
  ApiOutlined,
  CodeOutlined,
  LockOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { PageHeader } from '../../../components/common/PageHeader';
import { InlineHint } from '../../../components/common/InlineHint';
import { CronBuilder } from '../components/CronBuilder';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';
import {
  getScheduledJobById,
  createScheduledJob,
  updateScheduledJob,
  executeScheduledJob,
  installScheduledJobDependencies,
  revealScheduledJobEnvVar,
  getScheduledJobLogs,
  getUIConfig,
  testDataSource,
} from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { AuthenticationFields } from '../../../shared/integration-forms';
import { useAuth } from '../../../app/auth-context';
import { ModernTable } from '../../../components/common/ModernTable';

const { TextArea } = Input;
const { Text } = Typography;

const DATA_SOURCE_TYPES = [
  { value: 'SQL', label: 'SQL Query', icon: <DatabaseOutlined /> },
  { value: 'MONGODB', label: 'MongoDB Aggregation', icon: <DatabaseOutlined /> },
  { value: 'API', label: 'Internal API', icon: <ApiOutlined /> },
];

type DestinationType = 'HTTP_API' | 'INTERNAL_EVENT' | 'SQL_WRITE' | 'MONGODB_WRITE';
type JobMode = 'SCHEDULED' | 'SCRIPT_JOB';

const DESTINATION_TYPES: { value: DestinationType; label: string; description: string }[] = [
  { value: 'HTTP_API', label: 'HTTP API', description: 'POST transformed data to an external HTTP endpoint' },
  {
    value: 'INTERNAL_EVENT',
    label: 'Internal Event',
    description: 'Push as an internal event (triggers other integrations)',
  },
  { value: 'SQL_WRITE', label: 'SQL Write', description: 'Execute a SQL INSERT / UPDATE with the payload' },
  {
    value: 'MONGODB_WRITE',
    label: 'MongoDB Write',
    description: 'Insert or upsert a document into a MongoDB collection',
  },
];

const SQL_EXAMPLE = `SELECT
  b.billId,
  b.entityId,
  b.totalAmount,
  b.createdDate
FROM bills b
WHERE DATE(b.createdDate) = CURDATE()
  AND b.entityRid = {{config.tenantId}}
ORDER BY b.createdDate DESC`;

const MONGODB_EXAMPLE = `[
  {
    "$match": {
      "tenantId": "{{config.tenantId}}",
      "appointmentDate": {
        "$gte": "{{date.todayStart()}}",
        "$lt": "{{date.todayEnd()}}"
      },
      "status": "CONFIRMED"
    }
  },
  {
    "$project": {
      "entityId": 1,
      "name": 1,
      "appointmentDate": 1,
      "doctorName": 1,
      "status": 1
    }
  }
]`;

const API_EXAMPLE = `// Example for GET request
{
  "url": "http://localhost:4000/api/v1/analytics/summary",
  "method": "GET",
  "headers": {
    "X-API-Key": "{{env.API_KEY}}"
  }
}

// Example for POST request with body
{
  "url": "http://localhost:4000/api/v1/reports/generate",
  "method": "POST",
  "headers": {
    "X-API-Key": "{{env.API_KEY}}",
    "Content-Type": "application/json"
  },
  "body": {
    "reportType": "daily_summary",
    "date": "{{date.today()}}"
  }
}`;

export const ScheduledJobDetailRoute = () => {
  // The name the list passed along, shown until the record loads (title morph target).
  const passedTitle = (useLocation().state as { title?: string } | null)?.title;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const [form] = Form.useForm();
  // Script jobs in particular hold a lot of typed-in work (the script body,
  // env vars, cron) — losing it to a refresh or a mis-clicked Cancel is costly.
  const hasUnsavedChanges = () => form.isFieldsTouched();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const orgId = searchParams.get('orgId');
  const isCreate = id === 'new';

  const [dataSourceType, setDataSourceType] = useState<'SQL' | 'MONGODB' | 'API'>('SQL');
  const [scheduleType, setScheduleType] = useState<'CRON' | 'INTERVAL'>('CRON');
  const [transformationMode, setTransformationMode] = useState<'SIMPLE' | 'SCRIPT'>('SCRIPT');
  const [sqlConnectionMode, setSqlConnectionMode] = useState<'STRING' | 'FIELDS'>('FIELDS');
  const [destinationType, setDestinationType] = useState<DestinationType>('HTTP_API');
  const [jobMode, setJobMode] = useState<JobMode>('SCHEDULED');

  // Editor values (needed for Monaco Editor to work with Ant Design Form)
  const [sqlQuery, setSqlQuery] = useState('');
  const [mongoPipeline, setMongoPipeline] = useState('');
  const [apiHeaders, setApiHeaders] = useState('');
  const [apiBody, setApiBody] = useState('');
  const [transformScript, setTransformScript] = useState('');

  // Test data source modal state
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Watch auth type from form
  const authType = Form.useWatch('outgoingAuthType', form) || 'NONE';

  // Watch form fields to trigger re-render and unlock tabs dynamically
  const formName = Form.useWatch('name', form);
  const formType = Form.useWatch('type', form);
  const formCronExpression = Form.useWatch('cronExpression', form);
  const formIntervalMs = Form.useWatch('intervalMs', form);
  const formSqlQuery = Form.useWatch('sqlQuery', form);
  const formSqlConnectionString = Form.useWatch('sqlConnectionString', form);
  const formSqlHost = Form.useWatch('sqlHost', form);
  const formSqlPort = Form.useWatch('sqlPort', form);
  const formSqlUsername = Form.useWatch('sqlUsername', form);
  const formSqlPassword = Form.useWatch('sqlPassword', form);
  const formSqlDatabase = Form.useWatch('sqlDatabase', form);
  const formMongoQuery = Form.useWatch('mongoQuery', form);
  const formApiUrl = Form.useWatch('apiUrl', form);
  const formTransformScript = Form.useWatch('transformScript', form);
  const formRuntime = Form.useWatch('runtime', form) || 'VM_SANDBOX';
  const isNodeProcess = formRuntime === 'NODE_PROCESS';
  const formTargetUrl = Form.useWatch('targetUrl', form);
  // Destination field watchers — needed so tab-unlock re-evaluates when these change
  const formDestSqlQuery = Form.useWatch('destSqlQuery', form);
  const formDestCollection = Form.useWatch('destCollection', form);

  // Fetch UI config for auth types
  const { data: uiConfig } = useQuery({
    queryKey: ['ui-config'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch job details
  const { data: job, isLoading } = useQuery({
    queryKey: ['scheduled-job', id],
    queryFn: () => getScheduledJobById(id!, orgId!),
    enabled: !isCreate && !!id,
    staleTime: 30_000,
    refetchInterval: (query) =>
      ['pending', 'installing'].includes((query.state.data as any)?.depsStatus) ? 3000 : false,
  });

  // Execution history. Previously this tab rendered `job.lastExecution`, a field
  // the backend never writes — so it always claimed "No executions yet" even for
  // jobs that had run hundreds of times. The /logs endpoint is the real source.
  const {
    data: executions,
    isLoading: executionsLoading,
    refetch: refetchExecutions,
  } = useQuery({
    queryKey: ['scheduled-job-logs', id],
    queryFn: () => getScheduledJobLogs(id!, { limit: 20 }, orgId),
    enabled: !isCreate && !!id,
    staleTime: 10_000,
    // A run triggered from this page takes a few seconds; poll briefly so the
    // result appears without the user reloading.
    refetchInterval: (query) =>
      ((query.state.data as any[]) || []).some((log) => log?.status === 'RUNNING') ? 3000 : false,
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (values: any) => {
      const schedule = {
        type: scheduleType,
        ...(scheduleType === 'CRON'
          ? {
              expression: values.cronExpression,
              timezone: values.timezone || 'UTC',
            }
          : {
              intervalMs: values.intervalMs,
            }),
      };

      const environmentVariables = (values.environmentVariables || [])
        .filter((row: any) => row?.key || row?.value || row?.secretKey)
        .map((row: any) => ({
          key: String(row.key || '')
            .trim()
            .toUpperCase(),
          value: row.value || undefined,
          secretKey: row.secretKey,
        }));

      const dependencies = (values.dependencies || [])
        .filter((row: any) => row?.name)
        .map((row: any) => ({ name: String(row.name).trim(), version: String(row.version || 'latest').trim() }));

      const payload =
        jobMode === 'SCRIPT_JOB'
          ? {
              name: values.name,
              type: values.type,
              description: values.description,
              isActive: values.isActive !== false,
              direction: 'SCRIPT_JOB',
              schedule,
              script: values.transformScript,
              environmentVariables,
              runtime: values.runtime || 'VM_SANDBOX',
              ...(values.runtime === 'NODE_PROCESS' ? { dependencies } : {}),
            }
          : {
              ...values,
              direction: 'SCHEDULED',
              schedule,
              dataSource: {
                type: dataSourceType,
                ...(dataSourceType === 'SQL'
                  ? {
                      query: values.sqlQuery,
                      ...(sqlConnectionMode === 'STRING' && values.sqlConnectionString?.trim()
                        ? { connectionString: values.sqlConnectionString.trim() }
                        : {}),
                      ...(sqlConnectionMode === 'FIELDS' && values.sqlHost?.trim()
                        ? { host: values.sqlHost.trim() }
                        : {}),
                      ...(sqlConnectionMode === 'FIELDS' && values.sqlPort ? { port: Number(values.sqlPort) } : {}),
                      ...(sqlConnectionMode === 'FIELDS' && values.sqlUsername?.trim()
                        ? { username: values.sqlUsername.trim() }
                        : {}),
                      ...(sqlConnectionMode === 'FIELDS' && values.sqlPassword ? { password: values.sqlPassword } : {}),
                      ...(sqlConnectionMode === 'FIELDS' && values.sqlDatabase?.trim()
                        ? { database: values.sqlDatabase.trim() }
                        : {}),
                    }
                  : dataSourceType === 'MONGODB'
                    ? {
                        connectionString: values.mongoConnectionString,
                        database: values.mongoDatabase,
                        collection: values.mongoCollection,
                        pipeline: JSON.parse(values.mongoPipeline),
                      }
                    : {
                        url: values.apiUrl,
                        method: values.apiMethod || 'GET',
                        headers: values.apiHeaders ? JSON.parse(values.apiHeaders) : {},
                        body: values.apiBody ? JSON.parse(values.apiBody) : undefined,
                      }),
              },
              transformation: {
                mode: transformationMode,
                ...(transformationMode === 'SCRIPT'
                  ? {
                      script: values.transformScript,
                    }
                  : {
                      mappings: values.fieldMappings || [],
                    }),
              },
              outgoingAuthType: values.outgoingAuthType || 'NONE',
              outgoingAuthConfig: values.outgoingAuthConfig || undefined,
              destinationType: destinationType || 'HTTP_API',
              // Build destination config for non-HTTP delivery types
              ...(destinationType === 'INTERNAL_EVENT'
                ? { destination: { eventType: values.destEventType || '' } }
                : destinationType === 'SQL_WRITE'
                  ? { destination: { query: values.destSqlQuery || '' } }
                  : destinationType === 'MONGODB_WRITE'
                    ? {
                        destination: {
                          collection: values.destCollection || '',
                          operation: values.destOperation || 'insert',
                          ...(values.destOperation === 'upsert' && values.destFilter?.trim()
                            ? { filter: JSON.parse(values.destFilter) }
                            : {}),
                        },
                      }
                    : {}),
              // targetUrl only relevant for HTTP_API
              targetUrl: destinationType === 'HTTP_API' ? values.targetUrl : undefined,
              httpMethod: destinationType === 'HTTP_API' ? values.httpMethod || 'POST' : undefined,
            };

      if (isCreate) {
        return createScheduledJob(payload, orgId!);
      } else {
        return updateScheduledJob(id!, payload, orgId!);
      }
    },
    onSuccess: () => {
      message.success(`Scheduled job ${isCreate ? 'created' : 'updated'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
      navigate(`/scheduled-jobs?orgId=${orgId}`);
    },
    onError: (error: any) => {
      message.error(error.message || `Failed to ${isCreate ? 'create' : 'update'} scheduled job`);
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: (options?: { dryRun?: boolean; reason?: string }) => executeScheduledJob(id!, orgId!, options),
    onSuccess: (result) => {
      message.success(result.dryRun ? 'Dry-run execution triggered' : 'Job execution triggered');
      queryClient.invalidateQueries({ queryKey: ['scheduled-job', id] });
    },
    onError: () => {
      message.error('Failed to trigger job execution');
    },
  });

  const installDepsMutation = useMutation({
    mutationFn: () => installScheduledJobDependencies(id!, orgId!),
    onSuccess: () => {
      message.success('Dependency install started');
      queryClient.invalidateQueries({ queryKey: ['scheduled-job', id] });
    },
    onError: () => {
      message.error('Failed to start dependency install');
    },
  });

  // Indexed by the env var row's form field name, not its key, so both survive
  // reordering while editing. `fetchedEnvVars` tracks whether we've pulled the
  // real value into the form field at all (button becomes unnecessary after);
  // `visibleEnvVars` is just the show/hide state of that same masked input,
  // toggled via its normal eye icon like any other password-style field.
  const [fetchedEnvVars, setFetchedEnvVars] = useState<Record<number, boolean>>({});
  const [visibleEnvVars, setVisibleEnvVars] = useState<Record<number, boolean>>({});
  const [revealingEnvVar, setRevealingEnvVar] = useState<number | null>(null);

  const handleRevealEnvVar = async (fieldName: number, envKey: string) => {
    if (!id || !envKey) return;
    setRevealingEnvVar(fieldName);
    try {
      const { value } = await revealScheduledJobEnvVar(id, envKey, orgId);
      form.setFieldValue(['environmentVariables', fieldName, 'value'], value);
      setFetchedEnvVars((prev) => ({ ...prev, [fieldName]: true }));
      setVisibleEnvVars((prev) => ({ ...prev, [fieldName]: true }));
    } catch (error: any) {
      message.error(error?.message || 'Failed to reveal value');
    } finally {
      setRevealingEnvVar(null);
    }
  };

  // Test data source mutation
  const testDataSourceMutation = useMutation({
    mutationFn: async () => {
      const values = form.getFieldsValue();

      // Build data source config based on type
      let dataSourceConfig: any = { type: dataSourceType };

      if (dataSourceType === 'SQL') {
        dataSourceConfig.query = values.sqlQuery;
        if (sqlConnectionMode === 'STRING' && values.sqlConnectionString && values.sqlConnectionString.trim()) {
          dataSourceConfig.connectionString = values.sqlConnectionString.trim();
        }
        if (sqlConnectionMode === 'FIELDS' && values.sqlHost && values.sqlHost.trim()) {
          dataSourceConfig.host = values.sqlHost.trim();
        }
        if (sqlConnectionMode === 'FIELDS' && values.sqlPort) {
          dataSourceConfig.port = Number(values.sqlPort);
        }
        if (sqlConnectionMode === 'FIELDS' && values.sqlUsername && values.sqlUsername.trim()) {
          dataSourceConfig.username = values.sqlUsername.trim();
        }
        if (sqlConnectionMode === 'FIELDS' && values.sqlPassword) {
          dataSourceConfig.password = values.sqlPassword;
        }
        if (sqlConnectionMode === 'FIELDS' && values.sqlDatabase && values.sqlDatabase.trim()) {
          dataSourceConfig.database = values.sqlDatabase.trim();
        }
      } else if (dataSourceType === 'MONGODB') {
        dataSourceConfig.connectionString = values.mongoConnectionString;
        dataSourceConfig.database = values.mongoDatabase;
        dataSourceConfig.collection = values.mongoCollection;

        // Validate and parse MongoDB pipeline
        try {
          dataSourceConfig.pipeline = JSON.parse(values.mongoPipeline || '[]');
          if (!Array.isArray(dataSourceConfig.pipeline)) {
            throw new Error('MongoDB pipeline must be an array');
          }
        } catch (e) {
          throw new Error(`Invalid MongoDB Pipeline JSON: ${e instanceof Error ? e.message : 'Invalid format'}`);
        }
      } else if (dataSourceType === 'API') {
        dataSourceConfig.url = values.apiUrl;
        dataSourceConfig.method = values.apiMethod || 'GET';

        // Validate and parse API headers
        if (values.apiHeaders && values.apiHeaders.trim()) {
          try {
            dataSourceConfig.headers = JSON.parse(values.apiHeaders);
          } catch (e) {
            throw new Error(`Invalid API Headers JSON: ${e instanceof Error ? e.message : 'Invalid format'}`);
          }
        } else {
          dataSourceConfig.headers = {};
        }

        // Validate and parse API body
        if (values.apiBody && values.apiBody.trim()) {
          try {
            dataSourceConfig.body = JSON.parse(values.apiBody);
          } catch (e) {
            throw new Error(`Invalid API Body JSON: ${e instanceof Error ? e.message : 'Invalid format'}`);
          }
        }
      }

      return await testDataSource(dataSourceConfig, orgId);
    },
    onSuccess: (result) => {
      setTestResult(result);
      setTestModalOpen(true);
      if (result.success) {
        message.success('Data source test successful');
      }
    },
    onError: (error: any) => {
      setTestResult({
        success: false,
        error: error.message || 'Failed to test data source',
        details: error,
      });
      setTestModalOpen(true);
      message.error(error.message || 'Failed to test data source');
    },
  });

  // Initialize default values for new jobs
  useEffect(() => {
    if (isCreate) {
      const defaultTransformScript =
        '// Transform the data\nreturn {\n  date: new Date().toISOString(),\n  data: payload.data\n};';
      setTransformScript(defaultTransformScript);
    }
  }, [isCreate]);

  // Populate form with existing job data
  useEffect(() => {
    if (job) {
      const loadedJobMode: JobMode = job.direction === 'SCRIPT_JOB' ? 'SCRIPT_JOB' : 'SCHEDULED';
      setJobMode(loadedJobMode);
      setDataSourceType(job.dataSource?.type || 'SQL');
      setScheduleType(job.schedule?.type || 'CRON');
      setTransformationMode(job.transformation?.mode || 'SCRIPT');
      setDestinationType((job as any).destinationType || 'HTTP_API');

      // Set editor states
      setSqlQuery(job.dataSource?.query || '');
      setMongoPipeline(job.dataSource?.pipeline ? JSON.stringify(job.dataSource.pipeline, null, 2) : '');
      setApiHeaders(job.dataSource?.headers ? JSON.stringify(job.dataSource.headers, null, 2) : '');
      setApiBody(job.dataSource?.body ? JSON.stringify(job.dataSource.body, null, 2) : '');
      setTransformScript(loadedJobMode === 'SCRIPT_JOB' ? job.script || '' : job.transformation?.script || '');

      form.setFieldsValue({
        name: job.name,
        type: job.type,
        direction: loadedJobMode,
        description: job.description,
        targetUrl: job.targetUrl,
        httpMethod: job.httpMethod || 'POST',
        isActive: job.isActive !== false,
        cronExpression: job.schedule?.expression,
        timezone: job.schedule?.timezone || 'UTC',
        intervalMs: job.schedule?.intervalMs,
        sqlQuery: job.dataSource?.query,
        sqlConnectionString: job.dataSource?.connectionString || '',
        sqlHost: job.dataSource?.host || job.dataSource?.hostname || '',
        sqlPort: job.dataSource?.port,
        sqlUsername: job.dataSource?.username || job.dataSource?.user || '',
        sqlPassword: job.dataSource?.password || '',
        sqlDatabase: job.dataSource?.database || '',
        mongoConnectionString: job.dataSource?.connectionString || '',
        mongoDatabase: job.dataSource?.database || '',
        mongoCollection: job.dataSource?.collection || '',
        mongoPipeline: job.dataSource?.pipeline ? JSON.stringify(job.dataSource.pipeline, null, 2) : '',
        apiUrl: job.dataSource?.url,
        apiMethod: job.dataSource?.method,
        apiHeaders: job.dataSource?.headers ? JSON.stringify(job.dataSource.headers, null, 2) : '',
        apiBody: job.dataSource?.body ? JSON.stringify(job.dataSource.body, null, 2) : '',
        transformScript: loadedJobMode === 'SCRIPT_JOB' ? job.script || '' : job.transformation?.script || '',
        environmentVariables: (job.environmentVariables || []).map((row: any) => ({
          key: row.key,
          secretKey: row.secretKey,
          hasValue: row.hasValue,
        })),
        runtime: (job as any).runtime || 'VM_SANDBOX',
        dependencies: ((job as any).dependencies || []).map((row: any) => ({
          name: row.name,
          version: row.version,
        })),
        outgoingAuthType: job.outgoingAuthType || 'NONE',
        outgoingAuthConfig: job.outgoingAuthConfig || {},
        // Destination fields
        destEventType: (job as any).destination?.eventType || '',
        destSqlQuery: (job as any).destination?.query || '',
        destCollection: (job as any).destination?.collection || '',
        destOperation: (job as any).destination?.operation || 'insert',
        destFilter: (job as any).destination?.filter ? JSON.stringify((job as any).destination.filter, null, 2) : '',
      });
      const hasFieldConfig = !!(
        job.dataSource?.host ||
        job.dataSource?.hostname ||
        job.dataSource?.port ||
        job.dataSource?.username ||
        job.dataSource?.user ||
        job.dataSource?.database
      );
      if (hasFieldConfig) {
        setSqlConnectionMode('FIELDS');
      } else if (job.dataSource?.connectionString) {
        setSqlConnectionMode('STRING');
      } else {
        setSqlConnectionMode('FIELDS');
      }
    }
  }, [job, form]);

  // Auto-build SQL connection string when fields are provided
  useEffect(() => {
    if (dataSourceType !== 'SQL') return;
    if (sqlConnectionMode !== 'FIELDS') return;
    if (!formSqlHost || !formSqlDatabase) return;

    const portPart = formSqlPort ? `:${formSqlPort}` : '';
    const userPart = formSqlUsername ? encodeURIComponent(formSqlUsername) : '';
    const passPart = formSqlPassword ? `:${encodeURIComponent(formSqlPassword)}` : '';
    const authPart = formSqlUsername ? `${userPart}${passPart}@` : '';
    const connectionString = `mysql://${authPart}${formSqlHost}${portPart}/${formSqlDatabase}`;

    if (formSqlConnectionString !== connectionString) {
      form.setFieldValue('sqlConnectionString', connectionString);
    }
  }, [
    dataSourceType,
    sqlConnectionMode,
    formSqlConnectionString,
    formSqlHost,
    formSqlPort,
    formSqlUsername,
    formSqlPassword,
    formSqlDatabase,
    form,
  ]);

  useUnsavedChangesWarning(hasUnsavedChanges);

  const handleCancel = () => {
    if (!hasUnsavedChanges()) {
      navigate('/scheduled-jobs');
      return;
    }
    Modal.confirm({
      title: 'Discard unsaved changes?',
      content: 'Your edits to this scheduled job have not been saved. Leaving now discards them.',
      okText: 'Discard changes',
      okButtonProps: { danger: true },
      cancelText: 'Keep editing',
      onOk: () => navigate('/scheduled-jobs'),
    });
  };

  const handleSubmit = (values: any) => {
    saveMutation.mutate(values);
  };

  const canTestDataSource = () => {
    const values = form.getFieldsValue();

    if (dataSourceType === 'SQL') {
      return !!values.sqlQuery;
    } else if (dataSourceType === 'MONGODB') {
      return !!(values.mongoConnectionString && values.mongoDatabase && values.mongoCollection && values.mongoPipeline);
    } else if (dataSourceType === 'API') {
      return !!values.apiUrl;
    }

    return false;
  };

  const renderEnvironmentVariables = () => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[2] }}>
        <div>
          <Text strong>Environment Variables</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            Saved values are encrypted and exposed to the script as {isNodeProcess ? 'process.env.KEY' : 'env.KEY'}.
            Click the eye icon to see and edit a saved value (Super Admin only).
          </Text>
        </div>
      </div>

      <Form.List name="environmentVariables">
        {(fields, { add, remove }) => (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            {fields.map(({ key, name, ...restField }) => {
              const row = form.getFieldValue(['environmentVariables', name]) || {};
              const isFetched = fetchedEnvVars[name];
              const isRevealing = revealingEnvVar === name;
              return (
                <div
                  key={key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 2fr) 40px',
                    gap: spacing[2],
                    alignItems: 'start',
                  }}
                >
                  <Form.Item {...restField} name={[name, 'secretKey']} hidden>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, 'key']}
                    rules={[
                      { required: true, message: 'Key is required' },
                      {
                        pattern: /^[A-Z_][A-Z0-9_]*$/,
                        message: 'Use env-style keys, e.g. NOVA_DB_PASSWORD',
                      },
                    ]}
                    normalize={(value) =>
                      String(value || '')
                        .trim()
                        .toUpperCase()
                    }
                  >
                    <Input placeholder="NOVA_DB_PASSWORD" />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, 'value']}>
                    <Input.Password
                      autoComplete="new-password"
                      placeholder={row.hasValue ? 'Saved, leave blank to keep' : 'Value'}
                      // Same eye icon does both jobs, so there's never a second,
                      // differently-styled icon next to it: for an unrevealed saved
                      // row, the first click fetches the real value (aria-label says
                      // "Reveal current value" until then); every click after that —
                      // and every click on a value the user is actively typing — is
                      // just the normal password show/hide toggle.
                      iconRender={(visible) =>
                        isRevealing ? <LoadingOutlined /> : visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
                      }
                      visibilityToggle={{
                        visible: !!visibleEnvVars[name],
                        onVisibleChange: (visible) => {
                          if (visible && row.hasValue && !isFetched) {
                            if (!isSuperAdmin) {
                              message.error('Only a Super Admin can reveal saved environment variable values');
                              return;
                            }
                            handleRevealEnvVar(name, row.key);
                            return;
                          }
                          setVisibleEnvVars((prev) => ({ ...prev, [name]: visible }));
                        },
                      }}
                    />
                  </Form.Item>
                  <Button
                    aria-label="Remove environment variable"
                    icon={<DeleteOutlined />}
                    onClick={() => remove(name)}
                    danger
                  />
                </div>
              );
            })}

            <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ key: '', value: '' })}>
              Add Variable
            </Button>
          </Space>
        )}
      </Form.List>
    </div>
  );

  const depsStatusTag: Record<string, { color: string; label: string }> = {
    pending: { color: 'default', label: 'Not installed yet' },
    installing: { color: 'processing', label: 'Installing…' },
    installed: { color: 'success', label: 'Installed' },
    failed: { color: 'error', label: 'Failed' },
  };

  const renderExecutionMode = () => (
    <Form.Item name="runtime" label="Execution Mode">
      <Segmented
        value={formRuntime}
        onChange={(value) => form.setFieldValue('runtime', value)}
        options={[
          { label: 'Managed Sandbox', value: 'VM_SANDBOX' },
          { label: 'Node.js Process', value: 'NODE_PROCESS' },
        ]}
      />
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: spacing[2] }}>
        {isNodeProcess
          ? 'No code-level restrictions — full require() access, filesystem, and network, and SQL writes if you use your own driver. Only isolated at the OS-process level (a crash or timeout only kills this job, not the gateway). Use for scripts you trust with real write access.'
          : 'Runs inside a restricted JS sandbox with managed helpers (mysql, email, http) — no require(), no filesystem, no shell access, and the mysql helper only allows read-only SELECT/WITH queries. Safer default for report-style scripts.'}
      </Text>
    </Form.Item>
  );

  const renderDependencies = () => {
    const status = job ? depsStatusTag[(job as any).depsStatus] : null;

    return (
      <div>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[2] }}
        >
          <div>
            <Text strong>npm Dependencies</Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              Declared packages are installed once and available via require() in your script.
            </Text>
          </div>
          {!isCreate && (
            <Space>
              {status && <Tag color={status.color}>{status.label}</Tag>}
              <Button
                size="small"
                icon={
                  <SyncOutlined spin={installDepsMutation.isPending || (job as any)?.depsStatus === 'installing'} />
                }
                onClick={() => installDepsMutation.mutate()}
                loading={installDepsMutation.isPending}
              >
                {(job as any)?.depsStatus === 'installed' ? 'Reinstall' : 'Install'}
              </Button>
            </Space>
          )}
        </div>

        {isCreate && <InlineHint>Dependencies install automatically the first time you save this job.</InlineHint>}

        {Array.isArray((job as any)?.depsValidation) && (job as any).depsValidation.length > 0 && (
          <div style={{ marginBottom: spacing[2] }}>
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: spacing[1] }}>
              Checked against this server's Node.js runtime
              {(job as any)?.depsNodeVersion ? ` (${(job as any).depsNodeVersion})` : ''}:
            </Text>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {(job as any).depsValidation.map((dep: { name: string; ok: boolean; error: string | null }) => (
                <Space key={dep.name} size={6} align="start">
                  {dep.ok ? (
                    <CheckCircleOutlined style={{ color: cssVar.legacy.success[600] }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: cssVar.legacy.error[600] }} />
                  )}
                  <Text code style={{ fontSize: 12 }}>
                    {dep.name}
                  </Text>
                  {!dep.ok && dep.error && (
                    <Text type="danger" style={{ fontSize: 12 }}>
                      {dep.error}
                    </Text>
                  )}
                </Space>
              ))}
            </Space>
          </div>
        )}

        {(job as any)?.depsStatus === 'failed' && (job as any)?.depsInstallLog && (
          <Collapse size="small" style={{ marginBottom: spacing[2] }}>
            <Collapse.Panel header={<Text type="danger">View install log</Text>} key="install-log">
              <pre
                style={{
                  background: '#1e1e1e',
                  color: '#f87171',
                  padding: spacing[2],
                  borderRadius: token.borderRadiusLG,
                  fontSize: 11,
                  maxHeight: 200,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {(job as any).depsInstallLog}
              </pre>
            </Collapse.Panel>
          </Collapse>
        )}

        <Form.List name="dependencies">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              {fields.map(({ key, name, ...restField }) => (
                <div
                  key={key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(160px, 1fr) minmax(120px, 1fr) 40px',
                    gap: spacing[2],
                    alignItems: 'start',
                  }}
                >
                  <Form.Item
                    {...restField}
                    name={[name, 'name']}
                    rules={[{ required: true, message: 'Package name is required' }]}
                  >
                    <Input placeholder="axios" />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, 'version']}>
                    <Input placeholder="latest" />
                  </Form.Item>
                  <Button
                    aria-label="Remove dependency"
                    icon={<DeleteOutlined />}
                    onClick={() => remove(name)}
                    danger
                  />
                </div>
              ))}

              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ name: '', version: 'latest' })}>
                Add Package
              </Button>
            </Space>
          )}
        </Form.List>
      </div>
    );
  };

  const renderDataSourceConfig = () => {
    switch (dataSourceType) {
      case 'SQL': {
        const portPart = formSqlPort ? `:${formSqlPort}` : '';
        const userPart = formSqlUsername ? encodeURIComponent(formSqlUsername) : '';
        const passPart = formSqlPassword ? `:${encodeURIComponent(formSqlPassword)}` : '';
        const authPart = formSqlUsername ? `${userPart}${passPart}@` : '';
        const generatedConnectionString =
          formSqlHost && formSqlDatabase ? `mysql://${authPart}${formSqlHost}${portPart}/${formSqlDatabase}` : '';

        return (
          <>
            <div>
              <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                Connection Method
              </Text>
              <Radio.Group
                value={sqlConnectionMode}
                onChange={(e) => setSqlConnectionMode(e.target.value)}
                buttonStyle="solid"
              >
                <Radio.Button value="STRING">Connection String</Radio.Button>
                <Radio.Button value="FIELDS">Host / Port / Credentials</Radio.Button>
              </Radio.Group>
            </div>

            {sqlConnectionMode === 'STRING' ? (
              <Form.Item
                label="Connection String (optional)"
                name="sqlConnectionString"
                extra="Leave blank to use the platform database."
              >
                <Input size="middle" placeholder="mysql://user:password@host:3306/dbname" />
              </Form.Item>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: spacing[3] }}>
                  <Form.Item label="Host" name="sqlHost">
                    <Input size="middle" placeholder="db.mycompany.com" />
                  </Form.Item>
                  <Form.Item label="Port" name="sqlPort">
                    <Input size="middle" placeholder="3306" type="number" />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
                  <Form.Item label="Username" name="sqlUsername">
                    <Input size="middle" placeholder="db_user" />
                  </Form.Item>
                  <Form.Item label="Password" name="sqlPassword">
                    <Input.Password size="middle" placeholder="••••••••" />
                  </Form.Item>
                </div>
                <Form.Item label="Database" name="sqlDatabase">
                  <Input size="middle" placeholder="your_database" />
                </Form.Item>
                <Form.Item label="Generated Connection String">
                  <Input
                    size="middle"
                    value={generatedConnectionString || ''}
                    placeholder="Fill Host and Database to generate"
                    readOnly
                  />
                </Form.Item>
              </>
            )}

            <Form.Item
              label="SQL Query"
              name="sqlQuery"
              rules={[{ required: true, message: 'SQL query is required' }]}
              extra="Use variables: {{config.tenantId}}, {{date.today()}}, {{date.yesterday()}}"
            >
              <Editor
                height="200px"
                language="sql"
                theme="vs-dark"
                value={sqlQuery}
                onChange={(value) => {
                  setSqlQuery(value || '');
                  form.setFieldValue('sqlQuery', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  automaticLayout: true,
                }}
              />
            </Form.Item>
          </>
        );
      }

      case 'MONGODB':
        return (
          <>
            <Form.Item
              label="Connection String"
              name="mongoConnectionString"
              rules={[{ required: true, message: 'MongoDB connection string is required' }]}
              extra="MongoDB connection string (e.g., mongodb://user:password@host:port)"
            >
              <Input size="middle" placeholder="mongodb://localhost:27017" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
              <Form.Item
                label="Database Name"
                name="mongoDatabase"
                rules={[{ required: true, message: 'Database name is required' }]}
              >
                <Input size="middle" placeholder="your_database" />
              </Form.Item>
              <Form.Item
                label="Collection Name"
                name="mongoCollection"
                rules={[{ required: true, message: 'Collection name is required' }]}
              >
                <Input size="middle" placeholder="orders" />
              </Form.Item>
            </div>
            <Form.Item
              label="Aggregation Pipeline (JSON)"
              name="mongoPipeline"
              rules={[
                { required: true, message: 'Pipeline is required' },
                {
                  validator: (_, value) => {
                    try {
                      if (value) JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject('Invalid JSON');
                    }
                  },
                },
              ]}
              extra="Array of aggregation stages with variable support"
            >
              <Editor
                height="200px"
                language="json"
                theme="vs-dark"
                value={mongoPipeline}
                onChange={(value) => {
                  setMongoPipeline(value || '');
                  form.setFieldValue('mongoPipeline', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  automaticLayout: true,
                }}
              />
            </Form.Item>
          </>
        );

      case 'API':
        return (
          <>
            <Form.Item label="API URL" name="apiUrl" rules={[{ required: true, message: 'API URL is required' }]}>
              <Input size="middle" placeholder="http://localhost:4000/api/v1/analytics" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
              <Form.Item label="HTTP Method" name="apiMethod" initialValue="GET">
                <Select size="middle">
                  <Select.Option value="GET">GET</Select.Option>
                  <Select.Option value="POST">POST</Select.Option>
                  <Select.Option value="PUT">PUT</Select.Option>
                </Select>
              </Form.Item>
            </div>
            <Form.Item
              label="Headers (JSON)"
              name="apiHeaders"
              rules={[
                {
                  validator: (_, value) => {
                    if (!value || value.trim() === '') return Promise.resolve();
                    try {
                      JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject('Invalid JSON');
                    }
                  },
                },
              ]}
              extra="Optional request headers"
            >
              <Editor
                height="100px"
                language="json"
                theme="vs-dark"
                value={apiHeaders}
                onChange={(value) => {
                  setApiHeaders(value || '');
                  form.setFieldValue('apiHeaders', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  automaticLayout: true,
                }}
              />
            </Form.Item>
            <Form.Item
              label="Body (JSON)"
              name="apiBody"
              rules={[
                {
                  validator: (_, value) => {
                    if (!value || value.trim() === '') return Promise.resolve();
                    try {
                      JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject('Invalid JSON');
                    }
                  },
                },
              ]}
              extra="Optional request body for POST/PUT requests"
            >
              <Editor
                height="150px"
                language="json"
                theme="vs-dark"
                value={apiBody}
                onChange={(value) => {
                  setApiBody(value || '');
                  form.setFieldValue('apiBody', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  automaticLayout: true,
                }}
              />
            </Form.Item>
          </>
        );
    }
  };

  return (
    <div>
      <PageHeader
        title={isCreate ? 'Create Scheduled Job' : job?.name || passedTitle || 'Scheduled Job'}
        morphTitle={!isCreate}
        breadcrumb={[
          { label: 'Configuration', path: '/integrations' },
          { label: 'Scheduled Jobs', path: `/scheduled-jobs?orgId=${orgId}` },
          { label: isCreate ? 'New' : job?.name || 'Details' },
        ]}
        dense
        statusChips={
          !isCreate && job
            ? [
                {
                  label: job.isActive ? 'Active' : 'Paused',
                  color: job.isActive ? colors.success[600] : colors.warning[600],
                },
                { label: job.schedule?.type || 'CRON' },
                ...((job as any).direction === 'SCRIPT_JOB'
                  ? [
                      {
                        label: (job as any).runtime === 'NODE_PROCESS' ? 'Node.js Process' : 'Managed Sandbox',
                        color: colors.primary[600],
                      },
                    ]
                  : [
                      { label: job.dataSource?.type || 'SQL', color: colors.primary[600] },
                      {
                        label:
                          DESTINATION_TYPES.find((d) => d.value === ((job as any).destinationType || 'HTTP_API'))
                            ?.label || 'HTTP API',
                        color: colors.neutral[600],
                      },
                    ]),
              ]
            : undefined
        }
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        // The form runs well past one screen; without this a failed required
        // field just turns red somewhere out of sight.
        scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
        onFinishFailed={({ errorFields }) =>
          message.error(
            errorFields.length === 1
              ? 'One field needs attention before this can be saved.'
              : `${errorFields.length} fields need attention before this can be saved.`
          )
        }
        initialValues={{
          direction: 'SCHEDULED',
          httpMethod: 'POST',
          isActive: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          apiMethod: 'GET',
          transformScript:
            '// Transform the data\nreturn {\n  date: new Date().toISOString(),\n  data: payload.data\n};',
          outgoingAuthType: 'NONE',
          runtime: 'NODE_PROCESS',
        }}
      >
        <Tabs
          defaultActiveKey="basic"
          size="middle"
          tabBarStyle={{ marginBottom: spacing[2] }}
          items={(() => {
            // Check completion status for progressive disclosure
            const values = form.getFieldsValue();
            const isScriptJob = jobMode === 'SCRIPT_JOB';
            const basicComplete = !!values.name;
            const scheduleComplete = scheduleType === 'CRON' ? !!values.cronExpression : !!values.intervalMs;
            const datasourceComplete = isScriptJob
              ? true
              : dataSourceType === 'SQL'
                ? !!values.sqlQuery
                : dataSourceType === 'MONGODB'
                  ? !!(
                      values.mongoConnectionString &&
                      values.mongoDatabase &&
                      values.mongoCollection &&
                      values.mongoPipeline
                    )
                  : !!values.apiUrl;
            const transformComplete = !!values.transformScript;
            const targetComplete = isScriptJob
              ? true
              : destinationType === 'HTTP_API'
                ? !!values.targetUrl
                : destinationType === 'SQL_WRITE'
                  ? !!values.destSqlQuery
                  : destinationType === 'MONGODB_WRITE'
                    ? !!values.destCollection
                    : true; // INTERNAL_EVENT has no required fields

            return [
              {
                key: 'basic',
                label: (
                  <Space size={6}>
                    <ThunderboltOutlined />
                    Basic Info
                    {basicComplete && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
                  </Space>
                ),
                disabled: false, // First tab always enabled
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Form.Item
                        label="Job Name"
                        name="name"
                        rules={[{ required: true, message: 'Job name is required' }]}
                      >
                        <Input size="middle" placeholder="Daily Bills Export" />
                      </Form.Item>

                      <Form.Item label="Job Type" name="type" extra="Categorize this job for better organization">
                        <Input size="middle" placeholder="DAILY_EXPORT" />
                      </Form.Item>

                      <Form.Item
                        label="Runtime"
                        name="direction"
                        extra="Choose whether this job runs a configured pipeline or a full managed script"
                      >
                        <Radio.Group
                          value={jobMode}
                          onChange={(e) => {
                            setJobMode(e.target.value);
                            form.setFieldValue('direction', e.target.value);
                          }}
                          buttonStyle="solid"
                        >
                          <Radio.Button value="SCHEDULED">Scheduled Pipeline</Radio.Button>
                          <Radio.Button value="SCRIPT_JOB">Script Job</Radio.Button>
                        </Radio.Group>
                      </Form.Item>

                      <Form.Item label="Description" name="description">
                        <TextArea rows={3} placeholder="Export daily bills to finance system" />
                      </Form.Item>

                      <Form.Item label="Status" name="isActive">
                        <Radio.Group buttonStyle="solid">
                          <Radio.Button value={true}>Active</Radio.Button>
                          <Radio.Button value={false}>Paused</Radio.Button>
                        </Radio.Group>
                      </Form.Item>
                    </Space>
                  </Card>
                ),
              },
              {
                key: 'schedule',
                label: (
                  <Space size={6}>
                    <ClockCircleOutlined />
                    Schedule
                    {scheduleComplete && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
                  </Space>
                ),
                disabled: !basicComplete, // Requires Basic Info to be complete
                // Force this pane's Form.Items (cronExpression/intervalMs) to mount immediately so
                // form.getFieldsValue() reflects loaded data right away — otherwise editing an existing
                // job keeps Script/Review disabled until the user manually visits this tab once.
                forceRender: true,
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <div>
                        <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                          Schedule Type
                        </Text>
                        <Radio.Group
                          value={scheduleType}
                          onChange={(e) => setScheduleType(e.target.value)}
                          buttonStyle="solid"
                        >
                          <Radio.Button value="CRON">Cron Expression</Radio.Button>
                          <Radio.Button value="INTERVAL">Fixed Interval</Radio.Button>
                        </Radio.Group>
                      </div>

                      {scheduleType === 'CRON' ? (
                        <>
                          <Form.Item name="cronExpression" hidden />
                          <Form.Item name="timezone" hidden />
                          <CronBuilder
                            value={form.getFieldValue('cronExpression')}
                            timezone={form.getFieldValue('timezone')}
                            onChange={(cron) => form.setFieldValue('cronExpression', cron)}
                            onTimezoneChange={(tz) => form.setFieldValue('timezone', tz)}
                          />
                        </>
                      ) : (
                        <Form.Item
                          label="Interval (milliseconds)"
                          name="intervalMs"
                          rules={[
                            { required: scheduleType === 'INTERVAL', message: 'Interval is required' },
                            {
                              type: 'number',
                              min: 60000,
                              message: 'Minimum interval is 60000ms (1 minute)',
                            },
                          ]}
                          extra="Minimum: 60000ms (1 minute)"
                        >
                          <Input type="number" size="middle" placeholder="3600000" addonAfter="ms" />
                        </Form.Item>
                      )}
                    </Space>
                  </Card>
                ),
              },
              ...(!isScriptJob
                ? [
                    {
                      key: 'datasource',
                      label: (
                        <Space size={6}>
                          <DatabaseOutlined />
                          Data Source
                          {datasourceComplete && (
                            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                          )}
                        </Space>
                      ),
                      disabled: !basicComplete || !scheduleComplete,
                      children: (
                        <Card style={{ marginTop: spacing[2] }} size="small">
                          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div>
                              <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                                Data Source Type
                              </Text>
                              <Radio.Group
                                value={dataSourceType}
                                onChange={(e) => setDataSourceType(e.target.value)}
                                buttonStyle="solid"
                              >
                                {DATA_SOURCE_TYPES.map((type) => (
                                  <Radio.Button key={type.value} value={type.value}>
                                    <Space>
                                      {type.icon}
                                      {type.label}
                                    </Space>
                                  </Radio.Button>
                                ))}
                              </Radio.Group>
                            </div>

                            {renderDataSourceConfig()}

                            <div style={{ paddingTop: spacing[2] }}>
                              <Alert
                                message="Test Your Data Source"
                                description={
                                  <div>
                                    <Text>Click below to validate your configuration and preview sample data.</Text>
                                    <ul style={{ marginTop: spacing[2], marginBottom: 0, paddingLeft: spacing[4] }}>
                                      <li>
                                        Variables like <code>{'{{config.tenantId}}'}</code> will be substituted with
                                        actual values
                                      </li>
                                      <li>Test may take up to 30 seconds for complex queries</li>
                                      <li>Returns up to 10 sample records for preview</li>
                                    </ul>
                                  </div>
                                }
                                type="info"
                                showIcon
                                icon={<InfoCircleOutlined />}
                                style={{ marginBottom: spacing[3] }}
                              />
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Button
                                  icon={<ExperimentOutlined />}
                                  onClick={() => testDataSourceMutation.mutate()}
                                  loading={testDataSourceMutation.isPending}
                                  disabled={!canTestDataSource()}
                                  size="middle"
                                >
                                  {testDataSourceMutation.isPending ? 'Testing Connection...' : 'Test Data Source'}
                                </Button>
                              </div>
                            </div>

                            <Alert
                              message="Variable Substitution"
                              description={
                                <div>
                                  <Text>
                                    Available variables (works in connection strings, queries, and pipelines):
                                  </Text>
                                  <ul style={{ marginTop: spacing[2], marginBottom: 0 }}>
                                    <li>
                                      <code>{'{{config.tenantId}}'}</code> - Current tenant ID
                                    </li>
                                    <li>
                                      <code>{'{{date.today()}}'}</code> - Today's date (YYYY-MM-DD)
                                    </li>
                                    <li>
                                      <code>{'{{date.yesterday()}}'}</code> - Yesterday's date
                                    </li>
                                    <li>
                                      <code>{'{{date.todayStart()}}'}</code> - Today at 00:00:00 (ISO)
                                    </li>
                                    <li>
                                      <code>{'{{date.todayEnd()}}'}</code> - Today at 23:59:59 (ISO)
                                    </li>
                                    <li>
                                      <code>{'{{date.now()}}'}</code> - Current timestamp (ISO)
                                    </li>
                                    <li>
                                      <code>{'{{env.VAR_NAME}}'}</code> - Environment variable
                                    </li>
                                  </ul>
                                </div>
                              }
                              type="info"
                              showIcon
                            />
                          </Space>
                        </Card>
                      ),
                    },
                  ]
                : []),
              {
                key: 'transformation',
                label: (
                  <Space size={6}>
                    <CodeOutlined />
                    {isScriptJob ? 'Script' : 'Transformation'}
                    {transformComplete && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
                  </Space>
                ),
                disabled: !basicComplete || !scheduleComplete || !datasourceComplete, // Requires Basic Info, Schedule, and Data Source to be complete
                // Force this pane's transformScript Form.Item to mount immediately so Review & Submit's
                // transformComplete check reflects loaded data right away instead of requiring a manual visit.
                forceRender: true,
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      {isScriptJob && renderExecutionMode()}

                      <Form.Item
                        label={isScriptJob ? 'Script' : 'Transformation Script'}
                        name="transformScript"
                        rules={[
                          {
                            required: true,
                            message: isScriptJob ? 'Script is required' : 'Transformation script is required',
                          },
                        ]}
                        extra={
                          isScriptJob
                            ? isNodeProcess
                              ? 'Plain Node.js script. Use process.env.KEY for secrets, console.log/console.error for logging, and require() for any package declared below.'
                              : 'JavaScript to run on schedule. Use env.KEY for environment variables.'
                            : 'JavaScript function to transform the query results. Return value will be sent to target URL.'
                        }
                      >
                        <Editor
                          height="300px"
                          language="javascript"
                          theme="vs-dark"
                          value={transformScript}
                          onChange={(value) => {
                            setTransformScript(value || '');
                            form.setFieldValue('transformScript', value || '');
                          }}
                          options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            lineNumbers: 'on',
                            wordWrap: 'on',
                            automaticLayout: true,
                          }}
                        />
                      </Form.Item>

                      {isScriptJob && renderEnvironmentVariables()}

                      {isScriptJob && isNodeProcess && renderDependencies()}

                      <Alert
                        message={isScriptJob ? 'Available Helpers' : 'Available Context'}
                        description={
                          <div>
                            <Text>{isScriptJob ? 'The script can use:' : 'The script receives:'}</Text>
                            <ul style={{ marginTop: spacing[2], marginBottom: 0 }}>
                              {isScriptJob ? (
                                isNodeProcess ? (
                                  <>
                                    <li>
                                      <code>require('package')</code> - Any package declared under npm Dependencies
                                    </li>
                                    <li>
                                      <code>process.env.KEY</code> - Job environment variables and connection
                                      credentials
                                    </li>
                                    <li>
                                      <code>console.log</code>, <code>console.error</code> - Captured into execution
                                      logs
                                    </li>
                                  </>
                                ) : (
                                  <>
                                    <li>
                                      <code>env.KEY</code> - Job environment variables
                                    </li>
                                    <li>
                                      <code>http</code>, <code>mysql</code>, <code>email</code> - Managed I/O helpers
                                    </li>
                                    <li>
                                      <code>date</code>, <code>report</code>, <code>log</code> - Utility helpers
                                    </li>
                                  </>
                                )
                              ) : (
                                <>
                                  <li>
                                    <code>payload.data</code> - Query results (array or object)
                                  </li>
                                  <li>
                                    <code>payload.metadata</code> - Job execution metadata
                                  </li>
                                </>
                              )}
                            </ul>
                          </div>
                        }
                        type="info"
                        showIcon
                      />
                    </Space>
                  </Card>
                ),
              },
              ...(!isScriptJob
                ? [
                    {
                      key: 'target',
                      label: (
                        <Space size={6}>
                          <ApiOutlined />
                          Destination
                          {targetComplete && (
                            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                          )}
                        </Space>
                      ),
                      disabled: !basicComplete || !scheduleComplete || !datasourceComplete || !transformComplete,
                      children: (
                        <Card style={{ marginTop: spacing[2] }} size="small">
                          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {/* Destination type selector — matches Data Source Type pattern */}
                            <div>
                              <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                                Delivery Destination
                              </Text>
                              <Radio.Group
                                value={destinationType}
                                onChange={(e) => setDestinationType(e.target.value as DestinationType)}
                                buttonStyle="solid"
                              >
                                {DESTINATION_TYPES.map((d) => (
                                  <Radio.Button key={d.value} value={d.value}>
                                    {d.label}
                                  </Radio.Button>
                                ))}
                              </Radio.Group>
                              <Text type="secondary" style={{ display: 'block', marginTop: spacing[2], fontSize: 12 }}>
                                {DESTINATION_TYPES.find((d) => d.value === destinationType)?.description}
                              </Text>
                            </div>

                            {/* HTTP_API fields */}
                            {destinationType === 'HTTP_API' && (
                              <>
                                <Form.Item
                                  label="Target URL"
                                  name="targetUrl"
                                  rules={[
                                    { required: true, message: 'Target URL is required' },
                                    { type: 'url', message: 'Must be a valid URL' },
                                  ]}
                                >
                                  <Input size="middle" placeholder="https://api.finance.com/v1/import" />
                                </Form.Item>
                                <Form.Item label="HTTP Method" name="httpMethod">
                                  <Radio.Group buttonStyle="solid">
                                    <Radio.Button value="POST">POST</Radio.Button>
                                    <Radio.Button value="PUT">PUT</Radio.Button>
                                  </Radio.Group>
                                </Form.Item>
                              </>
                            )}

                            {/* INTERNAL_EVENT fields */}
                            {destinationType === 'INTERNAL_EVENT' && (
                              <>
                                <InlineHint>
                                  The transformed payload will be pushed to the in-process event queue. Other active
                                  integrations subscribed to this event type will receive it.
                                </InlineHint>
                                <Form.Item
                                  label="Event Type"
                                  name="destEventType"
                                  extra="Leave blank to auto-generate (SCHEDULED_JOB_<id>)"
                                >
                                  <Input size="middle" placeholder="PATIENT_QUEUE_SYNC" />
                                </Form.Item>
                              </>
                            )}

                            {/* SQL_WRITE fields */}
                            {destinationType === 'SQL_WRITE' && (
                              <>
                                <InlineHint>
                                  The destination query is executed using the platform SQL connection. Use ?
                                  placeholders for parameterised values.
                                </InlineHint>
                                <Form.Item
                                  label="Destination SQL Query"
                                  name="destSqlQuery"
                                  rules={[{ required: true, message: 'Destination query is required for SQL_WRITE' }]}
                                  extra="e.g. INSERT INTO sync_log (org_id, payload) VALUES (?, ?)"
                                >
                                  <Input.TextArea rows={4} size="middle" placeholder="INSERT INTO sync_log ..." />
                                </Form.Item>
                              </>
                            )}

                            {/* MONGODB_WRITE fields */}
                            {destinationType === 'MONGODB_WRITE' && (
                              <>
                                <InlineHint>
                                  The transformed payload is inserted or upserted into the specified MongoDB collection
                                  using the platform connection.
                                </InlineHint>
                                <Form.Item
                                  label="Collection"
                                  name="destCollection"
                                  rules={[{ required: true, message: 'Collection name is required' }]}
                                >
                                  <Input size="middle" placeholder="partnerhub_queue" />
                                </Form.Item>
                                <Form.Item label="Operation" name="destOperation" initialValue="insert">
                                  <Radio.Group buttonStyle="solid">
                                    <Radio.Button value="insert">Insert</Radio.Button>
                                    <Radio.Button value="upsert">Upsert</Radio.Button>
                                  </Radio.Group>
                                </Form.Item>
                                <Form.Item
                                  noStyle
                                  shouldUpdate={(prev, cur) => prev.destOperation !== cur.destOperation}
                                >
                                  {() =>
                                    form.getFieldValue('destOperation') === 'upsert' ? (
                                      <Form.Item
                                        label="Upsert Filter (JSON)"
                                        name="destFilter"
                                        rules={[
                                          { required: true, message: 'Filter is required for upsert' },
                                          {
                                            validator: (_, v) => {
                                              if (!v) return Promise.resolve();
                                              try {
                                                JSON.parse(v);
                                                return Promise.resolve();
                                              } catch {
                                                return Promise.reject('Invalid JSON');
                                              }
                                            },
                                          },
                                        ]}
                                        extra='e.g. {"patientId": "{{patientId}}"}'
                                      >
                                        <Input.TextArea rows={2} size="middle" placeholder='{"customerId": "..."}' />
                                      </Form.Item>
                                    ) : null
                                  }
                                </Form.Item>
                              </>
                            )}
                          </Space>
                        </Card>
                      ),
                    },
                    {
                      key: 'auth',
                      label: (
                        <Space size={6}>
                          <LockOutlined />
                          Authentication
                          <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                        </Space>
                      ),
                      disabled:
                        !basicComplete ||
                        !scheduleComplete ||
                        !datasourceComplete ||
                        !transformComplete ||
                        !targetComplete,
                      children: (
                        <Card style={{ marginTop: spacing[2] }} size="small">
                          {destinationType !== 'HTTP_API' ? (
                            <InlineHint>
                              Authentication not required — the selected destination type (
                              {DESTINATION_TYPES.find((d) => d.value === destinationType)?.label}) does not make
                              outbound HTTP requests.
                            </InlineHint>
                          ) : (
                            <AuthenticationFields
                              form={form}
                              uiConfig={uiConfig}
                              selectedAuthType={authType}
                              fieldPrefix={['outgoingAuthConfig']}
                              mode="scheduled"
                              spacing={spacing}
                              authTypeFieldName="outgoingAuthType"
                            />
                          )}
                        </Card>
                      ),
                    },
                  ]
                : []),
              {
                key: 'review',
                label: (
                  <Space size={6}>
                    <EyeOutlined />
                    Review & Submit
                    {basicComplete && scheduleComplete && datasourceComplete && transformComplete && targetComplete && (
                      <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                    )}
                  </Space>
                ),
                disabled:
                  !basicComplete || !scheduleComplete || !datasourceComplete || !transformComplete || !targetComplete, // Requires all previous tabs to be complete
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Text type="secondary">
                        Please review all settings before {isCreate ? 'creating' : 'saving'} the scheduled job. You can
                        click on any tab above to make changes.
                      </Text>

                      {/* Basic Info Summary */}
                      <div>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}
                        >
                          <ThunderboltOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>
                            Basic Information
                          </Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>
                              Job Name:
                            </Text>
                            <Text strong>{form.getFieldValue('name') || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>
                              Job Type:
                            </Text>
                            <Text strong>{form.getFieldValue('type') || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>
                              Status:
                            </Text>
                            <Tag color={form.getFieldValue('isActive') ? 'success' : 'default'}>
                              {form.getFieldValue('isActive') ? 'Active' : 'Paused'}
                            </Tag>
                          </div>
                          {form.getFieldValue('description') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>
                                Description:
                              </Text>
                              <Text>{form.getFieldValue('description')}</Text>
                            </div>
                          )}
                        </Space>
                      </div>

                      <Divider style={{ margin: 0 }} />

                      {/* Schedule Summary */}
                      <div>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}
                        >
                          <ClockCircleOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>
                            Schedule
                          </Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>
                              Schedule Type:
                            </Text>
                            <Tag color={scheduleType === 'CRON' ? 'blue' : 'purple'}>{scheduleType}</Tag>
                          </div>
                          {scheduleType === 'CRON' && form.getFieldValue('cronExpression') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>
                                Cron Expression:
                              </Text>
                              <Text strong>
                                <code>{form.getFieldValue('cronExpression')}</code>
                              </Text>
                            </div>
                          )}
                          {scheduleType === 'INTERVAL' && form.getFieldValue('intervalMs') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>
                                Interval:
                              </Text>
                              <Text strong>{form.getFieldValue('intervalMs')}ms</Text>
                            </div>
                          )}
                          {form.getFieldValue('timezone') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>
                                Timezone:
                              </Text>
                              <Text>{form.getFieldValue('timezone')}</Text>
                            </div>
                          )}
                        </Space>
                      </div>

                      {!isScriptJob && (
                        <>
                          <Divider style={{ margin: 0 }} />

                          {/* Data Source Summary */}
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: spacing[2],
                                marginBottom: spacing[3],
                              }}
                            >
                              <DatabaseOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                              <Text strong style={{ fontSize: 16 }}>
                                Data Source
                              </Text>
                            </div>
                            <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                              <div style={{ display: 'flex', gap: spacing[2] }}>
                                <Text type="secondary" style={{ minWidth: 150 }}>
                                  Source Type:
                                </Text>
                                <Tag
                                  color={
                                    dataSourceType === 'SQL'
                                      ? 'blue'
                                      : dataSourceType === 'MONGODB'
                                        ? 'green'
                                        : 'purple'
                                  }
                                >
                                  {dataSourceType}
                                </Tag>
                              </div>
                              {dataSourceType === 'SQL' && (
                                <>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Connection:
                                    </Text>
                                    {sqlConnectionMode === 'FIELDS' &&
                                    (form.getFieldValue('sqlHost') || form.getFieldValue('sqlDatabase')) ? (
                                      <Text type="secondary">
                                        {form.getFieldValue('sqlHost') || 'host'}
                                        {form.getFieldValue('sqlPort') ? `:${form.getFieldValue('sqlPort')}` : ''} /{' '}
                                        {form.getFieldValue('sqlDatabase') || 'database'}
                                      </Text>
                                    ) : form.getFieldValue('sqlConnectionString') ? (
                                      <Text code style={{ fontSize: '11px' }}>
                                        {form.getFieldValue('sqlConnectionString')?.substring(0, 30)}...
                                      </Text>
                                    ) : (
                                      <Text type="secondary">Platform database (default)</Text>
                                    )}
                                  </div>
                                  {form.getFieldValue('sqlQuery') && (
                                    <div style={{ display: 'flex', gap: spacing[2] }}>
                                      <Text type="secondary" style={{ minWidth: 150 }}>
                                        SQL Query:
                                      </Text>
                                      <Text type="secondary">
                                        Configured ({form.getFieldValue('sqlQuery').split('\n').length} lines)
                                      </Text>
                                    </div>
                                  )}
                                </>
                              )}
                              {dataSourceType === 'MONGODB' && form.getFieldValue('mongoCollection') && (
                                <>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Connection:
                                    </Text>
                                    <Text code style={{ fontSize: '11px' }}>
                                      {form.getFieldValue('mongoConnectionString')?.substring(0, 30)}...
                                    </Text>
                                  </div>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Database:
                                    </Text>
                                    <Text strong>{form.getFieldValue('mongoDatabase')}</Text>
                                  </div>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Collection:
                                    </Text>
                                    <Text strong>{form.getFieldValue('mongoCollection')}</Text>
                                  </div>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Aggregation:
                                    </Text>
                                    <Text type="secondary">
                                      Configured ({form.getFieldValue('mongoPipeline')?.split('\n').length || 0} lines)
                                    </Text>
                                  </div>
                                </>
                              )}
                              {dataSourceType === 'API' && form.getFieldValue('apiUrl') && (
                                <div style={{ display: 'flex', gap: spacing[2] }}>
                                  <Text type="secondary" style={{ minWidth: 150 }}>
                                    API URL:
                                  </Text>
                                  <Text strong>{form.getFieldValue('apiUrl')}</Text>
                                </div>
                              )}
                            </Space>
                          </div>
                        </>
                      )}

                      <Divider style={{ margin: 0 }} />

                      {/* Transformation Summary */}
                      <div>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}
                        >
                          <CodeOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>
                            {isScriptJob ? 'Script' : 'Transformation'}
                          </Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>
                              {isScriptJob ? 'Script:' : 'Transform Script:'}
                            </Text>
                            {form.getFieldValue('transformScript') ? (
                              <Text type="secondary">
                                Configured ({form.getFieldValue('transformScript').split('\n').length} lines)
                              </Text>
                            ) : (
                              <Text type="secondary">Not set</Text>
                            )}
                          </div>
                          {isScriptJob && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>
                                Env Variables:
                              </Text>
                              <Text type="secondary">
                                {(form.getFieldValue('environmentVariables') || []).filter((row: any) => row?.key)
                                  .length || 0}{' '}
                                configured
                              </Text>
                            </div>
                          )}
                          {isScriptJob && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>
                                Execution Mode:
                              </Text>
                              <Text strong>
                                {formRuntime === 'NODE_PROCESS' ? 'Node.js Process' : 'Managed Sandbox'}
                              </Text>
                            </div>
                          )}
                          {isScriptJob && isNodeProcess && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>
                                npm Dependencies:
                              </Text>
                              <Text type="secondary">
                                {(form.getFieldValue('dependencies') || []).filter((row: any) => row?.name).length || 0}{' '}
                                configured
                              </Text>
                            </div>
                          )}
                        </Space>
                      </div>

                      {!isScriptJob && (
                        <>
                          <Divider style={{ margin: 0 }} />

                          {/* Destination Summary */}
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: spacing[2],
                                marginBottom: spacing[3],
                              }}
                            >
                              <ApiOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                              <Text strong style={{ fontSize: 16 }}>
                                Destination
                              </Text>
                            </div>
                            <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                              <div style={{ display: 'flex', gap: spacing[2] }}>
                                <Text type="secondary" style={{ minWidth: 150 }}>
                                  Delivery Type:
                                </Text>
                                <Tag
                                  color={
                                    destinationType === 'HTTP_API'
                                      ? 'blue'
                                      : destinationType === 'INTERNAL_EVENT'
                                        ? 'purple'
                                        : destinationType === 'SQL_WRITE'
                                          ? 'cyan'
                                          : 'green'
                                  }
                                >
                                  {DESTINATION_TYPES.find((d) => d.value === destinationType)?.label || destinationType}
                                </Tag>
                              </div>
                              {destinationType === 'HTTP_API' && (
                                <>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Target URL:
                                    </Text>
                                    <Text strong>
                                      {form.getFieldValue('targetUrl') || <Text type="secondary">Not set</Text>}
                                    </Text>
                                  </div>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      HTTP Method:
                                    </Text>
                                    <Tag color="blue">{form.getFieldValue('httpMethod') || 'POST'}</Tag>
                                  </div>
                                </>
                              )}
                              {destinationType === 'INTERNAL_EVENT' && (
                                <div style={{ display: 'flex', gap: spacing[2] }}>
                                  <Text type="secondary" style={{ minWidth: 150 }}>
                                    Event Type:
                                  </Text>
                                  <Text strong>
                                    {form.getFieldValue('destEventType') || (
                                      <Text type="secondary">Auto-generated</Text>
                                    )}
                                  </Text>
                                </div>
                              )}
                              {destinationType === 'SQL_WRITE' && (
                                <div style={{ display: 'flex', gap: spacing[2] }}>
                                  <Text type="secondary" style={{ minWidth: 150 }}>
                                    Destination Query:
                                  </Text>
                                  <Text type="secondary">
                                    {form.getFieldValue('destSqlQuery') ? (
                                      `Configured (${String(form.getFieldValue('destSqlQuery')).split('\n').length} lines)`
                                    ) : (
                                      <Text type="secondary">Not set</Text>
                                    )}
                                  </Text>
                                </div>
                              )}
                              {destinationType === 'MONGODB_WRITE' && (
                                <>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Collection:
                                    </Text>
                                    <Text strong>
                                      {form.getFieldValue('destCollection') || <Text type="secondary">Not set</Text>}
                                    </Text>
                                  </div>
                                  <div style={{ display: 'flex', gap: spacing[2] }}>
                                    <Text type="secondary" style={{ minWidth: 150 }}>
                                      Operation:
                                    </Text>
                                    <Tag color="green">{form.getFieldValue('destOperation') || 'insert'}</Tag>
                                  </div>
                                </>
                              )}
                            </Space>
                          </div>

                          <Divider style={{ margin: 0 }} />

                          {/* Authentication Summary — only relevant for HTTP_API */}
                          {destinationType === 'HTTP_API' && (
                            <div>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: spacing[2],
                                  marginBottom: spacing[3],
                                }}
                              >
                                <LockOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                                <Text strong style={{ fontSize: 16 }}>
                                  Authentication
                                </Text>
                              </div>
                              <Space
                                direction="vertical"
                                size="small"
                                style={{ width: '100%', paddingLeft: spacing[4] }}
                              >
                                <div style={{ display: 'flex', gap: spacing[2] }}>
                                  <Text type="secondary" style={{ minWidth: 150 }}>
                                    Auth Type:
                                  </Text>
                                  <Tag color={authType === 'NONE' ? 'default' : 'blue'}>{authType || 'NONE'}</Tag>
                                </div>
                              </Space>
                            </div>
                          )}
                        </>
                      )}
                    </Space>
                  </Card>
                ),
              },
              ...(!isCreate && job
                ? [
                    {
                      key: 'history',
                      label: (
                        <Space size={6}>
                          <HistoryOutlined />
                          Execution History
                        </Space>
                      ),
                      disabled: false, // History tab always enabled when viewing existing job
                      children: (
                        <Card
                          style={{ marginTop: spacing[2] }}
                          size="small"
                          extra={
                            <Button
                              size="small"
                              icon={<ReloadOutlined />}
                              loading={executionsLoading}
                              onClick={() => refetchExecutions()}
                            >
                              Refresh
                            </Button>
                          }
                        >
                          <ModernTable
                            dataSource={(executions || []).map((log: any) => ({ ...log, key: log._id }))}
                            loading={executionsLoading}
                            size="small"
                            pagination={false}
                            scroll={{ x: 'max-content' }}
                            emptyState={{
                              title: 'No executions yet',
                              description:
                                'Runs appear here once the schedule fires, or immediately after you use Execute Now.',
                            }}
                            columns={[
                              {
                                title: 'Status',
                                dataIndex: 'status',
                                key: 'status',
                                width: 110,
                                render: (status: string) => (
                                  <Tag
                                    color={
                                      status === 'SUCCESS'
                                        ? 'success'
                                        : status === 'RUNNING'
                                          ? 'processing'
                                          : status === 'SKIPPED'
                                            ? 'default'
                                            : 'error'
                                    }
                                  >
                                    {status}
                                  </Tag>
                                ),
                              },
                              {
                                title: 'Started',
                                dataIndex: 'startedAt',
                                key: 'startedAt',
                                width: 190,
                                render: (value: string) => (value ? formatDateTime(value) : '—'),
                              },
                              {
                                title: 'Duration',
                                dataIndex: 'durationMs',
                                key: 'durationMs',
                                width: 110,
                                align: 'right' as const,
                                render: (ms: number) =>
                                  typeof ms === 'number'
                                    ? ms >= 1000
                                      ? `${(ms / 1000).toFixed(1)}s`
                                      : `${ms}ms`
                                    : '—',
                              },
                              {
                                title: 'Trigger',
                                dataIndex: 'trigger',
                                key: 'trigger',
                                width: 110,
                                render: (trigger: string) => <Tag>{trigger || 'SCHEDULE'}</Tag>,
                              },
                              {
                                title: 'Result',
                                key: 'result',
                                render: (_: unknown, log: any) => {
                                  // Surface the failure reason inline — the whole
                                  // point of this tab is answering "did it work?"
                                  // without a trip to Delivery Logs.
                                  const detail = log?.error?.message || log?.errorMessage || log?.message || null;
                                  if (detail) {
                                    return (
                                      <Text type="danger" style={{ fontSize: 12 }}>
                                        {String(detail).slice(0, 200)}
                                      </Text>
                                    );
                                  }
                                  if (typeof log?.recordsFetched === 'number') {
                                    return (
                                      <Text type="secondary" style={{ fontSize: 12 }}>
                                        {log.recordsFetched} record(s) fetched
                                      </Text>
                                    );
                                  }
                                  return (
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      —
                                    </Text>
                                  );
                                },
                              },
                            ]}
                          />
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: spacing[2] }}>
                            Showing the {Math.min((executions || []).length, 20)} most recent run(s). Full console
                            output for each run is available in Delivery Logs.
                          </Text>
                        </Card>
                      ),
                    },
                  ]
                : []),
            ];
          })()}
        />

        {/* Persistent sticky footer — always visible regardless of active tab */}
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: spacing[2],
            padding: `${spacing[3]} 0`,
            marginTop: spacing[2],
            borderTop: `1px solid ${cssVar.border.default}`,
            background: cssVar.bg.base,
            boxShadow: `0 -8px 18px ${withAlpha(colors.neutral[900], 0.08)}`,
          }}
        >
          <Space direction="vertical" size={4}>
            {!isCreate && (
              <>
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Testing tools
                </Text>
                <Space wrap>
                  <Button
                    size="middle"
                    icon={<PlayCircleOutlined />}
                    onClick={() => executeMutation.mutate(undefined)}
                    loading={executeMutation.isPending}
                    disabled={!job?.isActive}
                  >
                    Execute Now
                  </Button>
                  <Button
                    size="middle"
                    icon={<ExperimentOutlined />}
                    onClick={() =>
                      executeMutation.mutate({
                        dryRun: true,
                        reason: 'Manual dry-run from scheduled job detail',
                      })
                    }
                    loading={executeMutation.isPending}
                    disabled={!job?.isActive}
                  >
                    Dry Run
                  </Button>
                </Space>
              </>
            )}
          </Space>
          <Space wrap>
            <Button size="middle" onClick={handleCancel} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="primary"
              size="middle"
              icon={<SaveOutlined />}
              onClick={() => form.submit()}
              loading={saveMutation.isPending}
              disabled={
                !form.getFieldValue('name') ||
                !form.getFieldValue('transformScript') ||
                (jobMode !== 'SCRIPT_JOB' &&
                  ((destinationType === 'HTTP_API' && !form.getFieldValue('targetUrl')) ||
                    (destinationType === 'SQL_WRITE' && !form.getFieldValue('destSqlQuery')) ||
                    (destinationType === 'MONGODB_WRITE' && !form.getFieldValue('destCollection'))))
              }
            >
              {isCreate ? (jobMode === 'SCRIPT_JOB' ? 'Create Script Job' : 'Create Scheduled Job') : 'Save Changes'}
            </Button>
          </Space>
        </div>
      </Form>

      {/* Test Data Source Modal */}
      <Modal
        title={
          <Space>
            {testResult?.success ? (
              <CheckCircleOutlined style={{ color: colors.success[600] }} />
            ) : (
              <CloseCircleOutlined style={{ color: colors.error[600] }} />
            )}
            <span>Data Source Test Result</span>
          </Space>
        }
        open={testModalOpen}
        onCancel={() => setTestModalOpen(false)}
        footer={[
          testResult?.success && testResult?.sampleData && (
            <Button
              key="copy"
              icon={<CopyOutlined />}
              onClick={async () => {
                const copied = await copyTextToClipboard(JSON.stringify(testResult.sampleData, null, 2));
                if (copied) {
                  message.success('Sample data copied to clipboard');
                } else {
                  message.error('Failed to copy to clipboard');
                }
              }}
            >
              Copy Sample Data
            </Button>
          ),
          <Button
            key="retest"
            icon={<ExperimentOutlined />}
            onClick={() => {
              setTestModalOpen(false);
              setTimeout(() => testDataSourceMutation.mutate(), 100);
            }}
            loading={testDataSourceMutation.isPending}
          >
            Test Again
          </Button>,
          <Button key="close" type="primary" onClick={() => setTestModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={900}
      >
        {testResult && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {testResult.success ? (
              <>
                <Alert message="Connection Successful" description={testResult.message} type="success" showIcon />

                <div>
                  <Text strong>Records Fetched: </Text>
                  <Tag color="blue">{testResult.recordsFetched}</Tag>
                  {testResult.limitedRecords && <Tag color="orange">Showing first 10 records</Tag>}
                </div>

                {testResult.sampleData && (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: spacing[2],
                      }}
                    >
                      <Text strong>Sample Data:</Text>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={async () => {
                          const copied = await copyTextToClipboard(JSON.stringify(testResult.sampleData, null, 2));
                          if (copied) {
                            message.success('Copied to clipboard');
                          } else {
                            message.error('Failed to copy to clipboard');
                          }
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    {Array.isArray(testResult.sampleData) ? (
                      testResult.sampleData.length > 0 ? (
                        <>
                          {/* Try to render as table if records have consistent structure */}
                          {(() => {
                            const firstRecord = testResult.sampleData[0];
                            if (firstRecord && typeof firstRecord === 'object' && !Array.isArray(firstRecord)) {
                              const keys = Object.keys(firstRecord);
                              const allRecordsHaveSameKeys = testResult.sampleData.every(
                                (record: any) =>
                                  record && typeof record === 'object' && Object.keys(record).length === keys.length
                              );

                              if (allRecordsHaveSameKeys && keys.length <= 10) {
                                // Render as table for better readability
                                const columns = keys.slice(0, 8).map((key) => ({
                                  title: key,
                                  dataIndex: key,
                                  key: key,
                                  ellipsis: true,
                                  render: (value: any) => {
                                    if (value === null) return <Text type="secondary">null</Text>;
                                    if (value === undefined) return <Text type="secondary">undefined</Text>;
                                    if (typeof value === 'object') {
                                      return (
                                        <Text code style={{ fontSize: '11px' }}>
                                          {JSON.stringify(value)}
                                        </Text>
                                      );
                                    }
                                    return String(value);
                                  },
                                }));

                                return (
                                  <div style={{ marginTop: spacing[2] }}>
                                    <ModernTable
                                      dataSource={testResult.sampleData.map((item: any, idx: number) => ({
                                        ...item,
                                        key: idx,
                                      }))}
                                      columns={columns}
                                      size="small"
                                      pagination={false}
                                      scroll={{ x: 'max-content', y: 300 }}
                                      bordered
                                    />
                                    {keys.length > 8 && (
                                      <Alert
                                        message={`Showing first 8 of ${keys.length} columns`}
                                        type="info"
                                        showIcon
                                        style={{ marginTop: spacing[2] }}
                                      />
                                    )}
                                  </div>
                                );
                              }
                            }

                            // Fall back to JSON view
                            return (
                              <div
                                style={{
                                  maxHeight: '400px',
                                  overflow: 'auto',
                                  border: `1px solid ${colors.neutral[200]}`,
                                  borderRadius: token.borderRadius,
                                  padding: spacing[2],
                                  backgroundColor: colors.neutral[50],
                                }}
                              >
                                <pre
                                  style={{
                                    margin: 0,
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {JSON.stringify(testResult.sampleData, null, 2)}
                                </pre>
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        <Alert
                          message="No data returned"
                          description="The query executed successfully but returned no results."
                          type="info"
                          showIcon
                        />
                      )
                    ) : (
                      <div
                        style={{
                          maxHeight: '400px',
                          overflow: 'auto',
                          border: `1px solid ${colors.neutral[200]}`,
                          borderRadius: token.borderRadius,
                          padding: spacing[2],
                          backgroundColor: colors.neutral[50],
                        }}
                      >
                        <pre
                          style={{
                            margin: 0,
                            fontSize: '12px',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {JSON.stringify(testResult.sampleData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <Alert
                  message="Connection Failed"
                  description={testResult.error || 'An error occurred while testing the data source'}
                  type="error"
                  showIcon
                />

                {/* Common error hints */}
                <div
                  style={{
                    padding: spacing[3],
                    backgroundColor: colors.warning[50],
                    border: `1px solid ${colors.warning[200]}`,
                    borderRadius: token.borderRadius,
                  }}
                >
                  <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                    💡 Common Issues:
                  </Text>
                  <ul style={{ margin: 0, paddingLeft: spacing[4] }}>
                    {dataSourceType === 'SQL' && (
                      <>
                        <li>Check SQL syntax and table/column names</li>
                        <li>Verify database connection and credentials</li>
                        <li>Ensure query doesn't have syntax errors</li>
                      </>
                    )}
                    {dataSourceType === 'MONGODB' && (
                      <>
                        <li>
                          Verify MongoDB connection string format: <code>mongodb://host:port</code>
                        </li>
                        <li>Check database and collection names are correct</li>
                        <li>Ensure aggregation pipeline is valid JSON array</li>
                        <li>Verify authentication credentials if required</li>
                      </>
                    )}
                    {dataSourceType === 'API' && (
                      <>
                        <li>Verify API endpoint URL is correct and accessible</li>
                        <li>Check headers JSON format is valid</li>
                        <li>Ensure authentication headers are correct</li>
                        <li>Verify the API is responding (not timeout/down)</li>
                      </>
                    )}
                  </ul>
                </div>

                {testResult.details && (
                  <Collapse
                    ghost
                    items={[
                      {
                        key: '1',
                        label: <Text strong>View Technical Details</Text>,
                        children: (
                          <div
                            style={{
                              padding: spacing[2],
                              backgroundColor: colors.neutral[50],
                              border: `1px solid ${colors.neutral[200]}`,
                              borderRadius: token.borderRadius,
                              maxHeight: '200px',
                              overflow: 'auto',
                            }}
                          >
                            <pre style={{ margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap' }}>
                              {typeof testResult.details === 'string'
                                ? testResult.details
                                : JSON.stringify(testResult.details, null, 2)}
                            </pre>
                          </div>
                        ),
                      },
                    ]}
                  />
                )}
              </>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
};
