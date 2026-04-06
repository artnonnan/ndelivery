import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------
interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  stage: string;
  categoryId: string;
  priority: "low" | "medium" | "high";
  assignee?: string;
  linkedDocFileId?: string;
  createdAt: string;
  updatedAt: string;
}

interface DesignDoc {
  content: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  categories: Category[];
  stages: string[];
  tasks: Task[];
  designDoc: DesignDoc;
}

interface DB {
  projects: Project[];
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "../../data/projects.json");

function readDB(): DB {
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  return JSON.parse(raw) as DB;
}

function writeDB(db: DB): void {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function now(): string {
  return new Date().toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "gameplan",
  version: "1.0.0",
});

// create_project — disabled
// delete_project — disabled

// ── list_projects ────────────────────────────────────────────────────────────
server.tool(
  "list_projects",
  "List all projects",
  {},
  async () => {
    const db = readDB();
    const list = db.projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      taskCount: p.tasks.length,
      createdAt: p.createdAt,
    }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

// ── get_project ──────────────────────────────────────────────────────────────
server.tool(
  "get_project",
  "Get a project by ID (includes categories, stages, task summary)",
  { project_id: z.string().describe("Project ID") },
  async ({ project_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    const summary = {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      stages: project.stages,
      categories: project.categories,
      tasksByStage: project.stages.reduce<Record<string, number>>((acc, s) => {
        acc[s] = project.tasks.filter((t) => t.stage === s).length;
        return acc;
      }, {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// ── list_tasks ───────────────────────────────────────────────────────────────
server.tool(
  "list_tasks",
  "List tasks for a project, optionally filtered by stage or category",
  {
    project_id: z.string().describe("Project ID"),
    stage: z.string().optional().describe("Filter by stage name (e.g. 'Backlog')"),
    category_id: z.string().optional().describe("Filter by category ID"),
  },
  async ({ project_id, stage, category_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    let tasks = project.tasks;
    if (stage) tasks = tasks.filter((t) => t.stage === stage);
    if (category_id) tasks = tasks.filter((t) => t.categoryId === category_id);

    // Enrich with category name
    const enriched = tasks.map((t) => {
      const cat = project.categories.find((c) => c.id === t.categoryId);
      return { ...t, categoryName: cat?.name ?? "Unknown" };
    });

    return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
  }
);

// ── get_task ─────────────────────────────────────────────────────────────────
server.tool(
  "get_task",
  "Get a single task by ID",
  {
    project_id: z.string().describe("Project ID"),
    task_id: z.string().describe("Task ID"),
  },
  async ({ project_id, task_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    const task = project.tasks.find((t) => t.id === task_id);
    if (!task) return { content: [{ type: "text", text: `Task "${task_id}" not found.` }] };

    const cat = project.categories.find((c) => c.id === task.categoryId);
    return { content: [{ type: "text", text: JSON.stringify({ ...task, categoryName: cat?.name }, null, 2) }] };
  }
);

// ── create_task ───────────────────────────────────────────────────────────────
server.tool(
  "create_task",
  "Create a new task in a project",
  {
    project_id: z.string().describe("Project ID"),
    title: z.string().describe("Task title"),
    description: z.string().optional().describe("Task description (supports markdown)"),
    stage: z.string().optional().describe("Stage name (default: first stage)"),
    category_id: z.string().optional().describe("Category ID"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority (default: medium)"),
    assignee: z.string().optional().describe("Assignee name or username"),
    linked_doc_file_id: z.string().optional().describe("Design doc file ID to link to this task"),
  },
  async ({ project_id, title, description, stage, category_id, priority, assignee, linked_doc_file_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    const resolvedStage = stage ?? project.stages[0] ?? "Backlog";
    if (!project.stages.includes(resolvedStage)) {
      return { content: [{ type: "text", text: `Stage "${resolvedStage}" does not exist. Available: ${project.stages.join(", ")}` }] };
    }

    const task: Task = {
      id: generateId("task"),
      title,
      description: description ?? "",
      stage: resolvedStage,
      categoryId: category_id ?? (project.categories[0]?.id ?? ""),
      priority: priority ?? "medium",
      ...(assignee ? { assignee } : {}),
      ...(linked_doc_file_id ? { linkedDocFileId: linked_doc_file_id } : {}),
      createdAt: now(),
      updatedAt: now(),
    };

    project.tasks.push(task);
    writeDB(db);

    return { content: [{ type: "text", text: `Task created:\n${JSON.stringify(task, null, 2)}` }] };
  }
);

// ── update_task ───────────────────────────────────────────────────────────────
server.tool(
  "update_task",
  "Update a task's fields (title, description, stage, category, priority, assignee, linked doc)",
  {
    project_id: z.string().describe("Project ID"),
    task_id: z.string().describe("Task ID"),
    title: z.string().optional(),
    description: z.string().optional().describe("Task description (supports markdown)"),
    stage: z.string().optional().describe("New stage name"),
    category_id: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assignee: z.string().optional().describe("Assignee name or username (pass empty string to clear)"),
    linked_doc_file_id: z.string().optional().describe("Design doc file ID to link (pass empty string to clear)"),
  },
  async ({ project_id, task_id, title, description, stage, category_id, priority, assignee, linked_doc_file_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    const task = project.tasks.find((t) => t.id === task_id);
    if (!task) return { content: [{ type: "text", text: `Task "${task_id}" not found.` }] };

    if (stage && !project.stages.includes(stage)) {
      return { content: [{ type: "text", text: `Stage "${stage}" does not exist. Available: ${project.stages.join(", ")}` }] };
    }

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (stage !== undefined) task.stage = stage;
    if (category_id !== undefined) task.categoryId = category_id;
    if (priority !== undefined) task.priority = priority;
    if (assignee !== undefined) task.assignee = assignee || undefined;
    if (linked_doc_file_id !== undefined) task.linkedDocFileId = linked_doc_file_id || undefined;
    task.updatedAt = now();

    writeDB(db);
    return { content: [{ type: "text", text: `Task updated:\n${JSON.stringify(task, null, 2)}` }] };
  }
);

// ── delete_task ───────────────────────────────────────────────────────────────
server.tool(
  "delete_task",
  "Delete a task from a project",
  {
    project_id: z.string().describe("Project ID"),
    task_id: z.string().describe("Task ID"),
  },
  async ({ project_id, task_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    const idx = project.tasks.findIndex((t) => t.id === task_id);
    if (idx === -1) return { content: [{ type: "text", text: `Task "${task_id}" not found.` }] };

    project.tasks.splice(idx, 1);
    writeDB(db);
    return { content: [{ type: "text", text: `Task "${task_id}" deleted.` }] };
  }
);

// ── list_categories ───────────────────────────────────────────────────────────
server.tool(
  "list_categories",
  "List all categories/disciplines for a project",
  { project_id: z.string().describe("Project ID") },
  async ({ project_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    return { content: [{ type: "text", text: JSON.stringify(project.categories, null, 2) }] };
  }
);

// ── get_design_doc ────────────────────────────────────────────────────────────
server.tool(
  "get_design_doc",
  "Get the design document (markdown) for a project",
  { project_id: z.string().describe("Project ID") },
  async ({ project_id }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    return { content: [{ type: "text", text: project.designDoc.content }] };
  }
);

// ── update_design_doc ─────────────────────────────────────────────────────────
server.tool(
  "update_design_doc",
  "Replace the design document content for a project",
  {
    project_id: z.string().describe("Project ID"),
    content: z.string().describe("New markdown content for the design document"),
  },
  async ({ project_id, content }) => {
    const db = readDB();
    const project = db.projects.find((p) => p.id === project_id);
    if (!project) return { content: [{ type: "text", text: `Project "${project_id}" not found.` }] };

    project.designDoc.content = content;
    writeDB(db);
    return { content: [{ type: "text", text: "Design document updated." }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
