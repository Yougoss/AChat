import { WorkspaceShell } from "../components/WorkspaceShell.tsx";

export default function HomePage() {
  return (
    <WorkspaceShell>
      <main className="empty-workspace" aria-labelledby="workspace-start-title">
        <p className="eyebrow">Local POC · dispatch workbench</p>
        <h1 id="workspace-start-title">Start with a local project root.</h1>
        <p>
          Register an existing project root, sign in to GitHub Copilot using Pi&apos;s
          shared login from contact settings, then create the contacts for your task.
        </p>
        <p>
          Each task uses the selected project&apos;s shared root; <code>cwd</code> is not
          a filesystem sandbox. AChat does not create worktrees or copy the workspace.
        </p>
        <p>
          Closing the browser disconnects live updates but does not stop Pi execution.
          The local Node service owns task execution.
        </p>
      </main>
    </WorkspaceShell>
  );
}
