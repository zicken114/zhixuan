import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  loadProjects,
  saveProject,
  deleteProject as dbDeleteProject,
  loadTodos,
  saveTodo,
  deleteTodo as dbDeleteTodo
} from '../composables/useDatabase';
import { recordEvent } from '../composables/useEvents';

export type CitationStyle = 'apa' | 'ieee' | 'gb7714';

export interface Project {
  id: string;
  name: string;
  color: string;
  keywords: string[];
  folderPath?: string;
  zoteroCollection?: string;
  obsidianVault?: string;
  citationStyle?: CitationStyle;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectTodo {
  id?: number;
  projectId: string;
  content: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed';
  createdAt: number;
  completedAt?: number;
}

export const PROJECT_COLORS = [
  '#3d74e7', // blue
  '#00b8a3', // teal
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#10b981', // emerald
  '#6366f1', // indigo
];

export const useProjectStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const currentProjectId = ref<string | null>(null);
  const todos = ref<ProjectTodo[]>([]);

  /** Load projects from SQLite on app start. */
  const init = async () => {
    try {
      projects.value = await loadProjects();
      if (projects.value.length > 0 && !currentProjectId.value) {
        currentProjectId.value = projects.value[0].id;
      }
      if (currentProjectId.value) {
        await loadProjectTodos(currentProjectId.value);
      }
    } catch (e) {
      console.error('Failed to load projects from DB:', e);
    }
  };

  /** Get current project. */
  const currentProject = (): Project | null => {
    if (!currentProjectId.value) return null;
    return projects.value.find(p => p.id === currentProjectId.value) || null;
  };

  /** Switch active project. */
  const switchProject = async (projectId: string | null) => {
    const fromId = currentProjectId.value;
    currentProjectId.value = projectId;
    if (projectId) {
      await loadProjectTodos(projectId);
    } else {
      todos.value = [];
    }
    if (fromId !== projectId) {
      recordEvent({
        event_type: 'project_switch',
        metadata: { from: fromId, to: projectId }
      });
    }
  };

  /** Create a new project. */
  const createProject = async (name: string, color?: string): Promise<Project> => {
    const now = Date.now();
    const project: Project = {
      id: `proj_${now}`,
      name,
      color: color || PROJECT_COLORS[0],
      keywords: [],
      createdAt: now,
      updatedAt: now
    };
    projects.value.unshift(project);
    await saveProject(project);
    currentProjectId.value = project.id;
    todos.value = [];
    recordEvent({ event_type: 'project_create', resource_id: project.id, metadata: { name } });
    return project;
  };

  /** Update project. */
  const updateProject = async (project: Project) => {
    project.updatedAt = Date.now();
    const idx = projects.value.findIndex(p => p.id === project.id);
    if (idx !== -1) {
      projects.value[idx] = project;
    }
    await saveProject(project);
  };

  /** Delete project. */
  const deleteProject = async (id: string) => {
    const idx = projects.value.findIndex(p => p.id === id);
    if (idx !== -1) {
      projects.value.splice(idx, 1);
    }
    await dbDeleteProject(id);
    if (currentProjectId.value === id) {
      currentProjectId.value = projects.value[0]?.id || null;
      if (currentProjectId.value) {
        await loadProjectTodos(currentProjectId.value);
      } else {
        todos.value = [];
      }
    }
  };

  /** Load todos for a project. */
  const loadProjectTodos = async (projectId: string) => {
    try {
      todos.value = await loadTodos(projectId);
    } catch (e) {
      console.error('Failed to load todos:', e);
      todos.value = [];
    }
  };

  /** Add a todo. */
  const addTodo = async (content: string, priority: 'low' | 'medium' | 'high' = 'medium') => {
    const projectId = currentProjectId.value;
    if (!projectId) return;
    const todo: ProjectTodo = {
      projectId,
      content,
      priority,
      status: 'pending',
      createdAt: Date.now()
    };
    await saveTodo(todo);
    await loadProjectTodos(projectId);
  };

  /** Toggle todo status. */
  const toggleTodo = async (todo: ProjectTodo) => {
    if (todo.status === 'pending') {
      todo.status = 'completed';
      todo.completedAt = Date.now();
      recordEvent({ event_type: 'todo_complete', resource_id: String(todo.id) });
    } else {
      todo.status = 'pending';
      todo.completedAt = undefined;
    }
    await saveTodo(todo);
    if (currentProjectId.value) {
      await loadProjectTodos(currentProjectId.value);
    }
  };

  /** Delete a todo. */
  const deleteTodo = async (id: number) => {
    await dbDeleteTodo(id);
    if (currentProjectId.value) {
      await loadProjectTodos(currentProjectId.value);
    }
  };

  return {
    projects,
    currentProjectId,
    todos,
    init,
    currentProject,
    switchProject,
    createProject,
    updateProject,
    deleteProject,
    loadProjectTodos,
    addTodo,
    toggleTodo,
    deleteTodo
  };
});
