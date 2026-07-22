import { KNOWLEDGE_CONTENT } from "./content";
import { COMING_SOON_ROLES } from "./roles";
import type { KnowledgeContent } from "./types";

export const KNOWLEDGE_GUIDE_CONTENT: KnowledgeContent = {
  ...KNOWLEDGE_CONTENT,
  roles: [...KNOWLEDGE_CONTENT.roles, ...COMING_SOON_ROLES],
};
