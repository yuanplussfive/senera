import type Database from "better-sqlite3";

export interface AgentWorkspaceObserverSqlStatements {
  readonly selectFile: Database.Statement<[string]>;
  readonly listSubtree: Database.Statement<[string, string]>;
  readonly insertFile: Database.Statement;
  readonly deleteFile: Database.Statement<[string]>;
  readonly deleteSubtree: Database.Statement<[string, string]>;
  readonly deleteOtherScanGenerations: Database.Statement<[string]>;
}

export function prepareAgentWorkspaceObserverSqlStatements(db: Database.Database): AgentWorkspaceObserverSqlStatements {
  return {
    selectFile: db.prepare(`
      SELECT
        path_key,
        path,
        kind,
        size,
        mtime_ms,
        hash,
        content_state,
        content_reason,
        content_ref,
        content_byte_length,
        line_count,
        scan_generation
      FROM workspace_observer_files
      WHERE path_key = ?
    `),
    listSubtree: db.prepare(`
      SELECT
        path_key,
        path,
        kind,
        size,
        mtime_ms,
        hash,
        content_state,
        content_reason,
        content_ref,
        content_byte_length,
        line_count,
        scan_generation
      FROM workspace_observer_files
      WHERE path_key = ? OR path_key LIKE ? ESCAPE '\\'
      ORDER BY path_key
    `),
    insertFile: db.prepare(`
      INSERT INTO workspace_observer_files
        (
          path_key,
          path,
          kind,
          size,
          mtime_ms,
          hash,
          content_state,
          content_reason,
          content_ref,
          content_byte_length,
          line_count,
          scan_generation
        )
      VALUES
        (
          @path_key,
          @path,
          @kind,
          @size,
          @mtime_ms,
          @hash,
          @content_state,
          @content_reason,
          @content_ref,
          @content_byte_length,
          @line_count,
          @scan_generation
        )
      ON CONFLICT(path_key)
      DO UPDATE SET
        path = excluded.path,
        kind = excluded.kind,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        hash = excluded.hash,
        content_state = excluded.content_state,
        content_reason = excluded.content_reason,
        content_ref = excluded.content_ref,
        content_byte_length = excluded.content_byte_length,
        line_count = excluded.line_count,
        scan_generation = CASE
          WHEN excluded.scan_generation = '' THEN workspace_observer_files.scan_generation
          ELSE excluded.scan_generation
        END
    `),
    deleteFile: db.prepare(`DELETE FROM workspace_observer_files WHERE path_key = ?`),
    deleteSubtree: db.prepare(`
      DELETE FROM workspace_observer_files
      WHERE path_key = ? OR path_key LIKE ? ESCAPE '\\'
    `),
    deleteOtherScanGenerations: db.prepare(`
      DELETE FROM workspace_observer_files
      WHERE scan_generation <> ?
    `),
  };
}
