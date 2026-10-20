'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { createStreamingLookupXlsxWriter } = require('../../src/services/lookup-import-export');

describe('streaming lookup XLSX writer', () => {
  it('writes rows incrementally into a valid workbook', async () => {
    const filePath = path.join(os.tmpdir(), `lookup-export-${Date.now()}.xlsx`);
    try {
      const writer = createStreamingLookupXlsxWriter(filePath);
      writer.write({
        type: 'ICD',
        source: { id: 'A01', name: 'Unsafe =value' },
        target: { id: '1', name: 'Target' },
        isActive: true,
      });
      await writer.close();

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.getWorksheet('Lookups');
      expect(worksheet.getRow(1).getCell(1).value).toBe('Source ID');
      expect(worksheet.getRow(2).getCell(1).value).toBe('A01');
      expect(worksheet.getRow(2).getCell(7).value).toBe('Target');
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });
});
