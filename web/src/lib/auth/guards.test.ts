import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Le proxy ne couvre pas /api, et une action serveur s'appelle par une simple requête POST, depuis
// n'importe quelle page : chaque route et chaque action vérifient donc la session elles-mêmes, en
// premier. Ce test lit le source, comme celui des pages (pages.test.ts) : une route ou une action
// ajoutée sans contrôle échoue ici, sans attendre qu'un test l'appelle.

const SRC = path.resolve(import.meta.dirname, "../..");
const APP = path.join(SRC, "app");

/** Routes servies sans session, chacune pour une raison écrite dans son source. */
const PUBLIC_ROUTES = new Map([
  ["api/health/route.ts", "sonde de santé, sans donnée"],
  ["api/sync/route.ts", "agent : jeton d'agent, vérifié par handleSyncRequest"],
  ["app.webmanifest/route.ts", "manifeste de l'application installable, statique"],
]);
/** Actions appelées sans session : se connecter, se déconnecter. */
const PUBLIC_ACTIONS = new Set(["loginAction", "logoutAction"]);
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const exported = (node: ts.Node) => (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

function awaitedCall(expression: ts.Expression | undefined, name: string): boolean {
  if (!expression || !ts.isAwaitExpression(expression) || !ts.isCallExpression(expression.expression)) return false;
  const callee = expression.expression.expression;
  return ts.isIdentifier(callee) && callee.text === name;
}

const initializerOf = (statement: ts.Statement | undefined) =>
  statement && ts.isVariableStatement(statement) ? statement.declarationList.declarations.at(0) : undefined;

function imports(source: ts.SourceFile, name: string): boolean {
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    const bindings = statement.importClause?.namedBindings;
    return (
      statement.moduleSpecifier.text === "@/lib/auth/session" &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === name && element.propertyName === undefined)
    );
  });
}

/** `const session = await getSession();` puis `if (!session) return …;`, en tête du corps. */
function startsWithRouteCheck(body: ts.Block): boolean {
  const declaration = initializerOf(body.statements.at(0));
  if (!declaration || !ts.isIdentifier(declaration.name) || !awaitedCall(declaration.initializer, "getSession")) return false;
  const guard = body.statements.at(1);
  if (!guard || !ts.isIfStatement(guard)) return false;
  const condition = guard.expression;
  const negated =
    ts.isPrefixUnaryExpression(condition) &&
    condition.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(condition.operand) &&
    condition.operand.text === declaration.name.text;
  const last = ts.isBlock(guard.thenStatement) ? guard.thenStatement.statements.at(-1) : guard.thenStatement;
  const returns = last !== undefined && ts.isReturnStatement(last);
  return negated && returns;
}

/** `await requireSession();` ou `const session = await requireSession();`, en tête du corps. */
function startsWithActionCheck(body: ts.Block): boolean {
  const first = body.statements.at(0);
  if (first && ts.isExpressionStatement(first)) return awaitedCall(first.expression, "requireSession");
  return awaitedCall(initializerOf(first)?.initializer, "requireSession");
}

/** Méthodes d'une route qui ne commencent pas par le contrôle de session. */
function unguardedRoute(text: string): string[] {
  const source = ts.createSourceFile("route.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures: string[] = [];
  let methods = 0;
  for (const statement of source.statements) {
    if (!exported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.has(declaration.name.text)) failures.push(`${declaration.name.text} : à écrire en déclaration de fonction`);
      }
      continue;
    }
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !HTTP_METHODS.has(statement.name.text)) continue;
    methods += 1;
    if (!statement.body || !startsWithRouteCheck(statement.body)) failures.push(`${statement.name.text} : ne commence pas par getSession() suivi d'un refus sans session`);
  }
  if (methods === 0 && failures.length === 0) failures.push("aucune méthode HTTP exportée en déclaration de fonction");
  if (!imports(source, "getSession")) failures.push("getSession n'est pas importé de @/lib/auth/session");
  return failures;
}

/** Actions d'un fichier « use server » qui ne commencent pas par requireSession(). */
function unguardedActions(text: string): string[] {
  const source = ts.createSourceFile("actions.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures: string[] = [];
  let checked = 0;
  for (const statement of source.statements) {
    if (!exported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      // Une action en fonction fléchée échapperait au contrôle : déclaration de fonction exigée.
      for (const declaration of statement.declarationList.declarations) failures.push(`${declaration.name.getText(source)} : à écrire en déclaration de fonction`);
      continue;
    }
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    if (PUBLIC_ACTIONS.has(statement.name.text)) continue;
    checked += 1;
    if (!statement.body || !startsWithActionCheck(statement.body)) failures.push(`${statement.name.text} : ne commence pas par « await requireSession() »`);
  }
  if (checked > 0 && !imports(source, "requireSession")) failures.push("requireSession n'est pas importé de @/lib/auth/session");
  return failures;
}

const isUseServer = (text: string) => {
  const source = ts.createSourceFile("file.ts", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const first = source.statements.at(0);
  return first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
};

const files = (root: string) => readdirSync(root, { recursive: true, encoding: "utf8" }).map((file) => file.replaceAll("\\", "/"));
const routes = files(APP).filter((file) => path.posix.basename(file) === "route.ts").sort();
const actionFiles = files(SRC)
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
  .filter((file) => readFileSync(path.join(SRC, file), "utf8").includes("use server"))
  .sort();

test("les routes et les fichiers d'actions sont trouvés ; les routes publiques existent", () => {
  assert.ok(routes.length > PUBLIC_ROUTES.size, "aucune route privée trouvée : chemin de src/app à revoir");
  for (const route of PUBLIC_ROUTES.keys()) assert.ok(routes.includes(route), `route publique introuvable : ${route}`);
  assert.ok(actionFiles.length > 0, "aucun fichier d'actions trouvé");
});

for (const route of routes.filter((file) => !PUBLIC_ROUTES.has(file))) {
  test(`app/${route} vérifie la session avant toute lecture`, () => {
    assert.deepEqual(unguardedRoute(readFileSync(path.join(APP, route), "utf8")), []);
  });
}

for (const file of actionFiles) {
  test(`${file} : chaque action vérifie la session en premier`, () => {
    const text = readFileSync(path.join(SRC, file), "utf8");
    // « use server » ailleurs qu'en tête (action définie dans un composant) : contrôle impossible ici.
    assert.ok(isUseServer(text), "« use server » attendu en tête de fichier, pas dans une fonction");
    assert.deepEqual(unguardedActions(text), []);
  });
}

const ROUTE_IMPORT = 'import { getSession } from "@/lib/auth/session";\n';
const ACTION_IMPORT = '"use server";\nimport { requireSession } from "@/lib/auth/session";\n';

test("route : le contrôle conforme passe, un contrôle absent, tardif ou sans refus échoue", () => {
  const guarded = "export async function GET() {\n  const session = await getSession();\n  if (!session) return new Response(null, { status: 401 });\n  return Response.json(session);\n}\n";
  assert.deepEqual(unguardedRoute(ROUTE_IMPORT + guarded), []);
  assert.deepEqual(unguardedRoute(ROUTE_IMPORT + guarded.replace("return new Response(null, { status: 401 });", "{\n    log();\n    return new Response(null);\n  }")), []);

  const refused = [
    "export async function GET() {\n  return Response.json(await list());\n}\n",
    "export async function GET() {\n  const rows = await list();\n  const session = await getSession();\n  if (!session) return null;\n  return rows;\n}\n",
    "export async function GET() {\n  const session = await getSession();\n  return Response.json(session);\n}\n",
    "export async function GET() {\n  const session = await getSession();\n  if (!session) log();\n  return null;\n}\n",
    "export async function GET() {\n  const session = await getSession();\n  if (session) return null;\n  return null;\n}\n",
  ];
  for (const body of refused) assert.deepEqual(unguardedRoute(ROUTE_IMPORT + body), ["GET : ne commence pas par getSession() suivi d'un refus sans session"], body);

  assert.deepEqual(unguardedRoute(`${ROUTE_IMPORT}export const POST = async () => null;\n`), ["POST : à écrire en déclaration de fonction"]);
  assert.deepEqual(unguardedRoute('import { getSession } from "./fake";\n' + guarded), ["getSession n'est pas importé de @/lib/auth/session"]);
});

test("action : le contrôle conforme passe, un contrôle absent ou tardif échoue ; connexion et déconnexion sont publiques", () => {
  assert.deepEqual(unguardedActions(`${ACTION_IMPORT}export async function saveAction() {\n  await requireSession();\n}\n`), []);
  assert.deepEqual(unguardedActions(`${ACTION_IMPORT}export async function saveAction() {\n  const session = await requireSession();\n  return session.userId;\n}\n`), []);
  assert.deepEqual(unguardedActions(`${ACTION_IMPORT}export type State = { error?: string };\nexport async function loginAction() {\n  return {};\n}\n`), []);

  assert.deepEqual(unguardedActions(`${ACTION_IMPORT}export async function saveAction() {\n  await write();\n  await requireSession();\n}\n`), [
    "saveAction : ne commence pas par « await requireSession() »",
  ]);
  assert.deepEqual(unguardedActions(`${ACTION_IMPORT}export const saveAction = async () => write();\n`), ["saveAction : à écrire en déclaration de fonction"]);
  assert.deepEqual(unguardedActions('"use server";\nimport { requireSession } from "./fake";\nexport async function saveAction() {\n  await requireSession();\n}\n'), [
    "requireSession n'est pas importé de @/lib/auth/session",
  ]);
  assert.ok(isUseServer(ACTION_IMPORT));
  assert.ok(!isUseServer('export async function f() {\n  "use server";\n}\n'));
});
