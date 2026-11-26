import { Text } from '@astryxdesign/core/Text';
import { cssVar } from '../../../../../design-system/utils';

/**
 * Pre-built popover content components for common help topics
 * Used with HelpPopover component for progressive disclosure
 */

/**
 * URL Requirements Help - Production URL security restrictions
 */
export const UrlRequirementsHelp = () => (
  <div>
    <Text as="p" display="block" className="console-margin-bottom-2">
      <strong>Blocked for security:</strong>
    </Text>
    <ul className="console-list-reset-indent console-margin-bottom-2">
      <li>localhost, 127.0.0.1</li>
      <li>Private IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)</li>
    </ul>
    <Text as="p" display="block" className="console-margin-bottom-none">
      <strong>Local testing:</strong> Use ngrok or expose.dev
    </Text>
  </div>
);

/**
 * Data Security & Compliance Help - Multi-entity data security requirements
 */
export const DataSecurityHelp = ({ entityCount }: { entityCount: number }) => (
  <div>
    <Text as="p" display="block">
      Events from <strong>{entityCount} entities</strong> (including PHI/PII) will be sent.
    </Text>
    <Text as="p" display="block" weight="semibold" className="console-margin-bottom-1">
      Ensure receiving system:
    </Text>
    <ul className="console-list-reset-indent">
      <li>Has authorization for all included entities</li>
      <li>Meets HIPAA compliance (if applicable)</li>
      <li>Maintains audit trails</li>
      <li>Implements data segregation if needed</li>
    </ul>
  </div>
);

/**
 * Scheduling Script Help - DELAYED vs RECURRING mode requirements
 */
export const SchedulingScriptHelp = ({ mode }: { mode?: 'DELAYED' | 'RECURRING' }) => {
  if (mode === 'DELAYED') {
    return (
      <div>
        <Text as="p" display="block">
          Return a single Unix timestamp (milliseconds) in the future.
        </Text>
        <Text as="p" display="block" weight="semibold" className="console-margin-bottom-1">
          Example:
        </Text>
        <Text type="code">addDays(event.appointmentTime, -1)</Text>
      </div>
    );
  }

  if (mode === 'RECURRING') {
    return (
      <div>
        <Text as="p" display="block" className="console-margin-bottom-1">
          Return an object with:
        </Text>
        <ul
          className="ui-extracted-216511b78a"
        >
          <li>
            <code>firstOccurrence</code>: timestamp (ms)
          </li>
          <li>
            <code>intervalMs</code>: minimum 60000 (1 min)
          </li>
          <li>
            <code>maxOccurrences</code>: 2-365 OR <code>endDate</code>: timestamp
          </li>
        </ul>
      </div>
    );
  }

  // Default: both modes
  return (
    <div>
      <Text as="p" display="block">
        <strong>DELAYED:</strong> Return a single timestamp
      </Text>
      <Text as="p" display="block">
        <strong>RECURRING:</strong> Return an object with firstOccurrence, intervalMs, and maxOccurrences/endDate
      </Text>
    </div>
  );
};

/**
 * Utility Functions Help - Available date/time helper functions
 */
export const UtilityFunctionsHelp = () => (
  <div>
    <Text as="p" display="block" type="label" weight="semibold" className="console-margin-bottom-2">
      Date/Time Utilities:
    </Text>
    <div className="console-margin-bottom-3">
      <div>
        <code>parseDate(dateString)</code> - Parse date string to timestamp
      </div>
      <div>
        <code>now()</code> - Current timestamp
      </div>
      <div>
        <code>toTimestamp(date)</code> - Convert to timestamp
      </div>
    </div>

    <Text as="p" display="block" type="label" weight="semibold" className="console-margin-bottom-2">
      Time Math:
    </Text>
    <div className="console-margin-bottom-3">
      <div>
        <code>addDays(timestamp, days)</code> - Add days
      </div>
      <div>
        <code>addHours(timestamp, hours)</code> - Add hours
      </div>
      <div>
        <code>addMinutes(timestamp, minutes)</code> - Add minutes
      </div>
      <div>
        <code>subtractDays(timestamp, days)</code> - Subtract days
      </div>
      <div>
        <code>subtractHours(timestamp, hours)</code> - Subtract hours
      </div>
    </div>

    <Text as="p" display="block" type="label" weight="semibold" className="console-margin-bottom-2">
      Date Boundaries:
    </Text>
    <div className="console-margin-bottom-3">
      <div>
        <code>startOfDay(timestamp)</code> - Get midnight (00:00:00)
      </div>
      <div>
        <code>endOfDay(timestamp)</code> - Get 23:59:59.999
      </div>
    </div>

    <Text as="p" display="block" type="label" weight="semibold" className="console-margin-bottom-2">
      Available Variables:
    </Text>
    <div>
      <div>
        <code>event</code> - Event payload data
      </div>
      <div>
        <code>context</code> - Metadata (tenantId, eventType, etc.)
      </div>
    </div>
  </div>
);

/**
 * Multi-Action Mode Help - Explanation of multi-action integrations
 */
export const MultiActionModeHelp = () => (
  <div>
    <Text as="p" display="block">
      Execute multiple HTTP requests sequentially for a single event.
    </Text>
    <Text as="p" display="block">
      <strong>Use case:</strong> CleverTap profile upload + event upload in one integration
    </Text>
    <Text as="p" display="block" className="console-margin-bottom-none">
      <strong>Note:</strong> All actions share the same authentication configuration
    </Text>
  </div>
);

/**
 * Script Syntax Help - Important syntax rules for scheduling scripts
 */
export const ScriptSyntaxHelp = () => (
  <div>
    <Text as="p" display="block">
      <strong>Do NOT use 'return' keyword!</strong>
    </Text>
    <Text as="p" display="block" className="console-margin-bottom-1">
      The last expression is automatically returned:
    </Text>
    <div className="ui-extracted-44118e585a">
      <div className="console-text-success">✓ Correct: addDays(event.appointmentTime, -1)</div>
      <div className="console-text-error">✗ Wrong: return addDays(event.appointmentTime, -1)</div>
    </div>
  </div>
);
