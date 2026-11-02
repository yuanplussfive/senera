-- Retire derived evidence scores, retaining original episodes, sources and knowledge.
drop table memory_knowledge_evidence_sources;
drop table memory_knowledge_evidence;
alter table memory_knowledge_scores drop column origin_key;
alter table memory_knowledge_scores drop column importance;

alter table memory_utility_settlements rename to memory_utility_settlements_v1;
drop index memory_utility_settlements_node;
create table memory_utility_settlements (
  session_id text not null,
  request_id text not null,
  task_id text not null,
  node_id text not null,
  outcome text not null check(outcome in ('helpful','unhelpful','unused','uncertain')),
  reason text not null check(length(trim(reason)) > 0),
  contract_version integer not null check(contract_version > 0),
  primary key(session_id,request_id,node_id),
  foreign key(session_id,request_id) references memory_task_requests(session_id,request_id) on delete cascade
) strict;
create index memory_utility_settlements_node on memory_utility_settlements(node_id,task_id);
-- Preserve old evaluations for audit, outside the current scoring contract.
insert into memory_utility_settlements
select session_id,request_id,task_id,node_id,
  case outcome when 1 then 'helpful' else 'unhelpful' end,
  'Archived assessment from the retired evidence contract',1
from memory_utility_settlements_v1;
drop table memory_utility_settlements_v1;

-- Rebuild current derived context once; historical snapshots remain immutable.
update continuity_memory_boundaries set generation=generation+1;
-- Restore neutral SDK trust. Only the host applies task utility to ranking.
insert into memory_score_sync(node_id,revision)
select node_id,lower(hex(randomblob(16))) from memory_knowledge_scores where true
on conflict(node_id) do update set revision=excluded.revision;
