# boss-greet

一个 [Claude Code](https://docs.anthropic.com/claude-code) skill：在 BOSS直聘求职者端按条件批量「立即沟通」打招呼。

- 按城市、关键词、薪资下限收集岗位。会解码薪资的混淆字体，并按下限自己再过滤一遍，因为平台的薪资筛选很松。
- 过滤掉猎头（卡片上的「猎头」角标、招聘人写的「猎头顾问」）、匿名公司、外包/驻场/派遣、实习、销售和培训类岗位。
- 防风控节奏：每个招呼间隔 20–40 秒随机，中间穿插只浏览不打招呼，有每日和每段的数量上限，遇到验证码就停。
- 记录投递进度，可以断点续跑；同一家公司重发的同名岗位不会重复打。
- 不走接口，也不开新的自动化浏览器：用的是 [Ego Lite](https://lite.ego.app/) 里你自己已经登录的浏览器，像真人一样点页面。

## 依赖

- Claude Code，并装好 `ego-browser` skill 和 Ego Lite 浏览器
- 在 Ego 里登录 BOSS直聘（求职者身份）
- 在 BOSS App 里设好自定义招呼语。网页版只能选模板。

## 安装

```bash
git clone https://github.com/jakob52123/boss-greet-skill ~/.claude/skills/boss-greet
mkdir -p ~/.boss-greet && cp ~/.claude/skills/boss-greet/config.example.json ~/.boss-greet/config.json
# 按自己的条件改 ~/.boss-greet/config.json
```

然后在 Claude Code 里说「帮我在 BOSS 上打招呼」就行。完整流程见 [SKILL.md](SKILL.md)。

城市代码：上海 `101020100`、北京 `101010100`、深圳 `101280600`、杭州 `101210100`、广州 `101280100`。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `queries` | `["AI产品经理"]` | 搜索关键词，可以写多个 |
| `salaryMinK` | 20 | 薪资区间下限低于它的不投 |
| `titleInclude` / `titleMustHave` / `titleExclude` | 见样例 | 标题筛选（正则） |
| `skipHeadhunter` / `skipAnonymous` / `skipOutsourcing` | true | 跳过猎头、匿名公司、外包 |
| `dailyMax` / `runMax` | 100 / 50 | 每天、每段最多打几个 |
| `intervalSec` | [20, 40] | 每个招呼之间的随机间隔（秒） |
| `dryRun` | false | 只判断，不点「立即沟通」 |

## 风险声明

自动化操作可能违反 BOSS直聘的用户协议，账号有被限流或封禁的风险，请自行评估。建议用默认节奏，每天别打满 150 个，出现验证码当天就停。本项目只用于个人求职提效，作者不对账号问题负责。

## License

MIT
