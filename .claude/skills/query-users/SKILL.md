# query-users

查询 NyaaChat 共享后端 SQLite 数据库中的用户账号信息。跨平台（Windows/Linux/macOS），
仅依赖 Python 3 标准库。

## 触发条件

当用户提出以下意图时调用此 skill：

- "查询用户"、"查看用户"、"活跃用户"、"用户活跃时间"
- "看看谁在线"、"查一下账号数据"、"数据库里有哪些用户"
- 任何与 NyaaChat 账号数据库（users 表）相关的查询

## 执行方式

运行项目根目录下的 Python 查询脚本：

```
python scripts/query-users.py
```

### 可选参数

| 参数 | 作用 | 示例 |
|------|------|------|
| `--account` / `-a` | 精确匹配某个账号 | `--account nyaa` |
| `--username` / `-u` | 用户名模糊搜索（LIKE `%xxx%`，大小写不敏感） | `--username alex` |
| `--active-only` / `-A` | 只显示 `last_active > 0`（有过活跃记录）的用户 | `--active-only` |
| `--db-path` / `-d` | 覆盖默认数据库路径 | `--db-path /path/to/db` |

### 示例

```bash
# 全部用户
python scripts/query-users.py

# 只看有活跃记录的用户
python scripts/query-users.py --active-only

# 查特定账号
python scripts/query-users.py --account nyaa

# 按用户名模糊搜索（支持中英文）
python scripts/query-users.py --username alex
python scripts/query-users.py -u 吃货

# 指定数据库路径（Linux 等非默认路径时）
python scripts/query-users.py --db-path /home/nyaacaster/DockerRes/nyaachat-shared/db/nyaachat-shared.db
```

## 输出

以表格形式打印 `Account`、`Username`、`Created`（注册时间）、`LastActive`（最后活跃时间）。
时间以 `yyyy-MM-dd HH:mm:ss` 本地时区格式显示。
从未活跃过的用户 `LastActive` 显示为 `(never)`。

## 数据库位置

脚本自动探测数据库路径，优先级：

1. 环境变量 `NYAACHAT_SHARED_DB`（显式覆盖）
2. 环境变量 `SHARED_RES_DIR` + `/db/nyaachat-shared.db`
3. 平台默认值：Windows → `E:\DockerRes\nyaachat-shared\db\nyaachat-shared.db`，Linux/macOS → `~/DockerRes/nyaachat-shared/db/nyaachat-shared.db`
4. `--db-path` 命令行参数可覆盖以上所有
