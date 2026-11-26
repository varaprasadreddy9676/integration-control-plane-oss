export function isStaticStyleObject(ts, node) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.every((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    if (
      !ts.isIdentifier(property.name) &&
      !ts.isStringLiteral(property.name) &&
      !ts.isNumericLiteral(property.name)
    ) {
      return false;
    }
    const value = property.initializer;
    return (
      ts.isStringLiteral(value) ||
      ts.isNoSubstitutionTemplateLiteral(value) ||
      ts.isNumericLiteral(value) ||
      (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) ||
      value.kind === ts.SyntaxKind.TrueKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword ||
      value.kind === ts.SyntaxKind.NullKeyword
    );
  });
}
