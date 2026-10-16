"use client";

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
