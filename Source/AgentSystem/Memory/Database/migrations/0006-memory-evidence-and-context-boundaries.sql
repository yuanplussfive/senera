create table memory_task_requests (
  session_id text not null,
  request_id text not null,
  task_id text not null,
  subject_id text not null,
  actor_kind text not null check(actor_kind in ('user','agent','unknown')),
  started_at text not null,
  primary key(session_id, request_id)
) strict;
create index memory_task_requests_task on memory_task_requests(task_id);
create index memory_task_requests_subject on memory_task_requests(session_id,subject_id);

create table memory_knowledge_scores (
  node_id text primary key,
  origin_key text,
  importance real not null default 50 check(importance between 0 and 100)
) strict;
create table memory_knowledge_evidence (
  node_id text not null references memory_knowledge_scores(node_id) on delete cascade,
  evidence_key text not null,
  polarity integer not null check(polarity in (-1,0,1)),
  primary key(node_id, evidence_key)
) strict;
create table memory_knowledge_evidence_sources (
  node_id text not null,
  evidence_key text not null,
  source_uri text not null,
  session_id text not null,
  request_id text not null,
  quote text not null,
  primary key(node_id, evidence_key, source_uri),
  foreign key(node_id, evidence_key) references memory_knowledge_evidence(node_id, evidence_key) on delete cascade
) strict;
create index memory_knowledge_evidence_sources_request on memory_knowledge_evidence_sources(session_id,request_id);
create index memory_knowledge_evidence_sources_uri on memory_knowledge_evidence_sources(source_uri);

create table memory_recall_receipts (
  session_id text not null,
  request_id text not null,
  task_id text not null,
  node_id text not null,
  revision text not null,
  summary text not null,
  delivery text not null check(delivery in ('snapshot','task','explicit')),
  delivered integer not null default 0 check(delivered in (0,1)),
  primary key(session_id, request_id, node_id, revision, delivery),
  foreign key(session_id,request_id) references memory_task_requests(session_id,request_id) on delete cascade
) strict;
create index memory_recall_receipts_node on memory_recall_receipts(node_id,task_id);

create table memory_utility_settlements (
  session_id text not null,
  request_id text not null,
  task_id text not null,
  node_id text not null,
  outcome integer not null check(outcome in (-1,1)),
  primary key(session_id,request_id,node_id),
  foreign key(session_id,request_id) references memory_task_requests(session_id,request_id) on delete cascade
) strict;
create index memory_utility_settlements_node on memory_utility_settlements(node_id,task_id);

create table continuity_memory_boundaries (
  session_id text primary key,
  generation integer not null default 0 check(generation >= 0),
  boundary_key text not null,
  subject_id text not null default 'owner'
) strict;
create table continuity_memory_snapshot_versions (
  session_id text not null,
  generation integer not null,
  entries_json text not null check(json_valid(entries_json)),
  created_at text not null,
  primary key(session_id,generation)
) strict;
-- Old snapshots lack subject attribution and score provenance. Rebuild their
-- derived projection at the next prompt boundary; semantic/source data stays.
drop table continuity_memory_snapshots;
