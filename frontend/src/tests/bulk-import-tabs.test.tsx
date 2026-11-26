import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkImportModal } from '../features/events/components/BulkImportModal';

vi.mock('../services/api', () => ({
  bulkImportEvents: vi.fn(),
  bulkImportEventsJSON: vi.fn(),
  downloadImportTemplate: vi.fn(),
}));

vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<typeof import('antd')>();
  return {
    ...antd,
    Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
  };
});

describe('BulkImportModal tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches input panels accessibly and keeps the file panel mounted', async () => {
    render(<BulkImportModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    const fileTab = await screen.findByRole('tab', { name: 'File Upload' });
    const jsonTab = screen.getByRole('tab', { name: 'JSON Input' });
    const filePanel = document.getElementById('file-upload-panel');
    const jsonPanel = document.getElementById('json-input-panel');
    expect(filePanel).not.toBeNull();
    expect(jsonPanel).not.toBeNull();

    expect(fileTab).toHaveAttribute('aria-selected', 'true');
    expect(filePanel).toBeVisible();
    expect(jsonPanel).not.toBeVisible();

    fireEvent.click(jsonTab);

    expect(jsonTab).toHaveAttribute('aria-selected', 'true');
    expect(jsonPanel).toBeVisible();
    expect(filePanel).not.toBeVisible();
    expect(screen.getByPlaceholderText(/Paste JSON array or object with events array/)).toBeVisible();

    fireEvent.click(fileTab);
    expect(filePanel).toBeVisible();
    expect(jsonPanel).not.toBeVisible();
  });
});
