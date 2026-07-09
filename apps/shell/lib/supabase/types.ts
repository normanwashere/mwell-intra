import type { SupabaseClient } from '@supabase/supabase-js';

interface ShellRelationship {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}

interface ShellTable {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: ShellRelationship[];
}

type ShellView =
  | {
      Row: Record<string, unknown>;
      Insert: Record<string, unknown>;
      Update: Record<string, unknown>;
      Relationships: ShellRelationship[];
    }
  | {
      Row: Record<string, unknown>;
      Relationships: ShellRelationship[];
    };

interface ShellFunction {
  Args: Record<string, unknown>;
  Returns: unknown;
}

export interface ShellDatabase {
  [schema: string]: {
    Tables: Record<string, ShellTable>;
    Views: Record<string, ShellView>;
    Functions: Record<string, ShellFunction>;
  };
}

export type ShellSupabaseClient = SupabaseClient<ShellDatabase, string>;
