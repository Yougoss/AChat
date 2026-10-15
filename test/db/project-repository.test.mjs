import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createTestDatabase } from "./helpers.mjs";
import { createProjectRepository } from "../../src/server/db/repositories/project-repository.ts";

test("persists and retrieves registered project roots", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const repository = createProjectRepository(db);
  const input = { id: "project-1", name: "AChat", rootPath: process.cwd() };

  assert.deepEqual(repository.createProject(input), input);
  assert.deepEqual(repository.getProject("project-1"), input);
  assert.deepEqual(repository.listProjects(), [input]);
});

test("normalizes project roots and rejects paths that are missing or not directories", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const repository = createProjectRepository(db);

  const project = repository.createProject({
    id: "project-1",
    name: "AChat",
    rootPath: ".",
  });
  assert.equal(project.rootPath, path.resolve("."));
  assert.throws(
    () => repository.createProject({
      id: "missing",
      name: "Missing",
      rootPath: path.join(process.cwd(), "no-such-project-directory"),
    }),
    /exist|directory/i,
  );
  assert.throws(
    () => repository.createProject({
      id: "file",
      name: "File",
      rootPath: path.join(process.cwd(), "package.json"),
    }),
    /directory/i,
  );
});

test("rejects duplicate project roots", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const repository = createProjectRepository(db);
  const project = { id: "project-1", name: "AChat", rootPath: process.cwd() };

  repository.createProject(project);
  assert.throws(
    () => repository.createProject({ ...project, id: "project-2" }),
    /unique|constraint/i,
  );
});
