-- Completion, rather than an SDK read or a staged delivery, authorizes reinforcement.
create table memory_task_completions (
  session_id text not null,
  request_id text not null,
  completed_at text not null,
  primary key(session_id,request_id),
  foreign key(session_id,request_id) references memory_task_requests(session_id,request_id) on delete cascade
) strict;

-- One durable outbox entry per node coalesces evidence, utility and recall updates.
create table memory_score_sync (
  node_id text primary key references memory_knowledge_scores(node_id) on delete cascade,
  revision text not null
) strict;

-- Only recorded completions with real, acknowledged receipts may be backfilled.
insert into memory_task_completions(session_id,request_id,completed_at)
select t.session_id,t.request_id,e.completed_at
from memory_task_requests t
join memory_episodes e on e.session_id=t.session_id and e.request_id=t.request_id;

insert into memory_score_sync(node_id,revision)
select node_id,lower(hex(randomblob(16))) from memory_knowledge_scores;
