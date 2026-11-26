import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStaticStyleObject } from './ui-style-analysis.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(repoRoot, 'frontend', 'src');
const ts = createRequire(join(repoRoot, 'frontend', 'package.json'))('typescript');

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!/\.(?:tsx?|jsx?)$/.test(entry.name)) return [];
    const text = readFileSync(path, 'utf8');
    return [
      {
        path: relative(srcRoot, path).replaceAll('\\', '/'),
        text,
        ast: ts.createSourceFile(
          path,
          text,
          ts.ScriptTarget.Latest,
          true,
          path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        ),
      },
    ];
  });
}

const files = walk(srcRoot);
const tsxFiles = files.filter(({ path }) => /\.tsx$/.test(path));
const sourceFiles = files.filter(({ path }) => !/(^|\/)tests?\//.test(path) && !/\.(?:test|spec)\./.test(path));
const testFiles = files.filter(({ path }) => /(^|\/)tests?\//.test(path) || /\.(?:test|spec)\./.test(path));
const disciplineFiles = sourceFiles.filter(({ path }) => !/(^|\/)charts?(\/|$)/i.test(path));
const featureFiles = sourceFiles.filter(({ path }) => path.startsWith('features/'));

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function countInFiles(input, pattern) {
  return input.reduce((total, file) => total + count(file.text, pattern), 0);
}

function importDeclarations(file, moduleName, prefix = false) {
  return file.ast.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (prefix ? statement.moduleSpecifier.text.startsWith(moduleName) : statement.moduleSpecifier.text === moduleName)
  );
}

function countImportFiles(input, moduleName, prefix = false) {
  return input.filter((file) => importDeclarations(file, moduleName, prefix).length > 0).length;
}

function countAntdBoundaryFiles(input) {
  return input.filter(({ ast }) =>
    ast.statements.some(
      (statement) =>
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith('antd')
    )
  ).length;
}

function countNamedImportFiles(input, moduleName, component) {
  return input.filter((file) =>
    importDeclarations(file, moduleName).some((statement) => {
      const bindings = statement.importClause?.namedBindings;
      return Boolean(
        bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some((specifier) => (specifier.propertyName || specifier.name).text === component)
      );
    })
  ).length;
}

function countJsxTag(input, tag) {
  let total = 0;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName;
      const matches = ts.isIdentifier(tagName)
        ? tagName.text === tag
        : ts.isPropertyAccessExpression(tagName) &&
          ts.isIdentifier(tagName.expression) &&
          tagName.expression.text === tag;
      if (matches) total += 1;
    }
    ts.forEachChild(node, visit);
  };
  input.forEach(({ ast }) => visit(ast));
  return total;
}

function countRawSpacingAssignments(input) {
  let total = 0;
  const visit = (file, node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      /^(?:padding|margin|gap)[A-Za-z]*$/.test(node.name.text)
    ) {
      const initializer = node.initializer;
      const numeric =
        ts.isNumericLiteral(initializer) ||
        (ts.isPrefixUnaryExpression(initializer) && ts.isNumericLiteral(initializer.operand));
      const pixelString =
        ts.isStringLiteral(initializer) && /(?:^|[^\w.])-?\d+(?:\.\d+)?px\b/.test(initializer.text);
      const reactFlowRatio =
        file.path === 'features/flowBuilder/components/FlowCanvas.tsx' &&
        node.name.text === 'padding' &&
        initializer.getText(file.ast) === '0.2';
      if ((numeric || pixelString) && !reactFlowRatio) total += 1;
    }
    ts.forEachChild(node, (child) => visit(file, child));
  };
  input.forEach((file) => visit(file, file.ast));
  return total;
}

const antdComponents = [
  'Button',
  'Tabs',
  'Tag',
  'Alert',
  'Empty',
  'Typography',
  'Form',
  'Input',
  'Select',
  'Modal',
  'Drawer',
  'Table',
  'Switch',
  'Tooltip',
  'Space',
  'Card',
  'Row',
  'Col',
  'Collapse',
  'Radio',
  'Checkbox',
  'DatePicker',
];
const jsxComponents = ['Button', 'Tabs', 'Tag', 'Alert', 'Empty', 'Typography'];
const fontSizeMatches = [];
for (const file of disciplineFiles) {
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'fontSize') {
      const initializer = node.initializer;
      const rawNumber = ts.isNumericLiteral(initializer) ||
        (ts.isPrefixUnaryExpression(initializer) && ts.isNumericLiteral(initializer.operand));
      const rawPixelString = ts.isStringLiteral(initializer) && /^\d+(?:\.\d+)?px$/.test(initializer.text);
      if (rawNumber || rawPixelString) {
        fontSizeMatches.push({ path: file.path, value: initializer.getText(file.ast) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file.ast);
}
const fontSizeValues = Object.fromEntries(
  [...new Set(fontSizeMatches.map(({ value }) => value))]
    .sort()
    .map((value) => [value, fontSizeMatches.filter((item) => item.value === value).length])
);
const routeSource = readFileSync(join(srcRoot, 'app', 'App.tsx'), 'utf8');
const pageTemplateImports = sourceFiles.filter(({ ast }) =>
  ast.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((specifier) => specifier.name.text === 'PageTemplate')
  )
).length;
const routeFeatureComponents = Object.fromEntries(
  jsxComponents.map((name) => [name, countNamedImportFiles(featureFiles, 'antd', name)])
);
const styleObjectFiles = disciplineFiles.filter(({ path, text }) => /\.tsx$/.test(path) && /style=\{\{/g.test(text));
const staticStyleObjects = [];
for (const file of disciplineFiles) {
  if (!/\.tsx$/.test(file.path)) continue;
  const visit = (node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file.ast) === 'style' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      isStaticStyleObject(ts, node.initializer.expression)
    ) {
      staticStyleObjects.push(file.path);
    }
    ts.forEachChild(node, visit);
  };
  visit(file.ast);
}

// Resolve lazy route components so the route-template metric counts actual console
// pages, not every <Route> declaration (which also includes aliases and public pages).
const appPath = join(srcRoot, 'app', 'App.tsx');
const appAst = ts.createSourceFile(appPath, routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lazyModules = new Map();
for (const match of routeSource.matchAll(/const\s+(\w+)\s*=\s*lazy\([\s\S]*?import\(['"]([^'"]+)['"]/g)) {
  const resolved = ts.resolveModuleName(match[2], appPath, { moduleResolution: ts.ModuleResolutionKind.Node10 }, ts.sys)
    .resolvedModule?.resolvedFileName;
  if (resolved) lazyModules.set(match[1], resolved);
}
function resolveBarrel(filePath, exportName) {
  let source = readFileSync(filePath, 'utf8');
  const match = source.match(
    new RegExp(
      `export\\s+(?:\\{[^}]*\\b${exportName}\\b[^}]*\\}|\\*\\s+as\\s+${exportName})\\s+from\\s+['"]([^'"]+)['"]`
    )
  );
  if (!match) return filePath;
  return (
    ts.resolveModuleName(match[1], filePath, { moduleResolution: ts.ModuleResolutionKind.Node10 }, ts.sys)
      .resolvedModule?.resolvedFileName || filePath
  );
}
const routeCoverage = { applicationRoutes: 0, pageTemplateRoutes: 0, missingPageTemplate: [] };
const visitRoutes = (node) => {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(appAst) === 'Route') {
    const attributes = node.attributes.properties;
    const pathAttribute = attributes.find((item) => ts.isJsxAttribute(item) && item.name.getText(appAst) === 'path');
    const elementAttribute = attributes.find(
      (item) => ts.isJsxAttribute(item) && item.name.getText(appAst) === 'element'
    );
    const routePath =
      pathAttribute?.initializer && ts.isStringLiteral(pathAttribute.initializer)
        ? pathAttribute.initializer.text
        : null;
    const routeElement = elementAttribute?.initializer?.getText(appAst) || '';
    const componentName = routeElement.match(/<([A-Za-z_$][\w$]*)\b/)?.[1];
    const initialModule = componentName && lazyModules.get(componentName);
    if (routePath && initialModule && !/^\/login(?:\/|$)/.test(routePath)) {
      const modulePath = resolveBarrel(initialModule, componentName);
      const moduleText = readFileSync(modulePath, 'utf8');
      routeCoverage.applicationRoutes += 1;
      if (/<PageTemplate\b/.test(moduleText)) routeCoverage.pageTemplateRoutes += 1;
      else routeCoverage.missingPageTemplate.push(routePath);
    }
  }
  ts.forEachChild(node, visitRoutes);
};
visitRoutes(appAst);

const metrics = {
  schemaVersion: 1,
  sourceRoot: 'frontend/src',
  scope: {
    sourceFiles: files.length,
    nonTestSourceFiles: sourceFiles.length,
    disciplineFilesExcludingTestsAndChartInternals: disciplineFiles.length,
    routeDefinitionsInApp: count(routeSource, /<Route\s+path=/g),
  },
  designSystemAdoption: {
    antdImportFiles: countImportFiles(files, 'antd'),
    applicationAntdImportFiles: countImportFiles(sourceFiles, 'antd'),
    testAntdImportFiles: countImportFiles(testFiles, 'antd'),
    applicationAntdBoundaryFiles: countAntdBoundaryFiles(sourceFiles),
    astryxImportFiles: countImportFiles(files, '@astryxdesign/', true),
    antDesignIconImportFiles: countImportFiles(files, '@ant-design/icons'),
    antdButtonImportFiles: countNamedImportFiles(files, 'antd', 'Button'),
    antdComponentImportFiles: Object.fromEntries(
      antdComponents.map((name) => [name, countNamedImportFiles(files, 'antd', name)])
    ),
    applicationAntdComponentImportFiles: Object.fromEntries(
      antdComponents.map((name) => [name, countNamedImportFiles(sourceFiles, 'antd', name)])
    ),
    jsxUsages: Object.fromEntries(jsxComponents.map((name) => [name, countJsxTag(tsxFiles, name)])),
    routeFeatureAntdImportFiles: routeFeatureComponents,
    tagUsages: countJsxTag(tsxFiles, 'Tag'),
    alertUsages: countJsxTag(tsxFiles, 'Alert'),
  },
  discipline: {
    inlineFontSizeCount: fontSizeMatches.length,
    inlineFontSizeValues: fontSizeValues,
    rawSpacingNumberCount: countRawSpacingAssignments(disciplineFiles),
    inlineStyleObjectCount: countInFiles(
      disciplineFiles.filter(({ path }) => /\.tsx$/.test(path)),
      /style=\{\{/g
    ),
    inlineStyleObjectFiles: styleObjectFiles.length,
    staticInlineStyleObjectCount: staticStyleObjects.length,
    staticInlineStyleObjectFiles: new Set(staticStyleObjects).size,
    hexColorCount: countInFiles(
      disciplineFiles.filter(({ path }) => /\.tsx$/.test(path)),
      /#[0-9a-fA-F]{6}\b/g
    ),
  },
  layoutAdoption: {
    pageTemplateImportFiles: pageTemplateImports,
    pageTemplateUsages: countInFiles(tsxFiles, /<PageTemplate\b/g),
    routeCoverage,
  },
};

process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
