"use client";

import Link from "next/link";
import type { Project } from "../server/domain/types.ts";

interface ProjectSelectorProps {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
  id?: string;
}

export function ProjectSelector({
  projects,
  value,
  onChange,
  id = "registered-project",
}: ProjectSelectorProps) {
  if (!projects.length) {
    return (
      <div className="field-label project-selector-empty">
        <span>Registered project</span>
        <p>No projects are registered yet.</p>
        <Link className="button button-quiet" href="/settings/projects">
          Register a project
        </Link>
      </div>
    );
  }

  return (
    <label className="field-label" htmlFor={id}>
      Registered project
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        required
      >
        <option value="">Choose a registered project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} — {project.rootPath}
          </option>
        ))}
      </select>
    </label>
  );
}
