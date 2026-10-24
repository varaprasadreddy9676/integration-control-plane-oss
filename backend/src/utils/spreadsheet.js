'use strict';

/**
 * Spreadsheet files (.xlsx, .csv) read into rows of objects, the first row naming
 * the columns. Used by every import that accepts a spreadsheet.
 */

const { Readable } = require('stream');
const ExcelJS = require('exceljs');

/**
 * @param {Buffer} buffer
 * @param {string} ext 'csv' reads CSV; anything else reads .xlsx
 * @returns {Promise<Object[]>} one object per data row (empty rows skipped), keyed by the header
 */
async function readSpreadsheetRows(buffer, ext) {
  const workbook = new ExcelJS.Workbook();
  if (ext === 'csv') {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    await workbook.csv.read(stream);
  } else {
    await workbook.xlsx.load(buffer);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headers = [];
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) {
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        headers[colNum - 1] = cell.value != null ? String(cell.value).trim() : '';
      });
      return;
    }
    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const header = headers[colNum - 1];
      if (header) obj[header] = cell.value != null ? cell.value : '';
    });
    if (Object.keys(obj).length > 0) rows.push(obj);
  });
  return rows;
}

module.exports = { readSpreadsheetRows };
