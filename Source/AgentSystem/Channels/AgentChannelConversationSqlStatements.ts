import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";
import type { AgentChannelConversationTaskStatus } from "./AgentChannelConversation.js";

export interface AgentChannelConversationTaskRow {
  id: string;
  title: string;
  status: AgentChannelConversationTaskStatus;
  owner_id: string;
  participant_ids: string;
  next_action: string | null;
  wake_at: string | null;
  created_sequence: number;
  updated_sequence: number;
  revision: number;
}

export class AgentChannelConversationSqlStatements {
  readonly list;
  readonly get;
  readonly event;
  readonly association;
  readonly create;
  readonly update;
  readonly associate;
  readonly decision;
  readonly commit;
  readonly evaluated;
  readonly evaluate;
  readonly stop;

  constructor(db: Database.Database) {
    this.list = db.prepare<{ sessionId: string }, AgentChannelConversationTaskRow>(agentSql`
      SELECT * FROM channel_conversation_tasks WHERE session_id=@sessionId AND status IN ('pending','active','waiting')
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,created_sequence,id
    `);
    this.get = db.prepare<{ sessionId: string; id: string }, AgentChannelConversationTaskRow>(agentSql`
      SELECT * FROM channel_conversation_tasks WHERE session_id=@sessionId AND id=@id
    `);
    this.event = db.prepare<{ sessionId: string; sequence: number }, { payload: string }>(agentSql`
      SELECT e.payload FROM channel_events e JOIN channel_participants p ON p.conversation=e.conversation
      WHERE p.session_id=@sessionId AND e.sequence=@sequence AND e.sequence<=p.cursor
    `);
    this.association = db.prepare<
      { sessionId: string; sequence: number },
      { task_id: string | null; disposition: string }
    >(agentSql`
      SELECT task_id,disposition FROM channel_conversation_dispositions WHERE session_id=@sessionId AND sequence=@sequence
    `);
    this.create = db.prepare(agentSql`
      INSERT INTO channel_conversation_tasks(id,session_id,title,status,owner_id,participant_ids,next_action,wake_at,
        created_sequence,updated_sequence,revision,created_by)
      VALUES(@id,@sessionId,@title,@status,@ownerId,@participants,@nextAction,@wakeAt,@createdSequence,@updatedSequence,1,@callId)
    `);
    this.update = db.prepare(agentSql`
      UPDATE channel_conversation_tasks SET title=@title,status=@status,participant_ids=@participants,
        next_action=@nextAction,wake_at=@wakeAt,updated_sequence=@updatedSequence,revision=revision+1
      WHERE session_id=@sessionId AND id=@id AND revision=@revision
    `);
    this.associate = db.prepare(agentSql`
      INSERT INTO channel_conversation_dispositions(session_id,sequence,task_id,disposition)
      VALUES(@sessionId,@sequence,@taskId,@relation)
      ON CONFLICT(session_id,sequence) DO UPDATE SET task_id=excluded.task_id,disposition=excluded.disposition
    `);
    this.decision = db.prepare<{ sessionId: string; callId: string }, { result: string }>(agentSql`
      SELECT result FROM channel_conversation_decisions WHERE session_id=@sessionId AND call_id=@callId
    `);
    this.commit = db.prepare(agentSql`
      INSERT INTO channel_conversation_decisions(session_id,call_id,result) VALUES(@sessionId,@callId,@result)
    `);
    this.evaluated = db.prepare<{ taskId: string; revision: number }, { request_id: string }>(agentSql`
      SELECT request_id FROM channel_task_evaluations WHERE task_id=@taskId AND revision=@revision
    `);
    this.evaluate = db.prepare(agentSql`
      INSERT INTO channel_task_evaluations(task_id,revision,request_id) VALUES(@taskId,@revision,@requestId) ON CONFLICT DO NOTHING
    `);
    this.stop = db.prepare(agentSql`
      UPDATE channel_conversation_tasks SET status='cancelled',wake_at=NULL,revision=revision+1
      WHERE session_id=@sessionId AND status IN ('active','waiting')
    `);
  }
}
