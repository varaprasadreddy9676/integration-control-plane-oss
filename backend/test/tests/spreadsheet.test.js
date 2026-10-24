'use strict';

/** The one spreadsheet reader behind the event and lookup imports. */

const ExcelJS = require('exceljs');
const { readSpreadsheetRows } = require('../../src/utils/spreadsheet');

const xlsx = async (rows) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('readSpreadsheetRows', () => {
  it('reads an .xlsx into objects keyed by the (trimmed) header, skipping empty cells and rows', async () => {
    const rows = await readSpreadsheetRows(await xlsx([[' eventType ', 'orgId', ''], ['APPT', 5, 'ignored'], [null, null, null], ['LAB', 7]]), 'xlsx');
    expect(rows).toEqual([
      { eventType: 'APPT', orgId: 5 },
      { eventType: 'LAB', orgId: 7 },
    ]);
  });

  it('reads CSV text, quoted cells included', async () => {
    const csv = Buffer.from('eventType,payload\nAPPT,"{""a"":1,""b"":2}"\nLAB,{}\n');
    expect(await readSpreadsheetRows(csv, 'csv')).toEqual([
      { eventType: 'APPT', payload: '{"a":1,"b":2}' },
      { eventType: 'LAB', payload: '{}' },
    ]);
  });

  it('gives no rows for a header-only or empty sheet', async () => {
    expect(await readSpreadsheetRows(await xlsx([['a', 'b']]), 'xlsx')).toEqual([]);
    expect(await readSpreadsheetRows(Buffer.from(''), 'csv')).toEqual([]);
  });
});
