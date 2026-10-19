export type ID = string;

export type EdgeType = 'parent' | 'partner' | 'other';

export interface FileItem {
  id: ID;
  name: string;
  type: string; // MIME type from the allow-list
  size: number;
}

export interface Person {
  id: ID;
  name: string;
  nickname: string;
  born: string; // free text so "c. 1890" or "1890s" work
  died: string;
  place: string;
  notes: string; // plain text only; never rendered as HTML
  photoId: ID | null;
  placeholder: boolean; // auto-created stand-in ("Unknown") until the user edits it
  files: FileItem[];
  /** Hand-dragged shift from where the automatic layout puts this person (pixels). Absent = not moved. */
  dx?: number;
  dy?: number;
}

/** parent: from = parent, to = child. partner / other are symmetric. */
export interface Edge {
  id: ID;
  type: EdgeType;
  from: ID;
  to: ID;
  label: string;
}

export interface Source {
  id: ID;
  url: string;
  title: string;
  excerpt: string;
  personIds: ID[];
  addedAt: string;
}

export interface Tree {
  version: 1;
  people: Record<ID, Person>;
  edges: Edge[];
  sources: Source[];
  meId: ID | null;
  counter: number; // numbering for "Person N"
  updatedAt: string;
}

export interface Graph {
  people: Record<ID, Person>;
  edges: Edge[];
}

export const LIMITS = {
  name: 120,
  short: 160,
  notes: 20000,
  url: 2000,
  excerpt: 8000,
  fileBytes: 10 * 1024 * 1024,
  maxPeople: 2000,
} as const;
