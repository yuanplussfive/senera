import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";

export class AgentInteractionIdentitySqlStatements {
  readonly find;
  readonly create;
  readonly reference;
  readonly bind;
  readonly aliases;
  readonly adopt;
  readonly subject;
  readonly byId;
  readonly all;

  constructor(db: Database.Database) {
    this.all = db.prepare<Record<string, never>, { id: string; reference: string }>(
      agentSql`SELECT id,reference FROM interaction_principals ORDER BY rowid`,
    );
    this.find = db.prepare<
      { authority: string; account: string },
      { id: string; reference: string; kind: "user" | "agent" }
    >(agentSql`
      SELECT p.* FROM interaction_principals p JOIN interaction_identity_bindings b ON b.principal_id=p.id
      WHERE b.authority=@authority AND b.account=@account
    `);
    this.create = db.prepare(
      agentSql`INSERT INTO interaction_principals(id,reference,kind) VALUES(@id,@reference,@kind)`,
    );
    this.reference = db.prepare(agentSql`UPDATE interaction_principals SET reference=@reference WHERE id=@id`);
    this.bind = db.prepare(agentSql`
      INSERT INTO interaction_identity_bindings(authority,account,principal_id) VALUES(@authority,@account,@id)
    `);
    this.aliases = db.prepare<{ id: string }, { subject_id: string }>(agentSql`
      SELECT subject_id FROM interaction_legacy_subjects WHERE principal_id=@id ORDER BY subject_id
    `);
    this.adopt = db.prepare(agentSql`
      INSERT INTO interaction_legacy_subjects(subject_id,principal_id) VALUES(@subject,@id) ON CONFLICT DO NOTHING
    `);
    this.subject = db.prepare<{ subject: string }, { principal_id: string }>(agentSql`
      SELECT principal_id FROM interaction_legacy_subjects WHERE subject_id=@subject
    `);
    this.byId = db.prepare<{ id: string }, { id: string }>(
      agentSql`SELECT id FROM interaction_principals WHERE id=@id`,
    );
  }
}
