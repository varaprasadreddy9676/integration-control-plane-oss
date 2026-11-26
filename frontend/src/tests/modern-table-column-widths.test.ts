import { describe, expect, it } from 'vitest';
import { getMobileColumnLabel, preserveResizedColumnWidths } from '../components/common/ModernTable';

describe('ModernTable column width synchronization', () => {
  it('retains user-resized widths when callers recreate or reorder column definitions', () => {
    const current = [
      { key: 'name', dataIndex: 'name', title: 'Name', width: 260 },
      { key: 'status', dataIndex: 'status', title: 'Status', width: 120 },
    ];
    const incoming = [
      { key: 'status', dataIndex: 'status', title: 'Delivery status', width: 100 },
      { key: 'name', dataIndex: 'name', title: 'Integration', width: 180 },
    ];

    expect(preserveResizedColumnWidths(current, incoming)).toEqual([
      { ...incoming[0], width: 120 },
      { ...incoming[1], width: 260 },
    ]);
  });

  it('does not apply a removed column width to a new column at the same position', () => {
    const current = [{ key: 'old', dataIndex: 'old', title: 'Old', width: 300 }];
    const incoming = [{ key: 'new', dataIndex: 'new', title: 'New', width: 140 }];

    expect(preserveResizedColumnWidths(current, incoming)).toEqual(incoming);
  });

  it('keeps numeric and string keys distinct', () => {
    const current = [
      { key: 1, title: 'Numeric', width: 220 },
      { key: '1', title: 'String', width: 120 },
    ];
    const incoming = [
      { key: '1', title: 'String', width: 100 },
      { key: 1, title: 'Numeric', width: 180 },
    ];

    expect(preserveResizedColumnWidths(current, incoming)).toEqual([
      { ...incoming[0], width: 120 },
      { ...incoming[1], width: 220 },
    ]);
  });

  it('derives mobile labels for non-string headers and supports explicit labels', () => {
    expect(getMobileColumnLabel({ title: ['Status', 'icon'], dataIndex: 'deliveryStatus' })).toBe('Delivery Status');
    expect(getMobileColumnLabel({ title: ['Status', 'icon'], dataIndex: ['result', 'deliveryStatus'] })).toBe(
      'Delivery Status'
    );
    expect(getMobileColumnLabel({ title: ['Status', 'icon'], dataIndex: 'status', mobileLabel: 'Outcome' })).toBe(
      'Outcome'
    );
  });
});
