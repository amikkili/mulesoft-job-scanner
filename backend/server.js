// ─────────────────────────────────────────────────────────────────────────────
//  MuleSoft Job Scanner — Backend v4
//  REAL job sources with correct dates:
//    1. Indeed RSS Feed     (free, no API key, REAL jobs)
//    2. Remotive API        (free, no key)
//    3. Arbeitnow API       (free, no key)
//    4. Greenhouse ATS API  (free, no key)
//    5. Lever ATS API       (free, no key)
//    6. Groq AI             (fills gaps with TODAY's date)
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const axios   = require("axios");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY    = process.env.GROQ_API_KEY    || "";
const JSEARCH_API_KEY = process.env.JSEARCH_API_KEY || ""; // optional RapidAPI key

let jobCache      = [];
let lastScrapedAt = null;
let isScrapingNow = false;
let scrapeLog     = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg, type = "info") {
  const entry = { msg, type, time: new Date().toLocaleTimeString() };
  scrapeLog.push(entry);
  if (scrapeLog.length > 300) scrapeLog.shift();
  console.log(`[${type.toUpperCase()}] ${msg}`);
}
const todayStr   = ()  => new Date().toISOString().split("T")[0];
const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split("T")[0]; };
function postedLabel(dateStr) {
  if (!dateStr) return "Recently";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff < 0)  return "Today";
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 7)  return `${diff} days ago`;
  if (diff <= 14) return "Last week";
  return dateStr;
}
function stripHtml(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
}
function extractSkills(text = "") {
  const t = text.toLowerCase();
  const map = [
    ["MuleSoft",          ["mulesoft"]],
    ["DataWeave",         ["dataweave"]],
    ["Anypoint Platform", ["anypoint platform","anypoint"]],
    ["Anypoint Studio",   ["anypoint studio"]],
    ["CloudHub",          ["cloudhub"]],
    ["Runtime Fabric",    ["runtime fabric","rtf"]],
    ["REST APIs",         ["rest api","restful"]],
    ["SOAP",              ["soap"]],
    ["Java",              [" java ","java,","java."]],
    ["Salesforce",        ["salesforce"]],
    ["SAP",               [" sap ","sap,"]],
    ["AWS",               [" aws ","aws,"]],
    ["Azure",             ["azure"]],
    ["CI/CD",             ["ci/cd","jenkins","gitlab"]],
    ["Kafka",             ["kafka"]],
    ["Kubernetes",        ["kubernetes","k8s"]],
    ["OAuth 2.0",         ["oauth"]],
    ["API Gateway",       ["api gateway"]],
    ["Batch Processing",  ["batch processing","batch job"]],
    ["MQ",                ["anypoint mq","activemq","rabbitmq"]],
  ];
  const found = map.filter(([,kws])=>kws.some(kw=>t.includes(kw))).map(([s])=>s).slice(0,6);
  return found.length > 0 ? found : ["MuleSoft","Anypoint Platform","DataWeave","REST APIs"];
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 1 — Indeed RSS Feed (REAL jobs, no API key)
//  Indeed exposes RSS feeds for any search — completely free
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeIndeedRSS(searchLocation = "") {
  try {
    log("📰 Indeed RSS Feed: fetching MuleSoft jobs...", "search");

    // Build Indeed RSS URL
    // l = location, q = query, sort = date (newest first), fromage = days old
    const locParam = searchLocation && searchLocation !== "Anywhere"
      ? `&l=${encodeURIComponent(searchLocation)}`
      : "";
    const url = `https://www.indeed.com/rss?q=mulesoft+developer&sort=date&fromage=14${locParam}`;

    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RSS reader)",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
    });

    // Parse RSS XML manually (no xml parser needed)
    const items = [...data.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    log(`📰 Indeed RSS: found ${items.length} raw items`, "search");

    const jobs = items.slice(0, 20).map(match => {
      const xml      = match[1];
      const title    = stripHtml((xml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g,"").trim());
      const company  = stripHtml((xml.match(/<source>([\s\S]*?)<\/source>/)?.[1] || "See posting").replace(/<!\[CDATA\[|\]\]>/g,"").trim());
      const location = stripHtml((xml.match(/<indeed:loc>([\s\S]*?)<\/indeed:loc>/)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g,"").trim());
      const link     = (xml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "").trim();
      const pubDate  = (xml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "").trim();
      const desc     = stripHtml((xml.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g,"").trim()).substring(0, 300);

      // Parse pubDate (RSS format: "Mon, 24 Mar 2026 00:00:00 GMT")
      let postedDate = todayStr();
      if (pubDate) {
        try { postedDate = new Date(pubDate).toISOString().split("T")[0]; } catch {}
      }

      return {
        title:            title || "MuleSoft Developer",
        company:          company || "Company via Indeed",
        location:         location || searchLocation || "USA",
        type:             "Full-time",
        experience:       "See posting",
        salary:           "Not specified",
        skills:           extractSkills(title + " " + desc),
        description:      desc || "See full job posting on Indeed for details.",
        posted:           postedLabel(postedDate),
        postedDate,
        source:           "Indeed",
        sourceType:       "jobboard",
        applyUrl:         link || "https://www.indeed.com/jobs?q=mulesoft+developer&sort=date",
        companyCareerUrl: "",
      };
    }).filter(j => j.title && j.title !== "MuleSoft Developer" || j.company !== "Company via Indeed");

    log(`📰 Indeed RSS: ${jobs.length} real MuleSoft jobs parsed ✅`, "success");
    return jobs;
  } catch (err) {
    log(`⚠️ Indeed RSS failed: ${err.message}`, "warn");

    // Fallback: try UK Indeed if US fails
    try {
      log("📰 Trying Indeed UK RSS...", "search");
      const { data } = await axios.get(
        "https://www.indeed.co.uk/rss?q=mulesoft&sort=date&fromage=14",
        { timeout: 12000, headers: { "User-Agent": "Mozilla/5.0 (compatible)" } }
      );
      const items = [...data.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      if (items.length > 0) {
        log(`📰 Indeed UK RSS: ${items.length} jobs`, "search");
      }
    } catch {}
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 2 — JSearch API via RapidAPI (optional — set JSEARCH_API_KEY in .env)
//  Free tier: 200 requests/month
//  Sign up: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeJSearch(searchLocation = "") {
  if (!JSEARCH_API_KEY) {
    log("ℹ️ JSearch: No API key set (optional) — skipping", "info");
    return [];
  }
  try {
    log("🔍 JSearch API: searching real MuleSoft jobs...", "search");
    const query = searchLocation && searchLocation !== "Anywhere"
      ? `mulesoft developer in ${searchLocation}`
      : "mulesoft developer";

    const { data } = await axios.get("https://jsearch.p.rapidapi.com/search", {
      params: { query, page: "1", num_b: "10", date_posted: "week" },
      headers: {
        "X-RapidAPI-Key":  JSEARCH_API_KEY,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
      timeout: 15000,
    });

    const jobs = data?.data || [];
    log(`🔍 JSearch: ${jobs.length} real MuleSoft jobs ✅`, "success");

    return jobs.map(j => {
      const postedDate = j.job_posted_at_datetime_utc
        ? new Date(j.job_posted_at_datetime_utc).toISOString().split("T")[0]
        : todayStr();
      return {
        title:            j.job_title,
        company:          j.employer_name,
        location:         j.job_is_remote ? "Remote" : `${j.job_city || ""}${j.job_city?", ":""}${j.job_country || ""}`.trim(),
        type:             j.job_employment_type || "Full-time",
        experience:       j.job_required_experience?.required_experience_in_months
                            ? `${Math.round(j.job_required_experience.required_experience_in_months/12)}+ years`
                            : "See posting",
        salary:           j.job_min_salary && j.job_max_salary
                            ? `$${Math.round(j.job_min_salary/1000)}k - $${Math.round(j.job_max_salary/1000)}k`
                            : "Not specified",
        skills:           extractSkills(j.job_title + " " + (j.job_description||"")),
        description:      (j.job_description||"").substring(0, 300),
        posted:           postedLabel(postedDate),
        postedDate,
        source:           j.job_publisher || "JSearch",
        sourceType:       "jobboard",
        applyUrl:         j.job_apply_link || j.job_google_link || "",
        companyCareerUrl: j.employer_website || "",
      };
    });
  } catch (err) {
    log(`⚠️ JSearch failed: ${err.message}`, "warn");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 3 — Remotive API (free remote tech jobs)
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
      const pd = j.publication_date ? new Date(j.publication_date).toISOString().split("T")[0] : todayStr();
      return {
        title:       j.title,
        company:     j.company_name,
        location:    j.candidate_required_location || "Remote",
        type:        j.job_type || "Full-time",
        experience:  "See posting",
        salary:      j.salary || "Not specified",
        skills:      extractSkills(j.title + " " + (j.description||"")),
        description: stripHtml(j.description||"").substring(0, 300),
        posted:      postedLabel(pd),
        postedDate:  pd,
        source:      "Remotive",
        sourceType:  "jobboard",
        applyUrl:    j.url || "https://remotive.com/remote-jobs",
        companyCareerUrl: "",
      };
    });
  } catch (e) { log(`⚠️ Remotive: ${e.message}`, "warn"); return []; }
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
      const t = `${j.title} ${j.description} ${(j.tags||[]).join(" ")}`.toLowerCase();
      return t.includes("mulesoft") || t.includes("anypoint");
    });
    log(`🌐 Arbeitnow: ${jobs.length} MuleSoft jobs`, "search");
    return jobs.map(j => {
      const pd = j.created_at ? new Date(j.created_at*1000).toISOString().split("T")[0] : todayStr();
      return {
        title:       j.title,
        company:     j.company_name || "See posting",
        location:    j.location || (j.remote ? "Remote" : "See posting"),
        type:        j.remote ? "Remote" : "Full-time",
        experience:  "See posting",
        salary:      "Not specified",
        skills:      extractSkills(j.title + " " + (j.description||"")),
        description: stripHtml(j.description||"").substring(0, 300),
        posted:      postedLabel(pd),
        postedDate:  pd,
        source:      "Arbeitnow",
        sourceType:  "jobboard",
        applyUrl:    j.url || "https://www.arbeitnow.com",
        companyCareerUrl: "",
      };
    });
  } catch (e) { log(`⚠️ Arbeitnow: ${e.message}`, "warn"); return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 5 — Greenhouse ATS (official company career boards)
// ─────────────────────────────────────────────────────────────────────────────
const GREENHOUSE_BOARDS = [
  { company:"Slalom",             board:"slalom"            },
  { company:"Thoughtworks",       board:"thoughtworks"      },
  { company:"Publicis Sapient",   board:"publicissapient"   },
  { company:"Perficient",         board:"perficient"        },
  { company:"EPAM Systems",       board:"epamsystems"       },
  { company:"Globant",            board:"globant"           },
  { company:"LTIMindtree",        board:"ltimindtree"       },
  { company:"Nagarro",            board:"nagarro"           },
  { company:"Mphasis",            board:"mphasis"           },
  { company:"Persistent Systems", board:"persistentsystems" },
  { company:"Coforge",            board:"coforge"           },
  { company:"Hexaware",           board:"hexaware"          },
];

async function scrapeGreenhouse(company, board) {
  try {
    const { data } = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
      { timeout: 10000 }
    );
    const hits = (data?.jobs||[]).filter(j => {
      const t = [j.title, j.content||"",...(j.departments||[]).map(d=>d.name)].join(" ").toLowerCase();
      return t.includes("mulesoft")||t.includes("anypoint")||t.includes("mule 4");
    });
    if (hits.length) log(`🏢 Greenhouse ${company}: ${hits.length} real jobs ✅`, "company");
    return hits.map(j => {
      const pd = j.updated_at ? new Date(j.updated_at).toISOString().split("T")[0] : todayStr();
      return {
        title:       j.title,
        company,
        location:    j.location?.name || "See posting",
        type:        "Full-time",
        experience:  "See posting",
        salary:      "Not specified",
        skills:      extractSkills(j.title + " " + (j.content||"")),
        description: stripHtml(j.content||"").substring(0, 300) || "See full posting.",
        posted:      postedLabel(pd),
        postedDate:  pd,
        source:      `${company} Careers`,
        sourceType:  "official",
        applyUrl:    j.absolute_url || `https://boards.greenhouse.io/${board}`,
        companyCareerUrl: `https://boards.greenhouse.io/${board}`,
      };
    });
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 6 — Lever ATS
// ─────────────────────────────────────────────────────────────────────────────
const LEVER_BOARDS = [
  { company:"Ness Digital", board:"nessdigital" },
  { company:"Synechron",    board:"synechron"   },
  { company:"Nisum",        board:"nisum"       },
  { company:"Xoriant",      board:"xoriant"     },
];

async function scrapeLever(company, board) {
  try {
    const { data } = await axios.get(`https://api.lever.co/v0/postings/${board}?mode=json`,{ timeout:10000 });
    const hits = (Array.isArray(data)?data:[]).filter(j=>{
      const t=[j.text||"",j.descriptionPlain||"",j.categories?.team||""].join(" ").toLowerCase();
      return t.includes("mulesoft")||t.includes("anypoint")||t.includes("mule 4");
    });
    if (hits.length) log(`🏢 Lever ${company}: ${hits.length} real jobs ✅`, "company");
    return hits.map(j=>{
      const pd=j.createdAt?new Date(j.createdAt).toISOString().split("T")[0]:todayStr();
      return {
        title:       j.text,
        company,
        location:    j.categories?.location||"Not specified",
        type:        j.categories?.commitment||"Full-time",
        experience:  j.categories?.level||"See posting",
        salary:      "Not specified",
        skills:      extractSkills(j.text+" "+(j.descriptionPlain||"")),
        description: (j.descriptionPlain||"See posting.").substring(0,300),
        posted:      postedLabel(pd),
        postedDate:  pd,
        source:      `${company} Careers`,
        sourceType:  "official",
        applyUrl:    j.hostedUrl||`https://jobs.lever.co/${board}`,
        companyCareerUrl:`https://jobs.lever.co/${board}`,
      };
    });
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 7 — Groq AI (fill-in with REAL today's date — NEVER 2024)
// ─────────────────────────────────────────────────────────────────────────────
async function generateWithGroq(filters={}, existingCount=0) {
  if (!GROQ_API_KEY) return [];
  const needed = Math.max(5, 14 - existingCount);
  const today  = todayStr();
  const week   = daysAgoStr(7);

  try {
    log(`🤖 Groq: generating ${needed} fresh jobs (${week} → ${today})...`, "groq");
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
        temperature: 0.85,
        messages: [
          {
            role: "system",
            content: `Job data generator. TODAY = ${today}. STRICT RULE: postedDate MUST be between ${week} and ${today}. NEVER use any 2024 date. Return ONLY valid JSON array.`,
          },
          {
            role: "user",
            content: `Generate ${needed} realistic MuleSoft jobs. Mix of experience levels (not all Lead/Architect).
            
Location: ${filters.location||"Global"}
Type: ${filters.type||"All"}
Experience: ${filters.experience||"All"}

RULES:
- postedDate between ${week} and ${today} ONLY
- Mix: Junior (1-2yr), Mid-level (3-5yr), Senior (5-8yr), Lead (8yr+)
- Mix salary ranges: entry $70k-90k, mid $90k-120k, senior $120k-150k, lead $150k-200k
- Real companies (not all Fortune 500): include mid-size consultancies too
- sourceType "official" or "jobboard" (mix both)
- Varied locations matching filter

Fields: title,company,location,type,experience,salary,skills(4-6 array),description(2 sentences),posted,postedDate,source,sourceType,applyUrl,companyCareerUrl

Return ONLY JSON array.`,
          },
        ],
      },
      { headers: { Authorization:`Bearer ${GROQ_API_KEY}`, "Content-Type":"application/json" }, timeout:35000 }
    );
    const txt   = res.data?.choices?.[0]?.message?.content||"";
    const match = txt.match(/\[[\s\S]*\]/);
    if (match) {
      const jobs = JSON.parse(match[0]);
      // Safety net: fix any stale dates
      return jobs.map(j => {
        const pd = j.postedDate;
        if (!pd || new Date(pd) < new Date(week) || new Date(pd) > new Date(today)) {
          const rd = daysAgoStr(Math.floor(Math.random()*7));
          return { ...j, postedDate:rd, posted:postedLabel(rd) };
        }
        return { ...j, posted: postedLabel(pd) };
      });
    }
  } catch (e) { log(`⚠️ Groq: ${e.message}`, "warn"); }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN PIPELINE
// ─────────────────────────────────────────────────────────────────────────────
async function runScraper(filters={}) {
  if (isScrapingNow) { log("Already running","warn"); return jobCache; }
  isScrapingNow = true;
  scrapeLog = [];

  try {
    log(`🚀 Pipeline v4 — TODAY is ${todayStr()}`, "system");
    log(`📍 Filters: ${JSON.stringify(filters)}`, "info");
    const all = [];

    // Phase 1: Indeed RSS — REAL jobs (highest priority)
    log("─── Phase 1: Indeed RSS Feed ─────────────", "system");
    const indeedJobs = await scrapeIndeedRSS(filters.location);
    all.push(...indeedJobs);
    log(`✅ Indeed RSS: ${indeedJobs.length} real jobs`, "success");

    // Phase 2: JSearch (if key provided)
    log("─── Phase 2: JSearch API ─────────────────", "system");
    const jsearchJobs = await scrapeJSearch(filters.location);
    all.push(...jsearchJobs);

    // Phase 3: Remotive + Arbeitnow in parallel
    log("─── Phase 3: Remotive + Arbeitnow ───────", "system");
    const [rem, arb] = await Promise.all([scrapeRemotive(), scrapeArbeitnow()]);
    all.push(...rem, ...arb);

    // Phase 4: Greenhouse + Lever in parallel
    log("─── Phase 4: Greenhouse + Lever ATS ─────", "system");
    const [ghResults, lvResults] = await Promise.all([
      Promise.allSettled(GREENHOUSE_BOARDS.map(({company,board})=>scrapeGreenhouse(company,board))),
      Promise.allSettled(LEVER_BOARDS.map(({company,board})=>scrapeLever(company,board))),
    ]);
    ghResults.forEach(r=>r.status==="fulfilled"&&all.push(...r.value));
    lvResults.forEach(r=>r.status==="fulfilled"&&all.push(...r.value));

    log(`✅ All real sources done: ${all.length} total raw jobs`, "success");

    // Deduplicate
    const seen   = new Set();
    const unique = all.filter(j => {
      if (!j.title) return false;
      const k = `${j.title.toLowerCase()}-${j.company.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    log(`🔄 After dedup: ${unique.length} unique jobs`, "info");

    // Phase 5: Groq fill-in
    log("─── Phase 5: Groq AI Fill-in ─────────────", "system");
    const groqJobs = await generateWithGroq(filters, unique.length);
    let combined   = [...unique, ...groqJobs];

    // Apply filters
    if (filters.location && filters.location !== "Anywhere") {
      const lf = combined.filter(j=>
        j.location?.toLowerCase().includes(filters.location.toLowerCase())||
        j.location?.toLowerCase().includes("remote")||
        j.type?.toLowerCase()==="remote"
      );
      if (lf.length > 0) combined = lf;
    }
    if (filters.type && filters.type !== "All") {
      const tf = combined.filter(j=>j.type?.toLowerCase().includes(filters.type.toLowerCase()));
      if (tf.length > 0) combined = tf;
    }

    // Sort: official first → newest date first
    combined.sort((a,b)=>{
      if (a.sourceType==="official"&&b.sourceType!=="official") return -1;
      if (b.sourceType==="official"&&a.sourceType!=="official") return 1;
      return new Date(b.postedDate||"2000-01-01")-new Date(a.postedDate||"2000-01-01");
    });

    const off = combined.filter(j=>j.sourceType==="official").length;
    const brd = combined.length - off;
    const real = unique.length;
    const ai   = groqJobs.length;

    log(`🎯 DONE: ${combined.length} jobs (${real} real scraped + ${ai} AI-filled)`, "success");
    log(`📊 ${off} official sites + ${brd} job boards`, "info");
    log(`📅 Date range: ${daysAgoStr(7)} to ${todayStr()}`, "info");
    log("✅ Results ready!", "success");

    jobCache      = combined;
    lastScrapedAt = new Date().toISOString();
    return combined;

  } catch (err) {
    log(`❌ Pipeline error: ${err.message}`, "warn");
    return jobCache.length > 0 ? jobCache : await generateWithGroq(filters, 0);
  } finally {
    isScrapingNow = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/jobs", async (req,res)=>{
  const filters = { location:req.query.location||"Anywhere", type:req.query.type||"All", experience:req.query.experience||"Any Level" };
  if (jobCache.length>0&&lastScrapedAt&&Date.now()-new Date(lastScrapedAt)<3*60*60*1000)
    return res.json({ jobs:jobCache, lastScrapedAt, source:"cache", count:jobCache.length });
  const jobs = await runScraper(filters);
  res.json({ jobs, lastScrapedAt, source:"fresh", count:jobs.length });
});

app.post("/api/scrape",(req,res)=>{
  if (isScrapingNow) return res.json({ status:"already_running", jobs:jobCache });
  runScraper(req.body||{}).catch(console.error);
  res.json({ status:"started" });
});

app.get("/api/status",(req,res)=>{
  res.json({ isScrapingNow, lastScrapedAt, jobCount:jobCache.length, today:todayStr(), logs:scrapeLog.slice(-40) });
});

app.get("/",(req,res)=>{
  res.json({ service:"MuleSoft Job Scanner API v4", status:"running", today:todayStr(), lastScraped:lastScrapedAt, cachedJobs:jobCache.length, sources:["Indeed RSS","JSearch (optional)","Remotive","Arbeitnow","Greenhouse ATS","Lever ATS","Groq AI"] });
});

app.listen(PORT,()=>{
  console.log(`\n🚀 MuleSoft Job Scanner API v4 — port ${PORT}`);
  console.log(`📅 Today: ${todayStr()}`);
  console.log(`📡 Sources: Indeed RSS · Remotive · Arbeitnow · Greenhouse · Lever · Groq AI\n`);
  setTimeout(()=>runScraper().catch(console.error), 2000);
  setInterval(()=>{ if(!isScrapingNow) runScraper().catch(console.error); }, 3*60*60*1000);
});
