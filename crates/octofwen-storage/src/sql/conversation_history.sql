create table if not exists conversation_history (
  id integer primary key autoincrement,
  kind text not null,
  payload text
);
