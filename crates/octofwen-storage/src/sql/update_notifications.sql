create table if not exists shown_update_notifs (
  id integer primary key autoincrement,
  "update" text not null
);

create unique index if not exists update_idx on shown_update_notifs ("update");
