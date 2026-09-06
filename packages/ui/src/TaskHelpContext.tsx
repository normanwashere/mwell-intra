"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface TaskHelpRequest {
  articleId: string;
  title?: string;
  taskId?: string;
  stepId?: string;
}

export interface TaskHelpController {
  openHelp(request: TaskHelpRequest, launcher?: HTMLElement): void;
  closeHelp(): void;
}

const TaskHelpContext = createContext<TaskHelpController | null>(null);

export function TaskHelpProvider({ controller, children }: { controller: TaskHelpController; children: ReactNode }) {
  return <TaskHelpContext.Provider value={controller}>{children}</TaskHelpContext.Provider>;
}

export function useTaskHelp() {
  return useContext(TaskHelpContext);
}
