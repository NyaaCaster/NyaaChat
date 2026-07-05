-- 共享角色 插 / 删 / 查 维护脚本
--
-- 重要：共享角色全局 id（global_id）一经分配，删除后也不复用、不变化。
-- 通过数据库删除共享角色时，仅删该行；不要回收或重排 global_id。

-- 共享角色一览（按更新时间倒序，时间可读化）
SELECT
  global_id,
  name,
  author,
  owner,
  source,
  downloads, likes, dislikes,
  datetime(updated_at / 1000, 'unixepoch', 'localtime') AS updated,
  json_extract(tags, '$') AS tags
FROM shared_characters
ORDER BY updated_at DESC;

-- 全部去重标签清单（前端标签筛选数据源；验证 json_each 可行性）
-- SELECT DISTINCT je.value AS tag
-- FROM shared_characters sc, json_each(sc.tags) je
-- ORDER BY tag;

-- 手动删除一张共享角色（封面文件需另行从 covers 目录删除同名文件）
-- DELETE FROM shared_characters WHERE global_id = 'GLOBAL_ID';

-- 手动插入示例（一般由后端写入；此处仅供人工补录参考）
-- INSERT INTO shared_characters
--   (global_id, owner, author, name, source, intro, tags,
--    use_price, buyout_price, card_json, cover_ext,
--    downloads, likes, dislikes, created_at, updated_at)
-- VALUES
--   ('GLOBAL_ID', 'OWNER_ACCOUNT', 'AuthorName', 'CharName', 'original', '简介',
--    '["tag1","tag2"]', 0, 0, '{}', 'webp',
--    0, 0, 0, strftime('%s','now')*1000, strftime('%s','now')*1000);
