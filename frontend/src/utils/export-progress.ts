type ExportProgress = {
  status: string;
  processedRecords?: number;
  totalRecords?: number;
  fileSizeBytes?: number;
};

type MessageConfig = {
  key: string;
  type: 'loading' | 'success' | 'error';
  content: string;
  duration: number;
};

type MessageApiLike = {
  open: (config: MessageConfig) => void;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let size = value;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const getStatusLabel = (status: string) => {
  if (status === 'PROCESSING') return 'Processing';
  if (status === 'COMPLETED') return 'Preparing download';
  if (status === 'DOWNLOADING') return 'Downloading';
  if (status === 'FAILED') return 'Failed';
  return 'Queued';
};

export const createExportProgress = (messageApi: MessageApiLike, label: string) => {
  const key = `export-${Date.now()}`;
  const startedAt = Date.now();

  messageApi.open({ key, type: 'loading', content: `${label}: queued`, duration: 0 });

  const formatEta = (processed: number, total: number) => {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    if (!Number.isFinite(elapsedSec) || elapsedSec <= 0 || processed <= 0 || total <= processed) {
      return '';
    }
    const rate = processed / elapsedSec;
    if (!Number.isFinite(rate) || rate <= 0) return '';
    const remainingSec = Math.max(0, Math.round((total - processed) / rate));
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    return mins <= 0 ? `${secs}s` : `${mins}m ${secs}s`;
  };

  const onProgress = (progress: ExportProgress) => {
    const total = progress.totalRecords ?? 0;
    const processed = progress.processedRecords ?? 0;
    const countLabel = total > 0 ? `${processed}/${total}` : processed > 0 ? `${processed}` : '';
    const sizeLabel = progress.fileSizeBytes ? formatBytes(progress.fileSizeBytes) : '';
    const etaLabel = progress.status === 'PROCESSING' ? formatEta(processed, total) : '';
    const extraLabel = [sizeLabel && `size ${sizeLabel}`, etaLabel && `eta ${etaLabel}`].filter(Boolean).join(' · ');

    messageApi.open({
      key,
      type: 'loading',
      content: `${label}: ${getStatusLabel(progress.status)}${countLabel ? ` (${countLabel})` : ''}${extraLabel ? ` · ${extraLabel}` : ''}`,
      duration: 0
    });
  };

  const finish = (message: string, isError = false) => {
    messageApi.open({ key, type: isError ? 'error' : 'success', content: message, duration: 2 });
  };

  return { onProgress, finish };
};
