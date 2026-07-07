/* eslint-disable react-refresh/only-export-components -- context file: provider + hooks live together */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type ProjectDoc = {
  _id: Id<"projects">;
  _creationTime: number;
  name: string;
  tag: string;
  numberingMode: "auto" | "manual";
  archived?: boolean;
};

type ProjectContextValue = {
  activeProjectId: Id<"projects"> | null;
  setActiveProjectId: (id: Id<"projects"> | null) => void;
  projects: ProjectDoc[] | undefined;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);
const STORAGE_KEY = "deceivers.activeProjectId";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const projects = useQuery(api.projects.list, {});
  const [activeProjectId, setState] = useState<Id<"projects"> | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as Id<"projects"> | null) || null;
  });

  const setActiveProjectId = (id: Id<"projects"> | null) => {
    setState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  };

  // If the selected project disappears (deleted/archived), fall back to "All".
  useEffect(() => {
    if (
      activeProjectId &&
      projects &&
      !projects.some((p) => p._id === activeProjectId)
    ) {
      setActiveProjectId(null);
    }
  }, [projects, activeProjectId]);

  return (
    <ProjectContext.Provider
      value={{ activeProjectId, setActiveProjectId, projects }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useActiveProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useActiveProject must be used within a ProjectProvider");
  }
  return ctx;
}

/**
 * The argument to spread into a project-scoped Convex query. Resolves to
 * `{ projectId }` when a project is active, or `{}` for "All projects".
 */
export function useProjectArg(): { projectId?: Id<"projects"> } {
  const { activeProjectId } = useActiveProject();
  return activeProjectId ? { projectId: activeProjectId } : {};
}
