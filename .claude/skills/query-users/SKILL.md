# query-users

查询 NyaaChat 共享后端 SQLite 数据库中的用户账号信息。

## 触发条件

当用户提出以下意图时调用此 skill：

- "查询用户"、"查看用户"、"活跃用户"、"用户活跃时间"
- "看看谁在线"、"查一下账号数据"、"数据库里有哪些用户"
- 任何与 NyaaChat 账号数据库（users 表）相关的查询

## 执行方式

运行项目根目录下的查询脚本：

```
powershell -ExecutionPolicy Bypass -File .\scripts\query-users.ps1
```

### 可选参数

| 参数 | 作用 | 示例 |
|------|------|------|
| `-ActiveOnly` | 只显示 `last_active > 0`（有过活跃记录）的用户 | `-ActiveOnly` |
| `-Account <name>` | 精确匹配某个账号 | `-Account nyaa` |
| `-DbPath <path>` | 覆盖默认数据库路径 | `-DbPath "E:\..."` |

### 示例

```powershell
# 全部用户
powershell -ExecutionPolicy Bypass -File .\scripts\query-users.ps1

# 只看有活跃记录的用户
powershell -ExecutionPolicy Bypass -File .\scripts\query-users.ps1 -ActiveOnly

# 查特定账号
powershell -ExecutionPolicy Bypass -File .\scripts\query-users.ps1 -Account nyaa
```

## 输出

以表格形式打印 `Account`、`Username`、`Created`（注册时间）、`LastActive`（最后活跃时间）。
时间以 `yyyy-MM-dd HH:mm:ss` 本地时区格式显示。
从未活跃过的用户 `LastActive` 显示为 `(never)`。

## 数据库位置

默认路径：`E:\DockerRes\nyaachat-shared\db\nyaachat-shared.db`
（由 docker-compose.shared.yml 的 bind mount 映射到宿主机）
