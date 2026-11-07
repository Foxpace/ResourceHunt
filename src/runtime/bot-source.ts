import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import ts from "typescript";
import type { BotMetadata } from "../engine/types.ts";
import type { CheckedBotSource } from "./worker-protocol.ts";

export async function checkBotSource(file: string): Promise<CheckedBotSource> {
  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const botClass = findDefaultClass(source);
  if (!botClass) throw new Error("Default-export a bot class");

  checkActMethod(botClass);
  const metadata = readMetadata(botClass);
  const compiled = await transform(text, { loader: "ts", format: "esm", sourcefile: file });

  return { url: pathToFileURL(file).href, code: compiled.code, metadata };
}

function findDefaultClass(source: ts.SourceFile): ts.ClassLikeDeclaration | undefined {
  const classes = source.statements.filter(ts.isClassDeclaration);
  const defaultClass = classes.find((node) => hasModifier(node, ts.SyntaxKind.DefaultKeyword));
  if (defaultClass) return defaultClass;

  const assignment = source.statements.find(ts.isExportAssignment);
  if (!assignment) return;
  if (assignment.isExportEquals) return;

  const expression = unwrapExpression(assignment.expression);
  if (ts.isClassExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return;

  return classes.find((node) => node.name?.text === expression.text);
}

function checkActMethod(botClass: ts.ClassLikeDeclaration): void {
  const members = botClass.members.filter((member) => isNamedMember(member, "act"));
  const implementations = members.filter(isImplementedMethod);
  if (implementations.length !== 1) throw new Error("Bot class needs an act(state) method");
  if (!members.every(ts.isMethodDeclaration)) throw new Error("Bot act must be an instance method");
}

function isImplementedMethod(member: ts.ClassElement): boolean {
  if (!ts.isMethodDeclaration(member)) return false;

  return !!member.body && !hasModifier(member, ts.SyntaxKind.StaticKeyword);
}

function isNamedMember(member: ts.ClassElement, name: string): boolean {
  return !!member.name && readName(member.name) === name;
}

function readMetadata(botClass: ts.ClassLikeDeclaration): BotMetadata {
  const fields = botClass.members.filter((member) =>
    hasModifier(member, ts.SyntaxKind.StaticKeyword),
  );
  const metadata = fields.filter((member) => isNamedMember(member, "metadata"));
  if (metadata.length !== 1) throw invalidMetadata();
  const field = metadata[0]!;
  if (!ts.isPropertyDeclaration(field)) throw invalidMetadata();
  if (!field.initializer) throw invalidMetadata();

  const initializer = unwrapExpression(field.initializer);
  if (!ts.isObjectLiteralExpression(initializer)) throw invalidMetadata();

  const values = new Map(initializer.properties.map(readMetadataProperty));
  if (values.size !== initializer.properties.length) throw invalidMetadata();

  const id = values.get("id") ?? "";
  const name = values.get("name") ?? "";
  const description = values.get("description");
  const validId = /^[a-z0-9][a-z0-9-]{0,47}$/.test(id);
  const validName = !!name.trim() && name.length <= 60;
  const validDescription = description !== undefined && description.length <= 300;
  if (!validId) throw new Error("Invalid bot metadata id");
  if (!validName) throw new Error("Invalid bot metadata name");
  if (!validDescription) throw new Error("Invalid bot metadata description");

  return { id, name, description };
}

function readMetadataProperty(property: ts.ObjectLiteralElementLike): [string, string] {
  if (!ts.isPropertyAssignment(property)) throw invalidMetadata();

  const name = readName(property.name);
  const value = unwrapExpression(property.initializer);
  const isString = ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value);
  if (name === undefined) throw invalidMetadata();
  if (!isString) throw invalidMetadata();

  return [name, value.text];
}

function readName(name: ts.PropertyName): string | undefined {
  const isPlainName = ts.isIdentifier(name) || ts.isStringLiteral(name);
  if (isPlainName) return name.text;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  const isWrapper =
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression);
  if (isWrapper) return unwrapExpression(expression.expression);

  return expression;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;

  return ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
}

function invalidMetadata(): Error {
  return new Error(
    "Declare static metadata as an object with string literals for id, name, and description",
  );
}
