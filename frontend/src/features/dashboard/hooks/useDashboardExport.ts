import { useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { message } from 'antd';

export type ExportFormat = 'png' | 'pdf';

export interface ExportOptions {
  /** Element to capture (defaults to full dashboard) */
  element?: HTMLElement;
  /** Filename without extension */
  filename?: string;
  /** Image quality (0-1, defaults to 0.95) */
  quality?: number;
  /** Background color for PDF (defaults to white) */
  backgroundColor?: string;
}

const EXPORT_COLOR_PROPERTIES = [
  'color',
  'background',
  'background-color',
  'background-image',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'column-rule-color',
  'box-shadow',
  'text-shadow',
  'caret-color',
  'accent-color',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
] as const;

const UNSUPPORTED_COLOR_FUNCTION = /(?:color\(|color-mix\(|oklch\(|oklab\(|lab\(|lch\(|hwb\()/i;
const SRGB_COLOR_FUNCTION = /color\(\s*srgb\s+([^)]*)\)/gi;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseSrgbChannel = (value: string) => {
  if (value.endsWith('%')) {
    const percentage = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(percentage) ? Math.round(clamp(percentage, 0, 100) * 2.55) : null;
  }

  const channel = Number.parseFloat(value);
  return Number.isFinite(channel) ? Math.round(clamp(channel, 0, 1) * 255) : null;
};

const parseSrgbAlpha = (value: string | undefined) => {
  if (!value) return 1;
  const alpha = value.endsWith('%') ? Number.parseFloat(value.slice(0, -1)) / 100 : Number.parseFloat(value);
  return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : null;
};

/**
 * html2canvas cannot parse CSS Color 4 functions. Chromium currently exposes
 * some ordinary theme colors as color(srgb ...), even when the source CSS did
 * not use that syntax. Keep this conversion pure so it can be tested without a
 * browser and use it only inside the cloned export document.
 */
export const normalizeExportColorFunctions = (value: string): string =>
  value.replace(SRGB_COLOR_FUNCTION, (fullMatch, channels: string) => {
    const [channelPart, alphaPart] = channels.split('/').map((part) => part.trim());
    const channelValues = channelPart.split(/\s+/).filter(Boolean).map(parseSrgbChannel);
    const alpha = parseSrgbAlpha(alphaPart);

    if (channelValues.length !== 3 || channelValues.some((channel) => channel === null) || alpha === null) {
      return fullMatch;
    }

    const [red, green, blue] = channelValues as number[];
    return alpha < 1 ? `rgba(${red}, ${green}, ${blue}, ${alpha})` : `rgb(${red}, ${green}, ${blue})`;
  });

const exportFallbackForProperty = (property: string) => {
  const normalizedProperty = property.toLowerCase();
  if (normalizedProperty === 'color' || normalizedProperty === 'caret-color' || normalizedProperty === 'accent-color') {
    return '#000000';
  }
  if (normalizedProperty.includes('background')) {
    return normalizedProperty === 'background-image' ? 'none' : 'transparent';
  }
  if (normalizedProperty.includes('shadow')) return 'none';
  return 'transparent';
};

const sanitizeExportDocumentColors = (documentClone: Document, clonedElement: HTMLElement) => {
  const view = documentClone.defaultView;
  if (!view) return;

  const elements = [clonedElement, ...Array.from(clonedElement.querySelectorAll<HTMLElement>('*'))];
  for (const element of elements) {
    const styles = view.getComputedStyle(element);
    for (const property of EXPORT_COLOR_PROPERTIES) {
      const value = styles.getPropertyValue(property);
      if (!UNSUPPORTED_COLOR_FUNCTION.test(value)) continue;

      const normalized = normalizeExportColorFunctions(value);
      const safeValue = UNSUPPORTED_COLOR_FUNCTION.test(normalized)
        ? exportFallbackForProperty(property)
        : normalized;
      element.style.setProperty(property, safeValue);
    }
  }
};

/**
 * Modular dashboard export hook
 * Can be used for manual exports or programmatically for email sending
 *
 * @example
 * const { exportDashboard, isExporting } = useDashboardExport();
 *
 * // Manual export
 * await exportDashboard('png', { filename: 'dashboard-report' });
 *
 * // For email (get blob instead of download)
 * const blob = await exportDashboard('pdf', { download: false });
 */
export const useDashboardExport = () => {
  const [isExporting, setIsExporting] = useState(false);

  /**
   * Export dashboard as PNG or PDF
   * @param format - Export format ('png' or 'pdf')
   * @param options - Export options
   * @param download - Whether to trigger download (default: true)
   * @returns Blob if download is false, void otherwise
   */
  const exportDashboard = async (
    format: ExportFormat,
    options: ExportOptions = {},
    download: boolean = true
  ): Promise<Blob | void> => {
    setIsExporting(true);

    try {
      const {
        element,
        filename = `dashboard-${new Date().toISOString().split('T')[0]}`,
        quality = 0.95,
        backgroundColor = '#ffffff'
      } = options;

      // Get the element to capture (default to dashboard container)
      const targetElement = element || document.querySelector('[data-dashboard-container]') as HTMLElement;

      if (!targetElement) {
        throw new Error('Dashboard container not found');
      }

      // Show loading message
      const loadingMessage = message.loading(`Generating ${format.toUpperCase()}...`, 0);

      // Capture the element as canvas
      const canvas = await html2canvas(targetElement, {
        backgroundColor,
        scale: 2, // Higher resolution
        useCORS: true,
        logging: false,
        allowTaint: true,
        onclone: sanitizeExportDocumentColors,
        windowWidth: targetElement.scrollWidth,
        windowHeight: targetElement.scrollHeight
      });

      loadingMessage();

      if (format === 'png') {
        // Export as PNG
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to generate PNG'));
              }
            },
            'image/png',
            quality
          );
        });

        if (download) {
          // Trigger download
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${filename}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          message.success('Dashboard exported as PNG');
        } else {
          return blob;
        }
      } else if (format === 'pdf') {
        // Export as PDF
        const imgData = canvas.toDataURL('image/png', quality);

        // Calculate PDF dimensions (A4 portrait)
        const pdfWidth = 210; // mm (A4 width)
        const pdfHeight = 297; // mm (A4 height)

        // Calculate image dimensions to fit within PDF
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = imgWidth / imgHeight;

        let finalWidth = pdfWidth - 20; // 10mm margin on each side
        let finalHeight = finalWidth / ratio;

        // If height exceeds page, scale down
        if (finalHeight > pdfHeight - 20) {
          finalHeight = pdfHeight - 20;
          finalWidth = finalHeight * ratio;
        }

        const pdf = new jsPDF({
          orientation: finalHeight > finalWidth ? 'portrait' : 'landscape',
          unit: 'mm',
          format: 'a4'
        });

        // Add image to PDF (centered)
        const xOffset = (pdf.internal.pageSize.getWidth() - finalWidth) / 2;
        const yOffset = 10; // Top margin

        pdf.addImage(imgData, 'PNG', xOffset, yOffset, finalWidth, finalHeight);

        if (download) {
          // Trigger download
          pdf.save(`${filename}.pdf`);
          message.success('Dashboard exported as PDF');
        } else {
          // Return blob for email sending
          const blob = pdf.output('blob');
          return blob;
        }
      }
    } catch (error) {
      console.error('Export failed:', error);
      message.error(`Failed to export dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    } finally {
      setIsExporting(false);
    }
  };

  return {
    exportDashboard,
    isExporting
  };
};
