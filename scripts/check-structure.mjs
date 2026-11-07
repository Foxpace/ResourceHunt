import ts from "typescript";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";

const roots = ["src", "bots", "scripts", "tests", ".github"];
const codeExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const paths = roots.filter(existsSync).flatMap(listSourcePaths);
if (existsSync("workshop-timer.html")) paths.push("workshop-timer.html");

const violations = checkSources(paths);
for (const violation of violations) console.error(violation);
if (violations.length) process.exitCode = 1;
else
  console.log(
    "Structure checks passed: parameters, function size, nesting, and readable conditions and collection predicates.",
  );

function listSourcePaths(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => {
      const supported = codeExtension.test(entry.name) || entry.name.endsWith(".html");
      const regularFile = entry.isFile();
      return regularFile && supported;
    })
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

function checkSources(paths) {
  const scripts = new Map(paths.filter((path) => path.endsWith(".html")).flatMap(inlineScripts));
  const fileNames = [...paths.filter((path) => codeExtension.test(path)), ...scripts.keys()];
  const options = { ...projectCompilerOptions(), allowJs: true, strict: true };
  const host = ts.createCompilerHost(options, true);
  const readSource = host.readFile;
  host.readFile = (path) => scripts.get(path) ?? readSource(path);

  const program = ts.createProgram(fileNames, options, host);
  const checker = program.getTypeChecker();
  return fileNames.flatMap((path) => checkFile(program.getSourceFile(path), checker));
}

function projectCompilerOptions() {
  const configPath = "tsconfig.json";
  if (!existsSync(configPath))
    return { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest, types: [] };

  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.convertCompilerOptionsFromJson(config.compilerOptions, ".").options;
}

function inlineScripts(path) {
  const html = readFileSync(path, "utf8");
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  return [...scripts].flatMap((match, index) => {
    const [, attributes, code] = match;
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
    const unsupportedType = type !== undefined && !["module", "text/javascript"].includes(type);
    if (unsupportedType) return [];
    if (!code.trim()) return [];

    const start = match.index + match[0].indexOf(">") + 1;
    const padding = html.slice(0, start).replace(/[^\r\n]/g, " ");
    return [[`${path}.${index}.js`, padding + code]];
  });
}

function checkFile(source, checker) {
  const errors = [];
  const analysis = { source, errors, checker };
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

  const path = relative(process.cwd(), source.fileName).replace(/(\.html)\.\d+\.js$/, "$1");
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
  const closingParen = node
    .getChildren(source)
    .find((child) => child.kind === ts.SyntaxKind.CloseParenToken);
  const end = source.getLineAndCharacterOfPosition(closingParen?.end ?? node.expression.end).line;
  if (start !== end) errors.push(`${start + 1} if condition must fit on one line`);
  const terms = conditionTerms(node.expression);
  if (terms.length > 3) errors.push(`${start + 1} if condition exceeds three boolean terms`);
  const unnamedCompound =
    terms.length > 1 && !terms.every((term) => isLocalBoolean(term, analysis));
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

function isLocalBoolean(expression, { source, checker }) {
  const value = isNegation(expression) ? ts.skipParentheses(expression.operand) : expression;
  if (!ts.isIdentifier(value)) return false;
  if (value.text.length < 2) return false;

  const declarations = checker.getSymbolAtLocation(value)?.declarations ?? [];
  const declaration = declarations.find((candidate) => isLocalBinding(candidate, source));
  if (!declaration) return false;
  if (isModuleBindingUsedInFunction(declaration, value)) return false;

  return isBooleanType(checker.getTypeAtLocation(value));
}

function isLocalBinding(declaration, source) {
  if (declaration.getSourceFile() !== source) return false;

  return (
    ts.isVariableDeclaration(declaration) ||
    ts.isBindingElement(declaration) ||
    ts.isParameter(declaration)
  );
}

function isModuleBindingUsedInFunction(declaration, value) {
  const declaredOutsideFunction = !ts.findAncestor(declaration.parent, ts.isFunctionLike);
  const usedInsideFunction = !!ts.findAncestor(value.parent, ts.isFunctionLike);
  return declaredOutsideFunction && usedInsideFunction;
}

function isBooleanType(type) {
  if (type.isUnion()) return type.types.every(isBooleanType);

  return !!(type.flags & (ts.TypeFlags.BooleanLike | ts.TypeFlags.Never));
}

function checkTestScenario(node, analysis) {
  const { source, errors } = analysis;
  const testFile = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(source.fileName);
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
  const unnamedTerms = terms.length > 1 && !terms.every((term) => isLocalBoolean(term, analysis));
  const tooManyTerms = terms.length > 3;
  const readable = !unnamedTerms && !tooManyTerms;
  if (readable) return;

  const line = analysis.source.getLineAndCharacterOfPosition(expression.getStart()).line + 1;
  analysis.errors.push(`${line} ${context} must use at most three named booleans`);
}
