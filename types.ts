export type Note = {
  id: string;
  name: string;
  content: string;
  modifiedAt: number;
  createdAt: number;
  folder?: string | null;
  pinned?: boolean;
  tags?: string[];
};

export type Folder = {
  path: string;
  parent: string | null;
  name: string;
  [key: string]: any;
};
