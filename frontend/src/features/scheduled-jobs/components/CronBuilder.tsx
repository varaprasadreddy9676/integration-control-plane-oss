import { useState, useMemo, useEffect } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { Card, Radio, TimePicker, Space, Input, Select, Divider } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { useDesignTokens, cssVar } from '../../../design-system/utils';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { Button } from '../../../components/common/LegacyButton';

dayjs.extend(utc);
dayjs.extend(timezone);

const { Text } = Typography;

const DAYS = [
  { id: '0', short: 'Sun', long: 'Sunday' },
  { id: '1', short: 'Mon', long: 'Monday' },
  { id: '2', short: 'Tue', long: 'Tuesday' },
  { id: '3', short: 'Wed', long: 'Wednesday' },
  { id: '4', short: 'Thu', long: 'Thursday' },
  { id: '5', short: 'Fri', long: 'Friday' },
  { id: '6', short: 'Sat', long: 'Saturday' },
];

const QUICK_PRESETS = [
  { label: 'Every hour', value: '0 * * * *', freq: 'hourly' },
  { label: 'Every day at 9 AM', value: '0 9 * * *', freq: 'daily' },
  { label: 'Every weekday at 9 AM', value: '0 9 * * 1-5', freq: 'weekly' },
  { label: 'Every Monday at 9 AM', value: '0 9 * * 1', freq: 'weekly' },
  { label: 'First day of month at 9 AM', value: '0 9 1 * *', freq: 'monthly' },
];

// Curated shortlist for quick selection. The Select still accepts any IANA timezone —
// if the browser's auto-detected zone isn't in this list, it's added dynamically so it
// always appears correctly selected rather than showing as an unmatched raw value.
const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'America/New York (EST)' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
];

const cronToEnglish = (expression: string): string => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return 'Invalid expression (requires 5 parts)';

  const [min, hour, dom, month, dow] = parts;

  // Common patterns
  if (hour === '*' && dom === '*' && month === '*' && dow === '*' && !min.includes('/')) {
    return `Every hour at :${min.padStart(2, '0')}`;
  }
  if (min === '0' && hour === '0' && dom === '*' && month === '*' && dow === '*') return 'Every day at midnight';
  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Every minute';

  // Build readable description
  let description = '';

  if (min !== '*' && hour !== '*' && !min.includes('/') && !hour.includes('/')) {
    description = `At ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  } else if (min === '0' && hour.includes('/')) {
    description = `Every ${hour.split('/')[1]} hours`;
  } else if (hour === '*' && min.includes('/')) {
    description = `Every ${min.split('/')[1]} minutes`;
  } else {
    description = `At minute ${min} of hour ${hour}`;
  }

  // Add day/month context
  if (dow !== '*' && dow.includes(',')) {
    const dayNames = dow
      .split(',')
      .map((d) => DAYS.find((day) => day.id === d)?.long)
      .filter(Boolean);
    description += ` on ${dayNames.join(', ')}`;
  } else if (dow !== '*' && dow.includes('-')) {
    const [start, end] = dow.split('-');
    const startDay = DAYS.find((d) => d.id === start)?.long;
    const endDay = DAYS.find((d) => d.id === end)?.long;
    description += ` on ${startDay} through ${endDay}`;
  } else if (dow !== '*') {
    const dayName = DAYS.find((d) => d.id === dow)?.long;
    description += ` on ${dayName}`;
  }

  if (dom !== '*' && month === '*') {
    description += ` on day ${dom} of every month`;
  }

  return description;
};

// Calculate next 5 execution times based on cron expression
// Supports plain values, '*', and simple '*/N' step syntax for minute/hour fields.
const matchesCronField = (field: string, value: number): boolean => {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }
  return parseInt(field, 10) === value;
};

const getNextExecutions = (cronExpression: string, tz: string): dayjs.Dayjs[] => {
  const executions: dayjs.Dayjs[] = [];
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return executions;

  const [min, hour, dom, month, dow] = parts;

  // Walk forward minute-by-minute from the top of the current minute (not hour —
  // preserving the current minute would make a fixed-minute cron like "0 9 * * *"
  // never match unless it happened to be run at exactly :00). 40 days ahead covers
  // every supported pattern, including "1st of month" schedules, at negligible cost.
  const start = dayjs().tz(tz).startOf('minute');
  const maxMinutesAhead = 60 * 24 * 40;

  for (let i = 0; i <= maxMinutesAhead && executions.length < 5; i++) {
    const checkTime = start.add(i, 'minute');

    const matchesMinute = matchesCronField(min, checkTime.minute());
    const matchesHour = matchesCronField(hour, checkTime.hour());
    const matchesDOM = dom === '*' || parseInt(dom, 10) === checkTime.date();
    const matchesMonth = month === '*' || parseInt(month, 10) === checkTime.month() + 1;
    const matchesDOW =
      dow === '*' ||
      dow.split(',').includes(String(checkTime.day())) ||
      (dow.includes('-') &&
        checkTime.day() >= parseInt(dow.split('-')[0], 10) &&
        checkTime.day() <= parseInt(dow.split('-')[1], 10));

    if (matchesMinute && matchesHour && matchesDOM && matchesMonth && matchesDOW) {
      executions.push(checkTime);
    }
  }

  return executions.slice(0, 5);
};

interface CronBuilderProps {
  value?: string;
  timezone?: string;
  onChange?: (cron: string) => void;
  onTimezoneChange?: (timezone: string) => void;
}

export const CronBuilder = ({ value, timezone = 'UTC', onChange, onTimezoneChange }: CronBuilderProps) => {
  const { spacing, token } = useDesignTokens();
  const [frequency, setFrequency] = useState<'hourly' | 'daily' | 'weekly' | 'monthly'>('daily');
  const [time, setTime] = useState(dayjs().hour(9).minute(0));
  const [selectedDays, setSelectedDays] = useState<string[]>(['1', '2', '3', '4', '5']); // Mon-Fri
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [advancedCron, setAdvancedCron] = useState(value || '0 9 * * *');
  const [copied, setCopied] = useState(false);

  // Update advanced cron when value prop changes
  useEffect(() => {
    if (value && value !== cronExpression && !isAdvanced) {
      setIsAdvanced(true);
      setAdvancedCron(value);
    }
  }, [value]);

  const cronExpression = useMemo(() => {
    if (isAdvanced) return advancedCron;

    const hour = time.hour();
    const minute = time.minute();

    if (frequency === 'hourly') return `${minute} * * * *`; // Run at specified minute of every hour
    if (frequency === 'daily') return `${minute} ${hour} * * *`;
    if (frequency === 'weekly') {
      if (selectedDays.length === 0) return `${minute} ${hour} * * *`;
      return `${minute} ${hour} * * ${selectedDays.sort((a, b) => parseInt(a) - parseInt(b)).join(',')}`;
    }
    return `${minute} ${hour} 1 * *`; // Monthly on 1st
  }, [frequency, time, selectedDays, isAdvanced, advancedCron]);

  const interpretation = useMemo(() => {
    try {
      return cronToEnglish(isAdvanced ? advancedCron : cronExpression);
    } catch {
      return 'Invalid cron expression';
    }
  }, [cronExpression, isAdvanced, advancedCron]);

  const nextExecutions = useMemo(() => {
    try {
      return getNextExecutions(isAdvanced ? advancedCron : cronExpression, timezone);
    } catch {
      return [];
    }
  }, [cronExpression, isAdvanced, advancedCron, timezone]);

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(cronExpression);
    if (copied) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePresetSelect = (cronValue: string) => {
    setIsAdvanced(true);
    setAdvancedCron(cronValue);
    onChange?.(cronValue);
  };

  useEffect(() => {
    onChange?.(cronExpression);
  }, [cronExpression]);

  const panelStyle = {
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${cssVar.border.default}`,
    background: cssVar.bg.surface,
  };

  return (
    <Card style={panelStyle} bodyStyle={{ padding: spacing[4] }}>
      {/* Header */}
      <div className="console-flex-between-center-margin-bottom-4">
        <Space>
          <GatewayIcon
            name="ThunderboltOutlined"
            className="console-title-accent"
          />
          <div>
            <Text strong className="console-display-block console-type-section">
              Schedule Configuration
            </Text>
            <Text type="secondary" className="console-type-caption">
              Configure when this job should run
            </Text>
          </div>
        </Space>
        <Button size="small" onClick={() => setIsAdvanced(!isAdvanced)} icon={<GatewayIcon name="CodeOutlined" />}>
          {isAdvanced ? 'Use Builder' : 'Advanced'}
        </Button>
      </div>

      <Divider className="console-margin-y-3" />

      {/* Quick Presets */}
      {!isAdvanced && (
        <div className="console-margin-bottom-4">
          <Text
            type="secondary"
            className="cron-field-label"
          >
            Quick Presets
          </Text>
          <Space size="small" wrap>
            {QUICK_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                size="small"
                type={value === preset.value ? 'primary' : 'default'}
                aria-pressed={value === preset.value}
                onClick={() => handlePresetSelect(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </Space>
        </div>
      )}

      {!isAdvanced ? (
        <Space direction="vertical" size="large" className="console-width-full">
          {/* Frequency Selector */}
          <div>
            <Text
              type="secondary"
              className="cron-field-label"
            >
              Frequency
            </Text>
            <Radio.Group
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              buttonStyle="solid" className="console-width-full"
            >
              <Radio.Button value="hourly" className="console-width-quarter-center">
                <GatewayIcon name="ClockCircleOutlined" /> Hourly
              </Radio.Button>
              <Radio.Button value="daily" className="console-width-quarter-center">
                <GatewayIcon name="CalendarOutlined" /> Daily
              </Radio.Button>
              <Radio.Button value="weekly" className="console-width-quarter-center">
                <GatewayIcon name="CalendarOutlined" /> Weekly
              </Radio.Button>
              <Radio.Button value="monthly" className="console-width-quarter-center">
                <GatewayIcon name="CalendarOutlined" /> Monthly
              </Radio.Button>
            </Radio.Group>
          </div>

          {/* Time & Timezone Grid */}
          <div className="console-grid-two-gap-3">
            <div>
              <Text
                type="secondary"
                className="cron-field-label"
              >
                {frequency === 'hourly' ? 'Minute Past Hour' : 'Execution Time'}
              </Text>
              <TimePicker
                value={time}
                onChange={(t) => t && setTime(t)}
                format={frequency === 'hourly' ? 'mm' : 'HH:mm'}
                size="large"
                showNow={false} className="console-width-full"
                suffixIcon={<GatewayIcon name="ClockCircleOutlined" />}
                placeholder={frequency === 'hourly' ? 'Select minute (0-59)' : 'Select time'}
              />
            </div>
            <div>
              <Text
                type="secondary"
                className="cron-field-label"
              >
                Timezone
              </Text>
              <Select
                value={timezone}
                onChange={onTimezoneChange}
                size="large" className="console-width-full"
                suffixIcon={<GatewayIcon name="GlobalOutlined" />}
                showSearch
                filterOption={(input, option) =>
                  (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                }
                options={
                  TIMEZONE_OPTIONS.some((opt) => opt.value === timezone)
                    ? TIMEZONE_OPTIONS
                    : [{ value: timezone, label: timezone }, ...TIMEZONE_OPTIONS]
                }
              />
            </div>
          </div>

          {/* Weekly Day Selector */}
          {frequency === 'weekly' && (
            <div>
              <Text
                type="secondary"
                style={{
                  fontSize: 'var(--console-type-caption)',
                  fontWeight: 600,
                  marginBottom: spacing[2],
                  display: 'block',
                }}
              >
                Days of Week
              </Text>
              <div className="console-flex-wrap-gap-2">
                {DAYS.map((day) => {
                  const isSelected = selectedDays.includes(day.id);
                  return (
                    <Button
                      key={day.id}
                      type={isSelected ? 'primary' : 'default'}
                      onClick={() => {
                        setSelectedDays((prev) =>
                          prev.includes(day.id) ? prev.filter((d) => d !== day.id) : [...prev, day.id]
                        );
                      }}
                      className="cron-day-option"
                    >
                      {day.short}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </Space>
      ) : (
        <div>
          <Text
            type="secondary"
            className="cron-field-label"
          >
            Cron Expression
          </Text>
          <Input
            value={advancedCron}
            onChange={(e) => {
              setAdvancedCron(e.target.value);
              onChange?.(e.target.value);
            }}
            prefix={<GatewayIcon name="CodeOutlined" className="console-text-accent" />}
            size="large"
            className="console-font-mono console-type-control"
            placeholder="0 9 * * *"
          />
          <Text
            type="secondary"
            className="console-type-caption console-margin-top-1 console-display-block"
          >
            Format: minute hour day-of-month month day-of-week
          </Text>
        </div>
      )}

      <Divider className="console-margin-y-4" />

      {/* Interpretation */}
      <div
        className="cron-interpretation-panel"
      >
        <Space align="start">
          <GatewayIcon name="ClockCircleOutlined" className="console-text-info console-margin-top-1" />
          <div>
            <Text type="secondary" className="console-caption-block">
              This job will run:
            </Text>
            <Text strong className="console-type-control console-text-primary">
              {interpretation}{' '}
              <Text type="supporting" color="secondary">
                {timezone}
              </Text>
            </Text>
            <Text
              type="secondary"
              className="console-type-caption console-display-block console-margin-top-1"
            >
              Right now it's {dayjs().tz(timezone).format('HH:mm')} in {timezone}
              {timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone &&
                ` (your local time is ${dayjs().format('HH:mm')})`}
            </Text>
          </div>
        </Space>
      </div>

      {/* Cron Expression Output */}
      <div
        className="cron-expression-output"
      >
        <div className="console-flex-fill">
          <Text
            type="secondary"
            className="console-caption-block-margin-bottom-1"
          >
            Cron Expression
          </Text>
          <Text strong className="console-type-section console-font-mono">
            {cronExpression}
          </Text>
        </div>
        <Button
          type={copied ? 'primary' : 'default'}
          icon={copied ? <GatewayIcon name="CheckOutlined" /> : <GatewayIcon name="CopyOutlined" />}
          onClick={handleCopy}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {/* Next Executions Preview */}
      <div>
        <Text
          type="secondary"
          className="cron-field-label"
        >
          Next 5 Scheduled Executions
        </Text>
        <Space direction="vertical" size="small" className="console-width-full">
          {nextExecutions.length > 0 ? (
            nextExecutions.map((exec, i) => (
              <div
                key={i}
                className="cron-next-execution"
              >
                <Space>
                  <Text type="supporting" color="secondary">
                    {i + 1}
                  </Text>
                  <Text className="console-type-body">{exec.format('ddd, MMM D, YYYY')}</Text>
                </Space>
                <Text strong className="console-type-body console-font-mono">
                  {exec.format('HH:mm:ss')} {timezone}
                </Text>
              </div>
            ))
          ) : (
            <div
              className="cron-error-state"
            >
              <Text className="console-text-warning">
                Unable to calculate next executions. Please verify your cron expression.
              </Text>
            </div>
          )}
        </Space>
      </div>
    </Card>
  );
};
