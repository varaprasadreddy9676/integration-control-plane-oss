import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStaticStyleObject } from './ui-style-analysis.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const frontendRoot = join(repoRoot, 'frontend');
const srcRoot = join(frontendRoot, 'src');
const allowlistPath = join(repoRoot, 'scripts', 'ui-ratchet-allowlist.json');
const ts = createRequire(join(frontendRoot, 'package.json'))('typescript');
const current = {};

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
    const text = readFileSync(path, 'utf8');
    const ast = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    return [{ path, text, ast }];
  });
}

function add(category, path) {
  current[category] ||= {};
  current[category][path] = (current[category][path] || 0) + 1;
}

function isNumericLiteral(node) {
  return ts.isNumericLiteral(node) || (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));
}

for (const file of walk(srcRoot)) {
  const path = relative(srcRoot, file.path).replaceAll('\\', '/');
  const inFeature = path.startsWith('features/');
  const excludedFromDiscipline =
    /(^|\/)tests?\//.test(path) || /\.(?:test|spec)\./.test(path) || /(^|\/)charts?(\/|$)/i.test(path);

  for (const statement of file.ast.statements) {
    const isTestFile = /(^|\/)tests?\//.test(path) || /\.(?:test|spec)\./.test(path);
    const approvedAntdBoundaries = new Set([
      'components/common/LegacyAntdControls.ts',
      'components/common/LegacySpace.tsx',
      'design-system/theme/antd-theme.ts',
    ]);
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleName = statement.moduleSpecifier.text;
      if (moduleName.startsWith('antd') && !isTestFile && !approvedAntdBoundaries.has(path)) {
        add('unwrappedAntdImports', path);
      }
      if (inFeature && moduleName === 'antd') add('featureAntdImports', path);
      if (inFeature && moduleName === '@ant-design/icons') add('featureAntdIconImports', path);
      if (moduleName === '@ant-design/icons' && path !== 'components/common/Icon.tsx') {
        add('directAntdIconImports', path);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleName = statement.moduleSpecifier.text;
      if (moduleName.startsWith('antd') && !isTestFile && !approvedAntdBoundaries.has(path)) {
        add('unwrappedAntdImports', path);
      }
    }
  }

  if (excludedFromDiscipline) continue;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributeNames = new Set();
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(file.ast);
        if (attributeNames.has(name)) add('duplicateJsxAttributes', path);
        attributeNames.add(name);
      }
      const tagName = node.tagName;
      const name = ts.isIdentifier(tagName)
        ? tagName.text
        : ts.isPropertyAccessExpression(tagName)
          ? tagName.name.text
          : '';
      if (name === 'Tag') add('tagUsages', path);
      if (name === 'Alert') add('alertUsages', path);
      if (name === 'Typography') add('typographyUsages', path);
    }
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file.ast) === 'style' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      add('inlineStyleObjects', path);
      if (isStaticStyleObject(ts, node.initializer.expression)) add('staticInlineStyleObjects', path);
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && isNumericLiteral(node.initializer)) {
      if (node.name.text === 'fontSize') add('inlineFontSizeLiterals', path);
      const reactFlowRatio =
        path === 'features/flowBuilder/components/FlowCanvas.tsx' &&
        node.name.text === 'padding' &&
        node.initializer.getText(file.ast) === '0.2';
      if (/^(?:padding|margin|gap)[A-Za-z]*$/.test(node.name.text) && !reactFlowRatio) add('rawSpacingLiterals', path);
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      /^(?:padding|margin|gap)[A-Za-z]*$/.test(node.name.text) &&
      ts.isStringLiteral(node.initializer) &&
      /(?:^|[^\w.])-?\d+(?:\.\d+)?px\b/.test(node.initializer.text)
    ) {
      add('rawSpacingLiterals', path);
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'fontSize' &&
      ts.isStringLiteral(node.initializer) &&
      /^\d+(?:\.\d+)?px$/.test(node.initializer.text)
    ) {
      add('inlineFontSizeLiterals', path);
    }
    if (ts.isStringLiteral(node) && /^#[0-9a-fA-F]{6}$/.test(node.text)) add('hexColorLiterals', path);
    ts.forEachChild(node, visit);
  };
  visit(file.ast);
}

if (process.argv.includes('--write-allowlist')) {
  writeFileSync(
    allowlistPath,
    `${JSON.stringify({ schemaVersion: 1, generatedFrom: 'frontend/src', categories: current }, null, 2)}\n`
  );
  process.stdout.write(`Wrote ${relative(repoRoot, allowlistPath)}\n`);
  process.exit(0);
}

if (!existsSync(allowlistPath)) {
  process.stderr.write(
    `Missing ${relative(repoRoot, allowlistPath)}; create the initial baseline with --write-allowlist.\n`
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(allowlistPath, 'utf8'));
const violations = [];
for (const category of [
  'featureAntdImports',
  'unwrappedAntdImports',
  'featureAntdIconImports',
  'directAntdIconImports',
  'inlineFontSizeLiterals',
  'rawSpacingLiterals',
  'inlineStyleObjects',
  'staticInlineStyleObjects',
  'hexColorLiterals',
  'tagUsages',
  'alertUsages',
  'typographyUsages',
  'duplicateJsxAttributes',
]) {
  for (const [path, count] of Object.entries(current[category] || {})) {
    const allowed = baseline.categories?.[category]?.[path] || 0;
    if (count > allowed) violations.push(`${category}: ${path} has ${count}; ratchet permits ${allowed}`);
  }
}

const tagTotal = Object.values(current.tagUsages || {}).reduce((sum, value) => sum + value, 0);
const alertTotal = Object.values(current.alertUsages || {}).reduce((sum, value) => sum + value, 0);
if (tagTotal > 80) violations.push(`Tag usages ${tagTotal} exceed the target ceiling of 80`);
if (alertTotal > 60) violations.push(`Alert usages ${alertTotal} exceed the target ceiling of 60`);

const appPath = join(srcRoot, 'app', 'App.tsx');
const appText = readFileSync(appPath, 'utf8');
const appAst = ts.createSourceFile(appPath, appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lazyModules = new Map();
for (const match of appText.matchAll(/const\s+(\w+)\s*=\s*lazy\([\s\S]*?import\(['"]([^'"]+)['"]/g)) {
  const resolved = ts.resolveModuleName(
    match[2],
    appPath,
    { moduleResolution: ts.ModuleResolutionKind.Node10 },
    ts.sys
  ).resolvedModule?.resolvedFileName;
  if (resolved) lazyModules.set(match[1], resolved);
}
function resolveRouteModule(filePath, exportName) {
  const source = readFileSync(filePath, 'utf8');
  const match = source.match(
    new RegExp(`export\\s+(?:\\{[^}]*\\b${exportName}\\b[^}]*\\}|\\*\\s+as\\s+${exportName})\\s+from\\s+['"]([^'"]+)['"]`)
  );
  return match
    ? ts.resolveModuleName(match[1], filePath, { moduleResolution: ts.ModuleResolutionKind.Node10 }, ts.sys)
        .resolvedModule?.resolvedFileName || filePath
    : filePath;
}
const applicationRoutes = [];
const visitRoutes = (node) => {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(appAst) === 'Route') {
    const attributes = node.attributes.properties;
    const pathAttribute = attributes.find((item) => ts.isJsxAttribute(item) && item.name.getText(appAst) === 'path');
    const elementAttribute = attributes.find(
      (item) => ts.isJsxAttribute(item) && item.name.getText(appAst) === 'element'
    );
    const routePath = pathAttribute?.initializer && ts.isStringLiteral(pathAttribute.initializer)
      ? pathAttribute.initializer.text
      : null;
    const componentName = elementAttribute?.initializer?.getText(appAst).match(/<([A-Za-z_$][\w$]*)\b/)?.[1];
    const routeModule = componentName && lazyModules.get(componentName);
    if (routePath && routeModule && !/^\/login(?:\/|$)/.test(routePath)) {
      const resolvedPath = resolveRouteModule(routeModule, componentName);
      const routeSource = readFileSync(resolvedPath, 'utf8');
      applicationRoutes.push(routePath);
      if (!/<PageTemplate\b/.test(routeSource)) {
        violations.push(`route ${routePath} does not use PageTemplate`);
      }
    }
  }
  ts.forEachChild(node, visitRoutes);
};
visitRoutes(appAst);
if (applicationRoutes.length !== 47) {
  violations.push(`product route count is ${applicationRoutes.length}; expected 47 (login excluded)`);
}

if (violations.length) {
  process.stderr.write(`UI consistency ratchet failed:\n${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('UI consistency ratchet passed (no per-file regressions).\n');
