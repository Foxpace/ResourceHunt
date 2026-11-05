import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";

const roots = ["src", "bots", "scripts", "tests"];
const violations = roots.flatMap(checkDirectory);
for (const violation of violations) console.error(violation);
if (violations.length) process.exitCode = 1;
else
  console.log(
    "Structure checks passed: parameters, function size, nesting, and readable conditions and collection predicates.",
  );

function checkDirectory(directory) {
  return readdirSync(directory, { recursive: true })
    .filter((file) => /\.(ts|mjs)$/.test(file))
    .flatMap((file) => checkFile(`${directory}/${file}`));
}

function checkFile(path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const errors = [];
  const analysis = { source, errors };
  function visit(node) {
    if (ts.isFunctionLike(node)) checkFunction(node, analysis);
    if (ts.isIfStatement(node)) checkIfCondition(node, analysis);
    if (ts.isConditionalExpression(node)) checkNamedCondition(node.condition, "ternary", analysis);
    if (ts.isCallExpression(node)) {
      checkTestScenario(node, analysis);
      checkCollectionPredicate(node, analysis);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  checkNesting(source, 0, analysis);

  return errors.map((error) => `${path}:${error}`);
}

function checkFunction(node, analysis) {
  const { source, errors } = analysis;
  const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const name = describeFunction(node, source);
  if (node.parameters.length > 3) errors.push(`${start + 1} ${name}: more than three parameters`);
  if (!node.body) return;

  const end = source.getLineAndCharacterOfPosition(node.body.end).line;
  if (end - start + 1 > 30) errors.push(`${start + 1} ${name}: ${end - start + 1} lines`);

  checkNesting(node.body, 0, analysis);
}

function describeFunction(node, source) {
  if (node.name) return node.name.getText(source);
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isVariableDeclaration(node.parent)) return node.parent.name.getText(source);

  return "callback";
}

function checkNesting(node, depth, analysis) {
  const { source, errors } = analysis;
  if (ts.isFunctionLike(node)) return;
  const nested =
    ts.isIfStatement(node) ||
    ts.isIterationStatement(node, false) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node);
  const level = depth + Number(nested);
  const excessiveNesting = nested && level > 2;
  if (excessiveNesting) {
    errors.push(
      `${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} nesting exceeds two levels`,
    );
    return;
  }
  ts.forEachChild(node, (child) => {
    const elseIf =
      ts.isIfStatement(node) && node.elseStatement === child && ts.isIfStatement(child);
    checkNesting(child, elseIf ? depth : level, analysis);
  });
}

function checkIfCondition(node, analysis) {
  const { source, errors } = analysis;
  const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const end = source.getLineAndCharacterOfPosition(node.expression.end).line;
  if (start !== end) errors.push(`${start + 1} if condition must fit on one line`);
  const terms = conditionTerms(node.expression);
  if (terms.length > 3) errors.push(`${start + 1} if condition exceeds three boolean terms`);
  const unnamedCompound = terms.length > 1 && !terms.every(isNamedBoolean);
  if (unnamedCompound) errors.push(`${start + 1} compound if must use named local booleans`);
}

function conditionTerms(expression) {
  if (ts.isParenthesizedExpression(expression)) return conditionTerms(expression.expression);
  if (isNegation(expression)) {
    const operandTerms = conditionTerms(expression.operand);
    return operandTerms.length > 1 ? operandTerms : [expression];
  }

  const logicalOperators = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken];
  const compound =
    ts.isBinaryExpression(expression) && logicalOperators.includes(expression.operatorToken.kind);
  if (!compound) return [expression];
  return [...conditionTerms(expression.left), ...conditionTerms(expression.right)];
}

function isNegation(expression) {
  const isUnary = ts.isPrefixUnaryExpression(expression);
  return isUnary && expression.operator === ts.SyntaxKind.ExclamationToken;
}

function isNamedBoolean(expression) {
  if (ts.isIdentifier(expression)) return true;
  if (!isNegation(expression)) return false;

  return ts.isIdentifier(expression.operand);
}

function checkTestScenario(node, analysis) {
  const { source, errors } = analysis;
  const testFile = source.fileName.endsWith(".test.ts");
  const testCall = ts.isIdentifier(node.expression) && node.expression.text === "test";
  if (!testFile || !testCall) return;

  const callback = node.arguments.at(-1);
  if (!callback?.body) return;

  const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const end = source.getLineAndCharacterOfPosition(node.end).line;
  const lines = end - start + 1;
  if (lines > 20) errors.push(`${start + 1} test scenario: ${lines} lines; maximum is 20`);
  if (!hasScenarioSections(callback.body, source)) {
    errors.push(`${start + 1} test scenario must have Given, When, Then comments in order`);
  }
}

function hasScenarioSections(body, source) {
  const comments = body.statements.flatMap(
    (statement) => ts.getLeadingCommentRanges(source.text, statement.pos) ?? [],
  );
  const sections = comments.flatMap((comment) => {
    const text = source.text.slice(comment.pos, comment.end);
    const section = text.match(/^\/\/ (Given|When|Then)\b/);

    return section ? [section[1]] : [];
  });

  return sections.join(" ") === "Given When Then";
}

function checkCollectionPredicate(node, analysis) {
  if (!ts.isPropertyAccessExpression(node.expression)) return;
  const predicates = ["filter", "find", "findIndex", "some", "every"];
  if (!predicates.includes(node.expression.name.text)) return;

  const callback = node.arguments[0];
  if (!callback) return;
  const inlineCallback = ts.isArrowFunction(callback) || ts.isFunctionExpression(callback);
  if (!inlineCallback) return;

  const expressions = ts.isBlock(callback.body) ? predicateReturns(callback.body) : [callback.body];
  for (const expression of expressions)
    checkNamedCondition(expression, "collection predicate", analysis);
}

function predicateReturns(node) {
  if (ts.isFunctionLike(node)) return [];
  if (ts.isReturnStatement(node)) return node.expression ? [node.expression] : [];

  const expressions = [];
  ts.forEachChild(node, (child) => {
    expressions.push(...predicateReturns(child));
  });

  return expressions;
}

function checkNamedCondition(expression, context, analysis) {
  const terms = conditionTerms(expression);
  const unnamedTerms = terms.length > 1 && !terms.every(isNamedBoolean);
  const tooManyTerms = terms.length > 3;
  const readable = !unnamedTerms && !tooManyTerms;
  if (readable) return;

  const line = analysis.source.getLineAndCharacterOfPosition(expression.getStart()).line + 1;
  analysis.errors.push(`${line} ${context} must use at most three named booleans`);
}
