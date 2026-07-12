create table if not exists conversation_history (
  id integer primary key autoincrement,
  kind text not null,
  payload text
);


create table if not exists conversation_session (
  singleton integer primary key check (singleton = 1),
  session_id text not null unique,
  cwd text not null,
  launch_json text not null,
  created_at integer not null,
  updated_at integer not null
);

create table if not exists conversation_revision (
  id integer primary key autoincrement,
  parent_id integer references conversation_revision(id),
  created_at integer not null
);

create table if not exists conversation_revision_record (
  revision_id integer not null references conversation_revision(id) on delete cascade,
  position integer not null,
  kind text not null,
  payload text,
  primary key (revision_id, position)
);

create index if not exists conversation_revision_parent_idx
  on conversation_revision(parent_id);
