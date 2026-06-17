-- 用户查询脚本（Navicat / sqlite3 CLI 直接执行）
-- 用法：按需取消注释对应段落，或替换 :account / :keyword 占位。

-- 全部用户一览（含余额、卡槽、注册时间可读化）
SELECT
  account,
  username,
  password,                                   -- 明文，人工维护用
  datetime(created_at / 1000, 'unixepoch', 'localtime') AS registered,
  catfood,
  spent_total,
  earned_total,
  slot_max
FROM users
ORDER BY created_at DESC;

-- 按账号或用户名模糊查找单个用户（把 KEYWORD 换成关键词）
-- SELECT * FROM users
-- WHERE account LIKE '%KEYWORD%' OR username LIKE '%KEYWORD%';

-- 某用户的共享角色统计（共享角色数 / 下载 / 好评 / 差评）
-- SELECT
--   COUNT(*)            AS shared_count,
--   COALESCE(SUM(downloads),0) AS total_downloads,
--   COALESCE(SUM(likes),0)     AS total_likes,
--   COALESCE(SUM(dislikes),0)  AS total_dislikes
-- FROM shared_characters
-- WHERE owner = 'ACCOUNT_GUID';

-- 人工充值猫粮（谨慎；明文人工维护）
-- UPDATE users SET catfood = catfood + 100 WHERE account = 'ACCOUNT_GUID';

-- 人工扩容卡槽上限
-- UPDATE users SET slot_max = slot_max + 5 WHERE account = 'ACCOUNT_GUID';
