/** Shared between server/duplicateModels.ts and the Duplicate models tab. */

export type ModelStoreKind = 'Ollama' | 'Hugging Face' | 'LM Studio';

export interface DuplicateCopy {
  /** Opaque id the client sends back; the server never accepts a raw path. */
  id: string;
  path: string;
  store: ModelStoreKind;
  /** Model(s) this file belongs to, when the store can tell us. */
  modelName: string;
  sizeBytes: number;
  /** True only for plain files outside content-addressed stores. */
  trashable: boolean;
  /** Command to run instead when the file must not be deleted by hand. */
  command?: string;
  /** Why it can or cannot be moved to the Recycle Bin. */
  note: string;
}

export interface DuplicateGroup {
  id: string;
  /** 'identical' = same SHA-256; 'very likely identical' = same size + first/last 8 MB. */
  match: 'identical' | 'very likely identical';
  sizeBytes: number;
  formattedSize: string;
  /** Bytes freed by keeping exactly one copy. */
  savingsBytes: number;
  formattedSavings: string;
  copies: DuplicateCopy[];
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  totalSavingsBytes: number;
  formattedTotalSavings: string;
  filesChecked: number;
  scannedAt: string;
}
