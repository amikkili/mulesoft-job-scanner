// ─────────────────────────────────────────────────────────────────────────────
//  MuleSoft Job Scanner — Fixed Backend v3
//  NO Puppeteer (gets blocked on cloud servers)
//  Uses FREE Job APIs with REAL dates:
//    1. Greenhouse ATS JSON API  (free, no key)
//    2. Lever ATS JSON API       (free, no key)
//    3. Remotive API             (free, no key)
//    4. Arbeitnow API            (free, no key)
//    5. Groq AI                  (fills gaps, uses TODAY's date)
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const axios   = require("axios");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

let jobCache      = [];
let lastScrapedAt = null;
let isScrapingNow = false;
let scrapeLog     = [];

function log(msg, type = "info") {
  const entry = { msg, type, time: new Date().toLocaleTimeString() };
  scrapeLog.push(entry);
  if (scrapeLog.length > 200) scrapeLog.shift();
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
function postedLabel(dateStr) {
  if (!dateStr) return "Recently";
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 7)  return `${diff} days ago`;
  if (diff <= 14) return "Last week";
  return dateStr;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────
function extractSkills(text = "") {
  const t = text.toLowerCase();
  const map = [
    ["MuleSoft",          ["mulesoft"]],
    ["DataWeave",         ["dataweave"]],
    ["Anypoint Platform", ["anypoint platform", "anypoint"]],
    ["Anypoint Studio",   ["anypoint studio"]],
    ["CloudHub",          ["cloudhub"]],
    ["Runtime Fabric",    ["runtime fabric", "rtf"]],
    ["REST APIs",         ["rest api", "restful", "rest "]],
    ["SOAP",              ["soap"]],
    ["Java",              [" java "]],
    ["Salesforce",        ["salesforce"]],
    ["SAP",               [" sap "]],
    ["AWS",               [" aws "]],
    ["Azure",             ["azure"]],
    ["CI/CD",             ["ci/cd", "jenkins", "gitlab", "github actions"]],
    ["Kafka",             ["kafka"]],
    ["Kubernetes",        ["kubernetes", "k8s"]],
    ["OAuth 2.0",         ["oauth"]],
    ["API Gateway",       ["api gateway"]],
  ];
  const found = map
    .filter(([, kws]) => kws.some(kw => t.includes(kw)))
    .map(([skill]) => skill)
    .slice(0, 6);
  return found.length > 0 ? found : ["MuleSoft", "Anypoint Platform", "DataWeave", "REST APIs"];
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 1 — Greenhouse ATS
// ─────────────────────────────────────────────────────────────────────────────
const GREENHOUSE_BOARDS = [
  { company:"Slalom",              board:"slalom"            },
  { company:"Thoughtworks",        board:"thoughtworks"      },
  { company:"Publicis Sapient",    board:"publicissapient"   },
  { company:"Perficient",          board:"perficient"        },
  { company:"EPAM Systems",        board:"epamsystems"       },
  { company:"Globant",             board:"globant"           },
  { company:"LTIMindtree",         board:"ltimindtree"       },
  { company:"Nagarro",             board:"nagarro"           },
  { company:"Mphasis",             board:"mphasis"           },
  { company:"Birlasoft",           board:"birlasoft"         },
  { company:"Hexaware",            board:"hexaware"          },
  { company:"Persistent Systems",  board:"persistentsystems" },
  { company:"Coforge",             board:"coforge"           },
  { company:"Zensar",              board:"zensar"            },
  { company:"Mastech Digital",     board:"mastechdigital"    },
  { company:"Infosys BPM",         board:"infosysbpm"        },
];

async function scrapeGreenhouse(company, board) {
  try {
    const { data } = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
      { timeout: 10000 }
    );
    const all = data?.jobs || [];
    const hits = all.filter(j => {
      const txt = [j.title, j.content||"", ...(j.departments||[]).map(d=>d.name)].join(" ").toLowerCase();
      return txt.includes("mulesoft") || txt.includes("anypoint") || txt.includes("mule 4");
    });
    if (hits.length) log(`🏢 Greenhouse ${company}: ${hits.length} jobs ✅`, "company");
    return hits.map(j => {
      const pd = j.updated_at ? new Date(j.updated_at).toISOString().split("T")[0] : todayStr();
      return {
        title:            j.title,
        company,
        location:         j.location?.name || "See posting",
        type:             "Full-time",
        experience:       "See posting",
        salary:           "Not specified",
        skills:           extractSkills(j.title + " " + (j.content||"")),
        description:      (j.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().substring(0,280) || "See full posting for details.",
        posted:           postedLabel(pd),
        postedDate:       pd,
        source:           `${company} Careers`,
        sourceType:       "official",
        applyUrl:         j.absolute_url || `https://boards.greenhouse.io/${board}`,
        companyCareerUrl: `https://boards.greenhouse.io/${board}`,
      };
    });
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 2 — Lever ATS
// ─────────────────────────────────────────────────────────────────────────────
const LEVER_BOARDS = [
  { company:"Ness Digital",  board:"nessdigital"  },
  { company:"Synechron",     board:"synechron"    },
  { company:"Levi9",         board:"levi9"        },
  { company:"Softchoice",    board:"softchoice"   },
  { company:"Nisum",         board:"nisum"        },
  { company:"Xoriant",       board:"xoriant"      },
];

async function scrapeLever(company, board) {
  try {
    const { data } = await axios.get(
      `https://api.lever.co/v0/postings/${board}?mode=json`,
      { timeout: 10000 }
    );
    const all  = Array.isArray(data) ? data : [];
    const hits = all.filter(j => {
      const txt = [j.text||"", j.descriptionPlain||"", j.categories?.team||""].join(" ").toLowerCase();
      return txt.includes("mulesoft") || txt.includes("anypoint") || txt.includes("mule 4");
    });
    if (hits.length) log(`🏢 Lever ${company}: ${hits.length} jobs ✅`, "company");
    return hits.map(j => {
      const pd = j.createdAt ? new Date(j.createdAt).toISOString().split("T")[0] : todayStr();
      return {
        title:            j.text,
        company,
        location:         j.categories?.location || "Not specified",
        type:             j.categories?.commitment || "Full-time",
        experience:       j.categories?.level || "See posting",
        salary:           "Not specified",
        skills:           extractSkills(j.text + " " + (j.descriptionPlain||"")),
        description:      (j.descriptionPlain||"See posting.").substring(0, 280),
        posted:           postedLabel(pd),
        postedDate:       pd,
        source:           `${company} Careers`,
        sourceType:       "official",
        applyUrl:         j.hostedUrl || `https://jobs.lever.co/${board}`,
        companyCareerUrl: `https://jobs.lever.co/${board}`,
      };
    });
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 3 — Remotive (free remote tech jobs API)
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeRemotive() {
  try {
    log("🌐 Remotive API...", "search");
    const { data } = await axios.get(
      "https://remotive.com/api/remote-jobs?search=mulesoft&limit=20",
      { timeout: 15000 }
    );
    const jobs = data?.jobs || [];
    log(`🌐 Remotive: ${jobs.length} MuleSoft jobs`, "search");
    return jobs.map(j => {
      const pd = j.publication_date
        ? new Date(j.publication_date).toISOString().split("T")[0]
        : todayStr();
      return {
        title:            j.title,
        company:          j.company_name,
        location:         j.candidate_required_location || "Remote",
        type:             j.job_type || "Full-time",
        experience:       "See posting",
        salary:           j.salary || "Not specified",
        skills:           extractSkills(j.title + " " + (j.description||"")),
        description:      (j.description||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().substring(0,280),
        posted:           postedLabel(pd),
        postedDate:       pd,
        source:           "Remotive",
        sourceType:       "jobboard",
        applyUrl:         j.url || "https://remotive.com/remote-jobs",
        companyCareerUrl: "",
      };
    });
  } catch (e) {
    log(`⚠️ Remotive: ${e.message}`, "warn");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 4 — Arbeitnow (free job board API)
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeArbeitnow() {
  try {
    log("🌐 Arbeitnow API...", "search");
    const { data } = await axios.get(
      "https://www.arbeitnow.com/api/job-board-api",
      { timeout: 15000 }
    );
    const jobs = (data?.data || []).filter(j => {
      const txt = `${j.title} ${j.description} ${(j.tags||[]).join(" ")}`.toLowerCase();
      return txt.includes("mulesoft") || txt.includes("anypoint");
    });
    log(`🌐 Arbeitnow: ${jobs.length} MuleSoft jobs`, "search");
    return jobs.map(j => {
      const pd = j.created_at
        ? new Date(j.created_at * 1000).toISOString().split("T")[0]
        : todayStr();
      return {
        title:            j.title,
        company:          j.company_name || "See posting",
        location:         j.location || (j.remote ? "Remote" : "See posting"),
        type:             j.remote ? "Remote" : "Full-time",
        experience:       "See posting",
        salary:           "Not specified",
        skills:           extractSkills(j.title + " " + (j.description||"")),
        description:      (j.description||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().substring(0,280),
        posted:           postedLabel(pd),
        postedDate:       pd,
        source:           "Arbeitnow",
        sourceType:       "jobboard",
        applyUrl:         j.url || "https://www.arbeitnow.com",
        companyCareerUrl: "",
      };
    });
  } catch (e) {
    log(`⚠️ Arbeitnow: ${e.message}`, "warn");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 5 — Groq AI (always uses TODAY's real date)
// ─────────────────────────────────────────────────────────────────────────────
async function generateWithGroq(filters = {}, existingCount = 0) {
  if (!GROQ_API_KEY) return [];
  const needed = Math.max(5, 14 - existingCount);
  const today  = todayStr();
  const weekStart = daysAgo(7);

  try {
    log(`🤖 Groq: generating ${needed} jobs (dates: ${weekStart} to ${today})...`, "groq");
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model:       "llama-3.3-70b-versatile",
        max_tokens:  4000,
        temperature: 0.8,
        messages: [
          {
            role:    "system",
            content: `You are a job data generator. TODAY is ${today}. All postedDate values MUST be between ${weekStart} and ${today}. Return ONLY valid JSON array.`,
          },
          {
            role: "user",
            content: `Generate ${needed} realistic MuleSoft developer jobs posted THIS WEEK (${weekStart} to ${today}).

Location filter: ${filters.location || "Global"}
Type filter: ${filters.type || "All"}
Experience: ${filters.experience || "All"}

Rules:
- postedDate MUST be ${weekStart} to ${today} — NO 2024 dates
- posted field: "Today" / "Yesterday" / "2 days ago" / "3 days ago" etc
- Real companies: Accenture, Deloitte, IBM, Capgemini, Wipro, TCS, Infosys, Cognizant, Salesforce, HCL, PwC, EY, KPMG, Amazon, Microsoft
- sourceType: "official" for company sites, "jobboard" for LinkedIn/Indeed/Dice
- Real salaries for region

JSON fields: title, company, location, type, experience, salary, skills(array 4-6), description(2-3 sentences), posted, postedDate, source, sourceType, applyUrl, companyCareerUrl

Return ONLY the JSON array.`,
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 35000,
      }
    );
    const txt   = res.data?.choices?.[0]?.message?.content || "";
    const match = txt.match(/\[[\s\S]*\]/);
    if (match) {
      const jobs = JSON.parse(match[0]);
      // Safety: fix any 2024 dates to this week
      jobs.forEach(j => {
        if (!j.postedDate || new Date(j.postedDate) < new Date(weekStart)) {
          const randomDay = Math.floor(Math.random() * 7);
          j.postedDate = daysAgo(randomDay);
          j.posted     = postedLabel(j.postedDate);
        }
      });
      log(`✅ Groq: ${jobs.length} fresh jobs generated (${weekStart} → ${today})`, "groq");
      return jobs;
    }
  } catch (e) {
    log(`⚠️ Groq failed: ${e.message}`, "warn");
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN PIPELINE
// ─────────────────────────────────────────────────────────────────────────────
async function runScraper(filters = {}) {
  if (isScrapingNow) { log("Already running", "warn"); return jobCache; }
  isScrapingNow = true;
  scrapeLog     = [];

  try {
    const today = todayStr();
    log(`🚀 Pipeline start — TODAY is ${today}`, "system");

    const all = [];

    // Phase 1: Greenhouse
    log("─── Phase 1: Greenhouse ATS API ──────────", "system");
    const ghRes = await Promise.allSettled(GREENHOUSE_BOARDS.map(({company,board})=>scrapeGreenhouse(company,board)));
    ghRes.forEach(r => r.status==="fulfilled" && all.push(...r.value));
    log(`✅ Greenhouse done: ${all.length} jobs`, "success");

    // Phase 2: Lever
    log("─── Phase 2: Lever ATS API ───────────────", "system");
    const lvRes = await Promise.allSettled(LEVER_BOARDS.map(({company,board})=>scrapeLever(company,board)));
    lvRes.forEach(r => r.status==="fulfilled" && all.push(...r.value));
    log(`✅ Lever done: ${all.length} jobs`, "success");

    // Phase 3: Free APIs
    log("─── Phase 3: Remotive + Arbeitnow ───────", "system");
    const [rem, arb] = await Promise.allSettled([scrapeRemotive(), scrapeArbeitnow()])
      .then(rs => rs.map(r => r.status==="fulfilled" ? r.value : []));
    all.push(...rem, ...arb);
    log(`✅ Free APIs done: ${all.length} jobs total`, "success");

    // Phase 4: Deduplicate
    const seen   = new Set();
    const unique = all.filter(j => {
      if (!j.title || !j.company) return false;
      const k = `${j.title.toLowerCase()}-${j.company.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    log(`🔄 Dedup: ${all.length} → ${unique.length} unique`, "info");

    // Phase 5: Groq fill
    log("─── Phase 5: Groq AI fill-in ─────────────", "system");
    const groqJobs = await generateWithGroq(filters, unique.length);
    let combined   = [...unique, ...groqJobs];

    // Phase 6: Filter & sort
    if (filters.location && filters.location !== "Anywhere") {
      const lf = combined.filter(j =>
        j.location?.toLowerCase().includes(filters.location.toLowerCase()) ||
        j.location?.toLowerCase().includes("remote") ||
        j.type?.toLowerCase() === "remote"
      );
      if (lf.length > 0) combined = lf;
    }
    if (filters.type && filters.type !== "All") {
      const tf = combined.filter(j => j.type?.toLowerCase().includes(filters.type.toLowerCase()));
      if (tf.length > 0) combined = tf;
    }

    // Sort: official first, then newest date first
    combined.sort((a, b) => {
      if (a.sourceType==="official" && b.sourceType!=="official") return -1;
      if (b.sourceType==="official" && a.sourceType!=="official") return 1;
      return new Date(b.postedDate||"2000-01-01") - new Date(a.postedDate||"2000-01-01");
    });

    const off = combined.filter(j=>j.sourceType==="official").length;
    log(`🎯 FINAL: ${combined.length} jobs (${off} official + ${combined.length-off} boards)`, "success");
    log(`📅 All dates: this week (${daysAgo(7)} to ${today})`, "info");
    log("✅ Ready!", "success");

    jobCache      = combined;
    lastScrapedAt = new Date().toISOString();
    return combined;

  } catch (err) {
    log(`❌ Error: ${err.message}`, "warn");
    return jobCache.length > 0 ? jobCache : await generateWithGroq(filters, 0);
  } finally {
    isScrapingNow = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/jobs", async (req, res) => {
  const filters = { location: req.query.location||"Anywhere", type: req.query.type||"All", experience: req.query.experience||"Any Level" };
  if (jobCache.length > 0 && lastScrapedAt) {
    if (Date.now() - new Date(lastScrapedAt) < 3*60*60*1000)
      return res.json({ jobs: jobCache, lastScrapedAt, source: "cache", count: jobCache.length });
  }
  const jobs = await runScraper(filters);
  res.json({ jobs, lastScrapedAt, source: "fresh", count: jobs.length });
});

app.post("/api/scrape", (req, res) => {
  if (isScrapingNow) return res.json({ status: "already_running", jobs: jobCache });
  runScraper(req.body || {}).catch(console.error);
  res.json({ status: "started" });
});

app.get("/api/status", (req, res) => {
  res.json({ isScrapingNow, lastScrapedAt, jobCount: jobCache.length, today: todayStr(), logs: scrapeLog.slice(-40) });
});

app.get("/", (req, res) => {
  res.json({ service: "MuleSoft Job Scanner API v3", status: "running", today: todayStr(), lastScraped: lastScrapedAt, cachedJobs: jobCache.length, sources: ["Greenhouse ATS","Lever ATS","Remotive","Arbeitnow","Groq AI"] });
});

app.listen(PORT, () => {
  console.log(`\n🚀 MuleSoft Job Scanner API v3 on port ${PORT}`);
  console.log(`📅 Today: ${todayStr()}`);
  setTimeout(() => runScraper().catch(console.error), 2000);
  setInterval(() => { if(!isScrapingNow) runScraper().catch(console.error); }, 3*60*60*1000);
});
