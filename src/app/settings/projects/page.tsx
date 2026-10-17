"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { WorkspaceShell } from "../../../components/WorkspaceShell.tsx";
import type { Project } from "../../../server/domain/types.ts";

export default function ProjectsSettingsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/projects").then(async (response) => {
      const result = await response.json() as { projects?: Project[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to load registered projects");
      if (active) setProjects(result.projects ?? []);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load registered projects");
    });
    return () => {
      active = false;
    };
  }, []);

  async function registerProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rootPath }),
      });
      const result = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !result.project) {
        throw new Error(result.error ?? "Unable to register project root");
      }
      setProjects((current) => [...current, result.project!].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setRootPath("");
      setNotice("Project root registered and ready for new tasks.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to register project root");
    }
  }

  return (
    <WorkspaceShell>
      <main className="settings-page settings-projects-page">
        <header className="page-heading">
          <p className="eyebrow">Workspace registry</p>
          <h1>Registered projects</h1>
          <p>Tasks can only use existing project roots listed here.</p>
        </header>
        <section className="settings-card" aria-labelledby="project-registration-title">
          <h2 id="project-registration-title">Register an existing root</h2>
          <form className="stacked-form" onSubmit={(event) => void registerProject(event)}>
            <label className="field-label" htmlFor="project-name">
              Project name
              <input id="project-name" value={name} onChange={(event) => setName(event.currentTarget.value)} required />
            </label>
            <label className="field-label" htmlFor="project-root">
              Existing directory path
              <input
                id="project-root"
                value={rootPath}
                onChange={(event) => setRootPath(event.currentTarget.value)}
                placeholder="/workspace/project"
                required
              />
            </label>
            <p className="form-hint">AChat validates the path and records its canonical directory. Registration does not create a folder or worktree.</p>
            <button className="button button-primary" type="submit">Register project</button>
          </form>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {notice ? <p className="form-success" role="status">{notice}</p> : null}
        </section>
        <section className="project-list" aria-labelledby="registered-roots-title">
          <h2 id="registered-roots-title">Available roots</h2>
          {projects.length ? projects.map((project) => (
            <article className="project-card" key={project.id}>
              <div>
                <h3>{project.name}</h3>
                <p className="evidence-meta">{project.rootPath}</p>
              </div>
              <span className="project-status">Registered</span>
            </article>
          )) : <p className="empty-evidence">No project roots registered.</p>}
        </section>
      </main>
    </WorkspaceShell>
  );
}
