import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Project } from "../../domain/types.ts";
import { asRecord } from "./repository-utils.ts";

interface ProjectRow {
  id: string;
  name: string;
  rootPath: string;
}

export function createProjectRepository(db: Database.Database) {
  function getProject(id: string): Project | undefined {
    const row = db.prepare(`
      SELECT id, name, root_path AS rootPath FROM projects WHERE id = ?
    `).get(id);
    return row ? { ...asRecord<ProjectRow>(row) } : undefined;
  }

  return {
    createProject(input: Project): Project {
      const absolutePath = path.resolve(input.rootPath);
      if (!existsSync(absolutePath)) {
        throw new Error(`Project root does not exist: ${absolutePath}`);
      }
      if (!statSync(absolutePath).isDirectory()) {
        throw new Error(`Project root must be a directory: ${absolutePath}`);
      }
      const project = { ...input, rootPath: realpathSync(absolutePath) };
      db.prepare(`
        INSERT INTO projects (id, name, root_path) VALUES (?, ?, ?)
      `).run(project.id, project.name, project.rootPath);
      return project;
    },
    getProject,
    listProjects(): Project[] {
      return db.prepare(`
        SELECT id, name, root_path AS rootPath FROM projects ORDER BY name, id
      `).all().map((row) => ({ ...asRecord<ProjectRow>(row) }));
    },
  };
}
