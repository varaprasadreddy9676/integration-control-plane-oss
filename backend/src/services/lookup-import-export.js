const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const { log } = require('../logger');

const LOOKUP_EXPORT_COLUMNS = [
  { header: 'Source ID', key: 'sourceId', width: 15 },
  { header: 'Source Key', key: 'sourceKey', width: 25 },
  { header: 'Source Name', key: 'sourceName', width: 25 },
  { header: 'Source Supplier Code', key: 'sourceSupplierCode', width: 20 },
  { header: 'Source Supplier Name', key: 'sourceSupplierName', width: 25 },
  { header: 'Target ID', key: 'targetId', width: 15 },
  { header: 'Target Name', key: 'targetName', width: 25 },
  { header: 'Target JSON', key: 'targetJson', width: 40 },
  { header: 'Type', key: 'type', width: 12 },
  { header: 'Category', key: 'category', width: 15 },
  { header: 'Description', key: 'description', width: 30 },
  { header: 'Scope', key: 'scope', width: 12 },
  { header: 'Usage Count', key: 'usageCount', width: 12 },
  { header: 'Last Used', key: 'lastUsed', width: 20 },
  { header: 'Active', key: 'active', width: 8 },
  { header: 'Created', key: 'created', width: 20 },
  { header: 'Updated', key: 'updated', width: 20 },
];

const toLookupExportRow = (lookup) => ({
  sourceId: lookup.source?.id || '',
  sourceKey: lookup.source?.key || '',
  sourceName: lookup.source?.name || '',
  sourceSupplierCode: lookup.source?.supplierCode || '',
  sourceSupplierName: lookup.source?.supplierName || '',
  targetId: lookup.target?.id || '',
  targetName: lookup.target?.name || '',
  targetJson: JSON.stringify(lookup.target || {}),
  type: lookup.type || '',
  category: lookup.category || '',
  description: lookup.description || '',
  scope: lookup.orgUnitRid ? `Org Unit ${lookup.orgUnitRid}` : 'Parent',
  usageCount: lookup.usageCount || 0,
  lastUsed: lookup.lastUsedAt || '',
  active: lookup.isActive ? 'Yes' : 'No',
  created: lookup.createdAt || '',
  updated: lookup.updatedAt || '',
});

/**
 * Create a disk-backed XLSX writer. Call write() for each cursor item then
 * close() once; ExcelJS does not retain all workbook rows in process memory.
 */
function createStreamingLookupXlsxWriter(filePath) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: false,
    useSharedStrings: false,
  });
  const worksheet = workbook.addWorksheet('Lookups');
  worksheet.columns = LOOKUP_EXPORT_COLUMNS;

  return {
    write(lookup) {
      worksheet.addRow(toLookupExportRow(lookup)).commit();
    },
    close() {
      return workbook.commit();
    },
  };
}

/**
 * Read a buffer into an array of row objects using the first row as headers.
 * Supports .xlsx (default) and .csv (detected from filename extension).
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<Object[]>}
 */
async function readBufferRows(buffer, filename) {
  const workbook = new ExcelJS.Workbook();
  const ext = (filename || 'import.xlsx').split('.').pop().toLowerCase();

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
    } else {
      const obj = {};
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const header = headers[colNum - 1];
        if (header) obj[header] = cell.value != null ? cell.value : '';
      });
      if (Object.keys(obj).length > 0) rows.push(obj);
    }
  });

  return rows;
}

/**
 * Parse Excel/CSV file buffer to lookup entries
 * Supports both simple format (source_id, target_id) and detailed format (with metadata)
 */
async function parseImportFile(buffer, type, orgId, orgUnitRid = null, importedFrom = 'import.xlsx') {
  try {
    const rows = await readBufferRows(buffer, importedFrom);

    if (rows.length === 0) {
      throw new Error('Import file is empty');
    }

    const lookups = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel rows start at 1, header is row 1

      try {
        // Required fields
        const sourceId = row.source_id || row.sourceId || row['Source ID'];
        const sourceKey = row.source_key || row.sourceKey || row['Source Key'];
        const targetId = row.target_id || row.targetId || row['Target ID'];
        const targetJsonRaw = row.target_json || row.targetJson || row['Target JSON'];

        if ((!sourceId && !sourceKey) || (!targetId && !targetJsonRaw)) {
          errors.push({
            row: rowNum,
            error: 'Missing required fields: source_id/source_key and target_id/target_json',
          });
          continue;
        }

        // Optional fields
        const sourceName = row.source_name || row.sourceName || row['Source Name'] || null;
        const targetName = row.target_name || row.targetName || row['Target Name'] || null;
        const description = row.description || row.Description || null;
        const category = row.category || row.Category || null;

        // Additional source metadata
        const sourceMetadata = {};
        if (row.source_supplier_code || row.sourceSupplierCode || row['Source Supplier Code']) {
          sourceMetadata.supplierCode =
            row.source_supplier_code || row.sourceSupplierCode || row['Source Supplier Code'];
        }
        if (row.source_supplier_name || row.sourceSupplierName || row['Source Supplier Name']) {
          sourceMetadata.supplierName =
            row.source_supplier_name || row.sourceSupplierName || row['Source Supplier Name'];
        }

        let parsedTarget = {};
        if (targetJsonRaw) {
          try {
            parsedTarget = JSON.parse(String(targetJsonRaw));
          } catch (err) {
            errors.push({
              row: rowNum,
              error: `Invalid target_json: ${err.message}`,
            });
            continue;
          }
        }

        const lookup = {
          orgId,
          orgUnitRid,
          type,
          source: {
            id: String(sourceId || sourceKey).trim(),
            key: sourceKey ? String(sourceKey).trim() : undefined,
            name: sourceName ? String(sourceName).trim() : null,
            ...sourceMetadata,
          },
          target: {
            ...parsedTarget,
            id: targetId ? String(targetId).trim() : parsedTarget.id,
            name: targetName ? String(targetName).trim() : parsedTarget.name || null,
          },
          description,
          category,
          importedFrom,
          importedAt: new Date(),
        };

        lookups.push(lookup);
      } catch (err) {
        errors.push({
          row: rowNum,
          error: err.message,
        });
      }
    }

    log('info', 'Import file parsed', {
      totalRows: rows.length,
      validLookups: lookups.length,
      errors: errors.length,
    });

    return {
      lookups,
      errors,
      totalRows: rows.length,
    };
  } catch (err) {
    throw new Error(`Failed to parse import file: ${err.message}`);
  }
}

/**
 * Generate Excel export from lookup entries
 */
async function generateExportFile(lookups, format = 'xlsx') {
  try {
    // Transform lookups to flat structure for Excel
    const rows = lookups.map((lookup) => ({
      'Source ID': lookup.source.id,
      'Source Key': lookup.source.key || '',
      'Source Name': lookup.source.name || '',
      'Source Supplier Code': lookup.source.supplierCode || '',
      'Source Supplier Name': lookup.source.supplierName || '',
      'Target ID': lookup.target.id,
      'Target Name': lookup.target.name || '',
      'Target JSON': JSON.stringify(lookup.target || {}),
      Type: lookup.type,
      Category: lookup.category || '',
      Description: lookup.description || '',
      Scope: (lookup.orgUnitRid ?? lookup.entityRid) ? `Org Unit ${lookup.orgUnitRid ?? lookup.entityRid}` : 'Parent',
      'Usage Count': lookup.usageCount || 0,
      'Last Used': lookup.lastUsedAt || '',
      Active: lookup.isActive ? 'Yes' : 'No',
      Created: lookup.createdAt || '',
      Updated: lookup.updatedAt || '',
    }));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lookups');

    worksheet.columns = [
      { header: 'Source ID', key: 'Source ID', width: 15 },
      { header: 'Source Key', key: 'Source Key', width: 25 },
      { header: 'Source Name', key: 'Source Name', width: 25 },
      { header: 'Source Supplier Code', key: 'Source Supplier Code', width: 20 },
      { header: 'Source Supplier Name', key: 'Source Supplier Name', width: 25 },
      { header: 'Target ID', key: 'Target ID', width: 15 },
      { header: 'Target Name', key: 'Target Name', width: 25 },
      { header: 'Target JSON', key: 'Target JSON', width: 40 },
      { header: 'Type', key: 'Type', width: 12 },
      { header: 'Category', key: 'Category', width: 15 },
      { header: 'Description', key: 'Description', width: 30 },
      { header: 'Scope', key: 'Scope', width: 12 },
      { header: 'Usage Count', key: 'Usage Count', width: 12 },
      { header: 'Last Used', key: 'Last Used', width: 20 },
      { header: 'Active', key: 'Active', width: 8 },
      { header: 'Created', key: 'Created', width: 20 },
      { header: 'Updated', key: 'Updated', width: 20 },
    ];

    worksheet.addRows(rows);

    log('info', 'Export file generated', { format, rowCount: rows.length });

    if (format === 'csv') {
      return await workbook.csv.writeBuffer();
    }
    return await workbook.xlsx.writeBuffer();
  } catch (err) {
    throw new Error(`Failed to generate export file: ${err.message}`);
  }
}

/**
 * Generate CSV export from lookup entries (simpler format for quick import)
 */
async function generateSimpleCSV(lookups) {
  try {
    const rows = lookups.map((lookup) => ({
      source_id: lookup.source.id,
      source_key: lookup.source.key || '',
      target_id: lookup.target.id,
      target_json: JSON.stringify(lookup.target || {}),
    }));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lookups');

    worksheet.columns = [
      { header: 'source_id', key: 'source_id' },
      { header: 'source_key', key: 'source_key' },
      { header: 'target_id', key: 'target_id' },
      { header: 'target_json', key: 'target_json' },
    ];

    worksheet.addRows(rows);

    log('info', 'Simple CSV generated', { rowCount: rows.length });

    return await workbook.csv.writeBuffer();
  } catch (err) {
    throw new Error(`Failed to generate CSV: ${err.message}`);
  }
}

/**
 * Generate import template (empty Excel file with headers)
 */
async function generateImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Lookups');

  worksheet.columns = [
    { header: 'Source ID', key: 'Source ID', width: 15 },
    { header: 'Source Key', key: 'Source Key', width: 25 },
    { header: 'Target ID', key: 'Target ID', width: 15 },
    { header: 'Target JSON', key: 'Target JSON', width: 40 },
    { header: 'Source Name', key: 'Source Name', width: 25 },
    { header: 'Target Name', key: 'Target Name', width: 25 },
    { header: 'Description', key: 'Description', width: 30 },
    { header: 'Category', key: 'Category', width: 15 },
  ];

  // One empty placeholder row so the template isn't just a header
  worksheet.addRow({});

  return await workbook.xlsx.writeBuffer();
}

module.exports = {
  parseImportFile,
  generateExportFile,
  generateSimpleCSV,
  generateImportTemplate,
  createStreamingLookupXlsxWriter,
};
