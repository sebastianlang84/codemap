create virtual table if not exists chunks_fts using fts5(path, language, kind, text, content='', contentless_delete=1);
create virtual table if not exists symbols_fts using fts5(path, name, kind, signature, content='', contentless_delete=1);
