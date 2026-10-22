// boss-greet：BOSS直聘求职者端批量打招呼。在 `ego-browser nodejs` 里 import 本文件使用：
//   const boss = await import("/abs/path/scripts/boss.mjs");
//   const cfg = await boss.loadConfig("/abs/path/config.json");
//   await boss.collect(page, cfg);   // 搜索并收集候选岗位 → <stateDir>/jobs.json
//   await boss.greet(page, cfg);     // 按节奏逐个打招呼 → <stateDir>/log.json
// 脚本跑在 ego 的 Node 进程里，不继承 shell 的工作目录和环境变量，所有路径都用绝对路径。

const fs = await import("node:fs/promises");
const os = await import("node:os");
const path = await import("node:path");

const DEFAULTS = {
  city: "101020100",            // 上海；北京 101010100，深圳 101280600，杭州 101210100，广州 101280100
  queries: ["AI产品经理"],
  salaryMinK: 20,               // 薪资区间下限（K）低于它的不投
  titleInclude: "ai|aigc|大模型|智能|agent|llm",
  titleMustHave: "产品",
  titleExclude: "实习|销售|培训|培养|运营|讲师|助理|兼职",
  skipHeadhunter: true,         // 不投猎头岗
  skipAnonymous: true,          // 不投匿名公司（「某大型…公司」，多为猎头代招）
  skipOutsourcing: true,        // 不投外包/驻场/派遣岗
  outsourcingPattern: "外包|驻场|派遣|外派|人力资源服务|人力外包",
  dailyMax: 100,                // 每天最多打多少个（平台硬上限 150，建议 80–100）
  runMax: 50,                   // 本次最多打多少个（分段打，段与段之间隔几个小时）
  intervalSec: [20, 40],        // 每个招呼之间的随机间隔
  browseEvery: 8,               // 每打几个就穿插一次「随便看看」
  scrollRounds: 10,             // 收集时每个搜索页下拉几次
  dryRun: false,                // true = 只判断不点「立即沟通」
  stateDir: path.join(os.homedir(), ".boss-greet"),
};

export async function loadConfig(file) {
  let user = {};
  if (file) user = JSON.parse(await fs.readFile(file, "utf8"));
  const cfg = { ...DEFAULTS, ...user };
  await fs.mkdir(cfg.stateDir, { recursive: true });
  return cfg;
}

const sleep = (page, ms) => page.waitForTimeout(ms);
const rand = (a, b) => a + Math.random() * (b - a);
const keyOf = (href) => (href || "").split("?")[0];
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD，本地时区

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 1));
}

// 薪资数字是混淆字体：U+E031–U+E03A 对应 0–9
export function decodeSalary(s) {
  return [...(s || "")].map((ch) => {
    const k = ch.charCodeAt(0);
    return k >= 0xe031 && k <= 0xe03a ? String(k - 0xe031) : ch;
  }).join("");
}

function salaryCodes(minK) {
  // BOSS 的薪资筛选：404=10-20K 405=20-50K 406=50K以上；筛选很松，后面还要按下限自己过滤
  if (minK >= 50) return ["406"];
  if (minK >= 20) return ["405", "406"];
  if (minK >= 10) return ["404", "405", "406"];
  return [""];
}

export function passTitleAndSalary(job, cfg) {
  const name = job.name || "";
  const m = /^(\d+)-(\d+)K/.exec(job.salary || "");
  if (cfg.skipHeadhunter && job.tag === "猎头") return "猎头";
  if (cfg.skipAnonymous && job.anonymous) return "匿名公司";
  if (!m) return "薪资格式（日薪/面议）";
  if (Number(m[1]) < cfg.salaryMinK) return `下限<${cfg.salaryMinK}K`;
  if (!new RegExp(cfg.titleInclude, "i").test(name)) return "标题不含关键词";
  if (cfg.titleMustHave && !name.includes(cfg.titleMustHave)) return `标题不含「${cfg.titleMustHave}」`;
  if (cfg.titleExclude && new RegExp(cfg.titleExclude, "i").test(name)) return "标题命中排除词";
  if (cfg.skipOutsourcing && new RegExp(cfg.outsourcingPattern).test(name + " " + (job.text || ""))) return "外包";
  return null;
}

// 1) 收集候选岗位
export async function collect(page, cfg) {
  const file = path.join(cfg.stateDir, "jobs.json");
  const jobs = new Map((await readJson(file, [])).map((j) => [keyOf(j.href), j]));
  const before = jobs.size;
  for (const q of cfg.queries) {
    for (const sal of salaryCodes(cfg.salaryMinK)) {
      const url = `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(q)}&city=${cfg.city}` + (sal ? `&salary=${sal}` : "");
      await page.goto(url).catch(() => {}); // 列表页常常 load 不完，不影响取数
      await sleep(page, 4000);
      for (let i = 0; i < cfg.scrollRounds; i++) {
        // 页面偶尔卡住导致 evaluate 超时：跳过这一下，继续
        await page.evaluate(() => { window.scrollBy(0, 3000); document.querySelector(".job-list-container")?.scrollBy(0, 3000); }).catch(() => {});
        await sleep(page, rand(1400, 2200));
      }
      const rows = await page.evaluate(() => [...document.querySelectorAll(".job-card-box")].map((c) => ({
        name: c.querySelector(".job-name")?.innerText.trim(),
        salaryRaw: c.querySelector(".job-salary")?.textContent || "",
        href: c.querySelector("a.job-name, a")?.href,
        tag: c.querySelector("img.job-tag-icon")?.alt || "",
        anonymous: !!c.querySelector(".boss-info.is-anonymous"),
        company: c.querySelector(".boss-name")?.innerText.trim() || "",
        text: c.innerText.replace(/\s+/g, " ").slice(0, 160),
      })));
      let added = 0;
      for (const r of rows) {
        if (!r.href) continue;
        const k = keyOf(r.href);
        if (jobs.has(k)) continue;
        const job = { name: r.name, salary: decodeSalary(r.salaryRaw), href: k, company: r.company, tag: r.tag, anonymous: r.anonymous, text: r.text, query: q };
        job.reject = passTitleAndSalary(job, cfg);
        jobs.set(k, job);
        added++;
      }
      console.log(`[collect] ${q} salary=${sal || "-"} 卡片 ${rows.length}，新增 ${added}`);
    }
  }
  const all = [...jobs.values()];
  await writeJson(file, all);
  const ok = all.filter((j) => !j.reject).length;
  console.log(`[collect] 候选池 ${all.length}（本次新增 ${all.length - before}），通过标题/薪资筛选 ${ok}`);
  return { total: all.length, ok };
}

// 详情页上的判断：按钮状态、猎头、外包、风控
async function inspectDetail(page, cfg) {
  return page.evaluate((pattern) => {
    const body = document.body.innerText;
    // 只看主体，去掉页尾的「热门职位」「看过该职位的人」等推荐区，避免误判
    const cut = Math.min(...["热门职位", "看过该职位的人", "求职工具"].map((s) => { const i = body.indexOf(s); return i < 0 ? body.length : i; }));
    const main = body.slice(0, cut);
    const btn = [...document.querySelectorAll("a,button")].find((b) => b.offsetParent && /^(立即沟通|继续沟通)$/.test(b.innerText.trim()));
    return {
      btn: btn ? btn.innerText.trim() : null,
      headhunter: /猎头顾问|·\s*猎头|猎头公司/.test(main),
      outsourcing: new RegExp(pattern).exec(main)?.[0] || null,
      verify: !!document.querySelector("[class*=geetest], [class*=captcha], [class*=verify-wrap]") || /请完成安全验证/.test(body.slice(0, 300)) || /security-check|verify/.test(location.pathname),
      limit: /已达到沟通上限|今日沟通.*上限|沟通次数已用完/.test(body),
    };
  }, cfg.outsourcingPattern);
}

const sentNow = (page) => page.evaluate(() =>
  /已向BOSS发送消息/.test(document.body.innerText) || /\/chat/.test(location.pathname) ||
  [...document.querySelectorAll("a,button")].some((b) => b.offsetParent && b.innerText.trim() === "继续沟通"));

async function browseAround(page, cfg) {
  // 穿插一段不打招呼的浏览，打散「开详情→点沟通→下一个」的固定节奏
  const q = cfg.queries[Math.floor(Math.random() * cfg.queries.length)];
  await page.goto(`https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(q)}&city=${cfg.city}`).catch(() => {});
  await sleep(page, rand(3000, 5000));
  const n = Math.floor(rand(2, 5));
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => { window.scrollBy(0, 600 + Math.random() * 900); document.querySelector(".job-list-container")?.scrollBy(0, 800); }).catch(() => {});
    await sleep(page, rand(4000, 9000));
  }
  console.log("[greet] 穿插浏览一次");
}

// 2) 逐个打招呼
export async function greet(page, cfg) {
  const jobs = await readJson(path.join(cfg.stateDir, "jobs.json"), []);
  const logFile = path.join(cfg.stateDir, "log.json");
  const log = await readJson(logFile, []);
  // dry-run 的记录不算处理过，正式跑时还要再打
  const done = new Set(log.filter((l) => l.result !== "dry-run").map((l) => keyOf(l.href)));
  // 同一家公司重发的同名岗位链接不同，按「公司|职位名」再去重一次（匿名公司名不可靠，不参与）
  const pairOf = (j) => (j.company && !j.anonymous ? `${j.company}|${j.name}` : null);
  const donePairs = new Set(log.filter((l) => l.result === "sent").map(pairOf).filter(Boolean));
  const sentToday = () => log.filter((l) => l.result === "sent" && l.day === today()).length;
  const record = async (job, result, extra = {}) => {
    log.push({ name: job.name, salary: job.salary, href: keyOf(job.href), company: job.company, anonymous: job.anonymous, text: job.text, result, day: today(), at: new Date().toISOString(), ...extra });
    await writeJson(logFile, log);
  };

  let sent = 0;
  for (const job of jobs) {
    if (job.reject || done.has(keyOf(job.href))) continue;
    if (pairOf(job) && donePairs.has(pairOf(job))) { await record(job, "skip:同公司同名已投"); continue; }
    if (sent >= cfg.runMax) return { stop: "runMax", sent, sentToday: sentToday() };
    if (sentToday() >= cfg.dailyMax) return { stop: "dailyMax", sent, sentToday: sentToday() };

    await page.goto(job.href).catch(() => {});
    await sleep(page, rand(2500, 4000));
    let st = await inspectDetail(page, cfg);
    if (st.verify) return { stop: "verify", sent, url: await page.url() };
    if (st.limit) return { stop: "platform-limit", sent };
    if (cfg.skipHeadhunter && st.headhunter) { await record(job, "skip:猎头"); continue; }
    if (cfg.skipOutsourcing && st.outsourcing) { await record(job, "skip:外包", { hit: st.outsourcing }); continue; }
    if (st.btn !== "立即沟通") { await record(job, "skip:" + (st.btn || "无按钮")); continue; }
    if (cfg.dryRun) { console.log("[dry-run] 会打招呼：", job.salary, job.name, job.text.slice(-30)); await record(job, "dry-run"); continue; }

    await sleep(page, rand(1500, 4000)); // 像人一样先看一会儿 JD
    await page.click('loc=role:link[name="立即沟通"]', { label: "立即沟通" })
      .catch(() => page.click('text="立即沟通"', { label: "立即沟通" }));
    // BOSS 有时 10 秒以上才响应，别把慢当成失败
    await page.waitForFunction(() =>
      /已向BOSS发送消息|还剩\d+次沟通机会|已达到沟通上限/.test(document.body.innerText) || /\/chat/.test(location.pathname) ||
      [...document.querySelectorAll("a,button")].some((b) => b.offsetParent && b.innerText.trim() === "继续沟通"),
      undefined, { timeout: 12000 }).catch(() => {});
    if (await page.evaluate(() => /还剩\d+次沟通机会/.test(document.body.innerText))) {
      console.log("[greet] 平台提示剩余沟通次数，点「好」继续");
      await page.click('text="好"', { label: "知道了" }).catch(() => {});
      await sleep(page, 3000);
    }
    st = await inspectDetail(page, cfg);
    if (st.verify) return { stop: "verify", sent, url: await page.url() };
    if (!(await sentNow(page))) await sleep(page, 15000);
    if (await sentNow(page)) {
      sent++;
      await record(job, "sent");
      if (pairOf(job)) donePairs.add(pairOf(job));
      console.log(`[greet] ${sent}（今天 ${sentToday()}） ${job.salary} ${job.name} | ${job.text.slice(-30)}`);
      await page.click("text=留在此页", { label: "留在此页" }).catch(() => {});
    } else if (st.limit) {
      return { stop: "platform-limit", sent };
    } else {
      await record(job, "unknown");
      return { stop: "unknown", sent, url: await page.url() };
    }
    if (cfg.browseEvery && sent % cfg.browseEvery === 0) await browseAround(page, cfg);
    await sleep(page, rand(cfg.intervalSec[0], cfg.intervalSec[1]) * 1000);
  }
  return { stop: "no-more-jobs", sent, sentToday: sentToday() };
}

// 3) 汇总
export async function report(cfg) {
  const log = await readJson(path.join(cfg.stateDir, "log.json"), []);
  const jobs = await readJson(path.join(cfg.stateDir, "jobs.json"), []);
  const count = {};
  for (const l of log.filter((l) => l.day === today())) count[l.result] = (count[l.result] || 0) + 1;
  const done = new Set(log.filter((l) => l.result !== "dry-run").map((l) => keyOf(l.href)));
  return { today: today(), count, remaining: jobs.filter((j) => !j.reject && !done.has(keyOf(j.href))).length };
}
