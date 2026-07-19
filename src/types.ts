export type SearchMode = "smart" | "lexical" | "semantic";

export interface YapsPluginSettings {
  cliPath: string;
  captureFolder: string;
  searchMode: SearchMode;
  searchLimit: number;
  launchYapsBeforeDictation: boolean;
  showStatusBar: boolean;
}

export interface VaultStatus {
  index_initialized: boolean;
  note_count: number;
  root: string;
}

export interface VaultNote {
  aliases: string[];
  created_at: number;
  id: string;
  kind: string;
  markdown: string;
  path: string;
  pinned: boolean;
  source: string;
  tags: string[];
  title: string;
  updated_at: number;
}

export interface VaultNotesListResult {
  count: number;
  notes: VaultNote[];
}

export interface VaultNoteResult {
  note: VaultNote | null;
}

export interface VaultNoteMutationResult {
  changed_fields: string[];
  note: VaultNote;
}

export interface VaultSearchHit {
  note_id: string;
  path: string;
  score?: number;
  fused_score?: number;
  lexical_score?: number;
  semantic_score?: number;
  snippet: string;
  source?: string;
  title: string;
}

export interface VaultSearchResult {
  count: number;
  hits: VaultSearchHit[];
  mode?: string;
  fell_back?: boolean;
}

export interface ShortcutKey {
  id: string;
  keycode: number | null;
  label: string;
}

export interface ShortcutBindingResult {
  path: string;
  value: {
    keys: ShortcutKey[];
    kind: string;
  };
}
