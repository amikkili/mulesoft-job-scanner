// ─────────────────────────────────────────────────────────────────────────────
//  MuleSoft Job Scanner — Backend Server
//  Stack: Express + Puppeteer + Axios + Groq AI
//  Scrapes: Greenhouse ATS · Lever ATS · Indeed · Company career pages
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const axios    = require("axios");
const puppeteer = require("puppeteer");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://mulesoft-job-scanner.onrender.com" 
  ]
}));
app.use(express.json());

// ── In-memory state ──────────────────────────────────────────────────────────
let jobCache      = [];
let lastScrapedAt = null;
let isScrapingNow = false;
let scrapeLog     = [];   // live log lines for frontend polling

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

function log(msg, type = "info") {
  const entry = { msg, type, time: new Date().toLocaleTimeString() };
  scrapeLog.push(entry);
  if (scrapeLog.length > 100) scrapeLog.shift();   // keep last 100 lines
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 1 — Greenhouse ATS (public JSON API — no Puppeteer needed)
//  Many consulting/tech companies host their careers on boards.greenhouse.io
// ─────────────────────────────────────────────────────────────────────────────
const GREENHOUSE_BOARDS = [
  { company: "Slalom",            board: "slalom"           },
  { company: "Thoughtworks",      board: "thoughtworks"     },
  { company: "Publicis Sapient",  board: "publicissapient"  },
  { company: "Hexaware",          board: "hexaware"         },
  { company: "Mphasis",           board: "mphasis"          },
  { company: "EPAM Systems",      board: "epamsystems"      },
  { company: "Globant",           board: "globant"          },
  { company: "Perficient",        board: "perficient"       },
  { company: "Infosys BPM",       board: "infosysbpm"       },
  { company: "LTIMindtree",       board: "ltimindtree"      },
  { company: "Birlasoft",         board: "birlasoft"        },
  { company: "Mastech Digital",   board: "mastechdigital"   },
];

async function scrapeGreenhouse(company, board) {
  try {
    const { data } = await axios.get(
      `https://boards.greenhouse.io/${board}/jobs.json`,
      { timeout: 12000 }
    );
    const jobs = data?.jobs || [];
    const mulesoftJobs = jobs.filter(j => {
      const text = `${j.title} ${j.departments?.map(d => d.name).join(" ")}`.toLowerCase();
      return text.includes("mulesoft") || text.includes("mule") || text.includes("anypoint");
    });
    log(`🏢 Greenhouse → ${company}: ${mulesoftJobs.length} MuleSoft jobs`, "company");
    return mulesoftJobs.map(j => ({
      title:            j.title,
      company,
      location:         j.location?.name || "Not specified",
      type:             "Full-time",
      experience:       "See posting",
      salary:           "Not specified",
      skills:           ["MuleSoft", "Anypoint Platform", "Integration"],
      description:      (j.content || "")
                          .replace(/<[^>]*>/g, " ")
                          .replace(/\s+/g, " ")
                          .trim()
                          .substring(0, 220) + "…",
      posted:           "Recently",
      source:           `${company} Careers`,
      sourceType:       "official",
      applyUrl:         j.absolute_url || `https://boards.greenhouse.io/${board}`,
      companyCareerUrl: `https://boards.greenhouse.io/${board}`,
    }));
  } catch (err) {
    log(`⚠️  Greenhouse ${company}: ${err.message}`, "warn");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 2 — Lever ATS (public JSON API)
// ─────────────────────────────────────────────────────────────────────────────
const LEVER_BOARDS = [
  { company: "Ness Digital Engineering", board: "nessdigital"      },
  { company: "Softchoice",               board: "softchoice"       },
  { company: "Levi9",                    board: "levi9"            },
  { company: "Nagarro",                  board: "nagarro"          },
  { company: "Synechron",                board: "synechron"        },
];

async function scrapeLever(company, board) {
  try {
    const { data } = await axios.get(
      `https://api.lever.co/v0/postings/${board}?mode=json`,
      { timeout: 12000 }
    );
    const jobs = Array.isArray(data) ? data : [];
    const mulesoftJobs = jobs.filter(j => {
      const text = `${j.text} ${j.categories?.team || ""} ${j.descriptionPlain || ""}`.toLowerCase();
      return text.includes("mulesoft") || text.includes("mule") || text.includes("anypoint");
    });
    log(`🏢 Lever → ${company}: ${mulesoftJobs.length} MuleSoft jobs`, "company");
    return mulesoftJobs.map(j => ({
      title:            j.text,
      company,
      location:         j.categories?.location || j.categories?.allLocations?.[0] || "Not specified",
      type:             j.categories?.commitment || "Full-time",
      experience:       j.categories?.level || "See posting",
      salary:           "Not specified",
      skills:           ["MuleSoft", "Integration", "API Development"],
      description:      (j.descriptionPlain || "").substring(0, 220) + "…",
      posted:           "Recently",
      source:           `${company} Careers`,
      sourceType:       "official",
      applyUrl:         j.hostedUrl || `https://jobs.lever.co/${board}`,
      companyCareerUrl: `https://jobs.lever.co/${board}`,
    }));
  } catch (err) {
    log(`⚠️  Lever ${company}: ${err.message}`, "warn");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 3 — Puppeteer: scrape Indeed search results
//  (public job board — no login needed for search results page)
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeIndeed(searchLocation = "") {
  let browser;
  try {
    log("🌐 Puppeteer launching for Indeed...", "search");
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
    });

    const page = await browser.newPage();

    // Set a realistic user agent so we look like a real browser
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    const locParam = searchLocation && searchLocation !== "Anywhere"
      ? encodeURIComponent(searchLocation)
      : "";
    const url = `https://www.indeed.com/jobs?q=mulesoft+developer&l=${locParam}&sort=date&fromage=30`;

    log(`🔎 Indeed URL: ${url}`, "search");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });

    // Wait for job cards to appear
    await page.waitForSelector('[data-jk], .job_seen_beacon, .tapItem', {
      timeout: 10000,
    }).catch(() => {});

    // Extract job card data from the DOM
    const rawJobs = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-jk], .job_seen_beacon, .tapItem')
      ).slice(0, 15);

      return cards.map(card => {
        const titleEl   = card.querySelector('[class*="jobTitle"] a, h2 a, [data-testid="jobTitle"]');
        const companyEl = card.querySelector('[data-testid="company-name"], .companyName');
        const locationEl= card.querySelector('[data-testid="text-location"], .companyLocation');
        const salaryEl  = card.querySelector('[class*="salary"], [class*="Salary"]');
        const snippetEl = card.querySelector('[class*="job-snippet"], .job-snippet');
        const jk        = card.getAttribute("data-jk") || "";

        return {
          title:    titleEl?.textContent?.trim()   || "",
          company:  companyEl?.textContent?.trim() || "",
          location: locationEl?.textContent?.trim()|| "",
          salary:   salaryEl?.textContent?.trim()  || "Not specified",
          snippet:  snippetEl?.textContent?.trim() || "",
          jk,
        };
      }).filter(j => j.title && j.company);
    });

    log(`🔎 Indeed: scraped ${rawJobs.length} raw job cards`, "search");

    return rawJobs.map(j => ({
      title:            j.title,
      company:          j.company,
      location:         j.location || "USA",
      type:             "Full-time",
      experience:       "See posting",
      salary:           j.salary,
      skills:           ["MuleSoft", "Integration", "Anypoint Platform"],
      description:      j.snippet || "See job posting for full details.",
      posted:           "Recently",
      source:           "Indeed",
      sourceType:       "jobboard",
      applyUrl:         j.jk
                          ? `https://www.indeed.com/viewjob?jk=${j.jk}`
                          : "https://www.indeed.com/jobs?q=mulesoft+developer",
      companyCareerUrl: "",
    }));
  } catch (err) {
    log(`⚠️  Indeed scrape failed: ${err.message}`, "warn");
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 4 — Puppeteer: scrape LinkedIn Jobs (public search only)
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeLinkedIn(searchLocation = "") {
  let browser;
  try {
    log("🌐 Puppeteer launching for LinkedIn...", "search");
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox",
             "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    const loc = searchLocation && searchLocation !== "Anywhere" ? searchLocation : "worldwide";
    const url = `https://www.linkedin.com/jobs/search/?keywords=mulesoft%20developer&location=${encodeURIComponent(loc)}&sortBy=DD`;
    log(`🔎 LinkedIn URL: ${url}`, "search");

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForSelector(".base-card, .jobs-search__results-list li", {
      timeout: 10000,
    }).catch(() => {});

    const rawJobs = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll(".base-card, .jobs-search__results-list li")
      ).slice(0, 12);

      return cards.map(card => ({
        title:    card.querySelector(".base-search-card__title, h3")?.textContent?.trim() || "",
        company:  card.querySelector(".base-search-card__subtitle, h4")?.textContent?.trim() || "",
        location: card.querySelector(".job-search-card__location, .base-search-card__metadata span")?.textContent?.trim() || "",
        link:     card.querySelector("a.base-card__full-link, a[href*='/jobs/view/']")?.href || "",
        meta:     card.querySelector(".job-search-card__benefits, .base-search-card__metadata")?.textContent?.trim() || "",
      })).filter(j => j.title && j.company);
    });

    log(`🔎 LinkedIn: scraped ${rawJobs.length} job cards`, "search");

    return rawJobs.map(j => ({
      title:            j.title,
      company:          j.company,
      location:         j.location || "Not specified",
      type:             "Full-time",
      experience:       "See posting",
      salary:           j.meta || "Not specified",
      skills:           ["MuleSoft", "Integration", "API Development"],
      description:      "See LinkedIn for full job description and requirements.",
      posted:           "Recently",
      source:           "LinkedIn",
      sourceType:       "jobboard",
      applyUrl:         j.link || "https://www.linkedin.com/jobs/search/?keywords=mulesoft",
      companyCareerUrl: "",
    }));
  } catch (err) {
    log(`⚠️  LinkedIn scrape failed: ${err.message}`, "warn");
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOURCE 5 — Puppeteer: scrape Dice.com
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeDice(searchLocation = "") {
  let browser;
  try {
    log("🌐 Puppeteer launching for Dice...", "search");
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox",
             "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    const url = `https://www.dice.com/jobs?q=mulesoft&location=${encodeURIComponent(searchLocation || "")}&filters.postedDate=ONE_WEEK`;
    log(`🔎 Dice URL: ${url}`, "search");

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-cy="card-title-link"], .card", .search-card', {
      timeout: 10000,
    }).catch(() => {});

    const rawJobs = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-cy="card"], .search-card, dhi-search-card')
      ).slice(0, 10);

      return cards.map(card => ({
        title:    card.querySelector('[data-cy="card-title-link"], h5')?.textContent?.trim() || "",
        company:  card.querySelector('[data-cy="search-result-company-name"], a[href*="company"]')?.textContent?.trim() || "",
        location: card.querySelector('[data-cy="search-result-location"], [class*="location"]')?.textContent?.trim() || "",
        type:     card.querySelector('[class*="employment-type"], [data-cy="employment-type"]')?.textContent?.trim() || "Full-time",
        link:     card.querySelector('[data-cy="card-title-link"]')?.href || "",
      })).filter(j => j.title);
    });

    log(`🔎 Dice: scraped ${rawJobs.length} job cards`, "search");

    return rawJobs.map(j => ({
      title:            j.title,
      company:          j.company || "See posting",
      location:         j.location || "USA",
      type:             j.type || "Contract",
      experience:       "See posting",
      salary:           "Not specified",
      skills:           ["MuleSoft", "Anypoint", "Integration", "REST APIs"],
      description:      "See Dice.com for full job description and requirements.",
      posted:           "This week",
      source:           "Dice",
      sourceType:       "jobboard",
      applyUrl:         j.link || "https://www.dice.com/jobs?q=mulesoft",
      companyCareerUrl: "",
    }));
  } catch (err) {
    log(`⚠️  Dice scrape failed: ${err.message}`, "warn");
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  AI ENRICHMENT — Use Groq to fill missing fields & standardise data
// ─────────────────────────────────────────────────────────────────────────────
async function enrichWithGroq(jobs, filters) {
  if (!GROQ_API_KEY || jobs.length === 0) return jobs;
  try {
    log("🧠 Groq AI enriching job data...", "groq");
    const sample = jobs.slice(0, 8);   // enrich first 8 only to save tokens
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        max_tokens: 3000,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: "You are a job data enricher. Given raw scraped job data, fill in missing fields intelligently based on context. Return ONLY valid JSON array, no extra text.",
          },
          {
            role: "user",
            content: `Enrich these MuleSoft job listings. For each job:
- Estimate salary range based on company, location, and experience level
- Add 4-6 relevant MuleSoft skills (DataWeave, CloudHub, Anypoint Studio, REST APIs, etc.)
- Improve description if it's just "See posting"
- Infer experience level (Junior/Mid-level/Senior/Lead) from title and description

Return the SAME array structure with enriched fields. ONLY return JSON array:
${JSON.stringify(sample, null, 2)}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const text = res.data?.choices?.[0]?.message?.content || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const enriched = JSON.parse(match[0]);
      // merge enriched first 8 with remaining jobs
      return [...enriched, ...jobs.slice(8)];
    }
  } catch (err) {
    log(`⚠️  Groq enrichment skipped: ${err.message}`, "warn");
  }
  return jobs;
}

// ─────────────────────────────────────────────────────────────────────────────
//  FALLBACK — If real scraping finds nothing, use Groq to generate jobs
// ─────────────────────────────────────────────────────────────────────────────
async function generateJobsWithGroq(filters) {
  if (!GROQ_API_KEY) return [];
  try {
    log("🤖 Generating jobs with Groq AI (fallback)...", "groq");
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: "You are a job market expert. Generate realistic MuleSoft job listings based on current market knowledge. Return ONLY a valid JSON array.",
          },
          {
            role: "user",
            content: `Generate 12 realistic current MuleSoft developer job listings for:
- Location: ${filters.location || "Global"}
- Type: ${filters.type || "All"}
- Experience: ${filters.experience || "All levels"}

Return JSON array with fields: title, company, location, type, experience, salary, skills (array), description, posted, source, sourceType ("official" or "jobboard"), applyUrl, companyCareerUrl

Use real companies: Accenture, Deloitte, IBM, Capgemini, Wipro, TCS, Cognizant, Salesforce, PwC, HCL, Amazon, Microsoft.
Use realistic salaries for the region. Return ONLY the JSON array.`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    const text = res.data?.choices?.[0]?.message?.content || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    log(`⚠️  Groq generation failed: ${err.message}`, "warn");
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN SCRAPING PIPELINE
// ─────────────────────────────────────────────────────────────────────────────
async function runScraper(filters = {}) {
  if (isScrapingNow) {
    log("⚠️  Scraper already running — skipping", "warn");
    return jobCache;
  }

  isScrapingNow = true;
  scrapeLog = [];
  const all = [];

  try {
    log("🚀 MuleSoft Job Scanner pipeline starting...", "system");
    log(`📍 Filters: location=${filters.location||"Any"}, type=${filters.type||"All"}, exp=${filters.experience||"All"}`, "info");

    // ── Phase 1: ATS JSON APIs (fast, no Puppeteer) ───────────────────────
    log("─── Phase 1: ATS APIs (Greenhouse & Lever) ───", "system");
    for (const { company, board } of GREENHOUSE_BOARDS) {
      const jobs = await scrapeGreenhouse(company, board);
      all.push(...jobs);
    }
    for (const { company, board } of LEVER_BOARDS) {
      const jobs = await scrapeLever(company, board);
      all.push(...jobs);
    }
    log(`✅ Phase 1 complete: ${all.length} jobs from ATS boards`, "success");

    // ── Phase 2: Puppeteer scraping ───────────────────────────────────────
    log("─── Phase 2: Puppeteer Web Scraping ───", "system");

    const indeedJobs = await scrapeIndeed(filters.location);
    all.push(...indeedJobs);

    const linkedInJobs = await scrapeLinkedIn(filters.location);
    all.push(...linkedInJobs);

    const diceJobs = await scrapeDice(filters.location);
    all.push(...diceJobs);

    log(`✅ Phase 2 complete: ${indeedJobs.length + linkedInJobs.length + diceJobs.length} jobs from web scraping`, "success");

    // ── Phase 3: Deduplicate ──────────────────────────────────────────────
    log("─── Phase 3: Deduplication ───", "system");
    const seen = new Set();
    const unique = all.filter(j => {
      if (!j.title || !j.company) return false;
      const key = `${j.title.toLowerCase().trim()}-${j.company.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    log(`🔄 Deduplicated: ${all.length} → ${unique.length} unique jobs`, "info");

    // ── Phase 4: AI Enrichment or Fallback ───────────────────────────────
    log("─── Phase 4: AI Enrichment ───", "system");
    let finalJobs = unique;

    if (unique.length < 5) {
      log("📉 Low real results — using Groq to generate jobs...", "warn");
      finalJobs = await generateJobsWithGroq(filters);
    } else {
      finalJobs = await enrichWithGroq(unique, filters);
    }

    // ── Phase 5: Sort & Filter ───────────────────────────────────────────
    log("─── Phase 5: Sort & Filter ───", "system");

    // Apply location filter
    if (filters.location && filters.location !== "Anywhere") {
      finalJobs = finalJobs.filter(j =>
        j.location?.toLowerCase().includes(filters.location.toLowerCase()) ||
        j.location?.toLowerCase().includes("remote") ||
        j.location?.toLowerCase().includes("worldwide") ||
        j.location?.toLowerCase().includes("global")
      );
      if (finalJobs.length === 0) finalJobs = unique; // fallback: no filter
    }

    // Apply type filter
    if (filters.type && filters.type !== "All") {
      const tf = finalJobs.filter(j =>
        j.type?.toLowerCase().includes(filters.type.toLowerCase())
      );
      if (tf.length > 0) finalJobs = tf;
    }

    // Sort: official company sites first, then job boards
    finalJobs.sort((a, b) => {
      if (a.sourceType === "official" && b.sourceType !== "official") return -1;
      if (b.sourceType === "official" && a.sourceType !== "official") return 1;
      return 0;
    });

    const officialCount = finalJobs.filter(j => j.sourceType === "official").length;
    const boardCount    = finalJobs.length - officialCount;

    log(`🎯 Final: ${finalJobs.length} jobs (${officialCount} official + ${boardCount} job boards)`, "success");
    log("✅ Scraping pipeline complete! Results ready.", "success");

    jobCache      = finalJobs;
    lastScrapedAt = new Date().toISOString();
    return finalJobs;

  } catch (err) {
    log(`❌ Pipeline error: ${err.message}`, "warn");
    return jobCache.length > 0 ? jobCache : await generateJobsWithGroq(filters);
  } finally {
    isScrapingNow = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/jobs — return cached results or trigger fresh scrape
app.get("/api/jobs", async (req, res) => {
  const filters = {
    location:   req.query.location   || "Anywhere",
    type:       req.query.type       || "All",
    experience: req.query.experience || "Any Level",
  };

  if (jobCache.length > 0 && lastScrapedAt) {
    // Return cache if it's less than 6 hours old
    const ageMs = Date.now() - new Date(lastScrapedAt).getTime();
    if (ageMs < 6 * 60 * 60 * 1000) {
      return res.json({
        jobs:         jobCache,
        lastScrapedAt,
        source:       "cache",
        count:        jobCache.length,
      });
    }
  }

  const jobs = await runScraper(filters);
  res.json({ jobs, lastScrapedAt, source: "fresh", count: jobs.length });
});

// POST /api/scrape — force a fresh scrape (used by frontend scan button)
app.post("/api/scrape", async (req, res) => {
  const filters = req.body || {};
  if (isScrapingNow) {
    return res.json({ status: "already_running", jobs: jobCache });
  }
  // Run scraper async — frontend polls /api/status for progress
  runScraper(filters).catch(console.error);
  res.json({ status: "started", message: "Scraping pipeline started. Poll /api/status for progress." });
});

// GET /api/status — returns live log + current state (frontend polls this)
app.get("/api/status", (req, res) => {
  res.json({
    isScrapingNow,
    lastScrapedAt,
    jobCount:   jobCache.length,
    status:     isScrapingNow ? "scraping" : "idle",
    logs:       scrapeLog.slice(-30),  // last 30 log lines
  });
});

// GET /api/logs — returns full scrape log
app.get("/api/logs", (req, res) => {
  res.json({ logs: scrapeLog });
});

// GET / — health check
app.get("/", (req, res) => {
  res.json({
    service:      "MuleSoft Job Scanner API",
    version:      "2.0.0",
    status:       "running",
    lastScraped:  lastScrapedAt,
    cachedJobs:   jobCache.length,
    endpoints: ["/api/jobs", "/api/scrape", "/api/status", "/api/logs"],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  START SERVER + SCHEDULED AUTO-SCRAPE every 6 hours
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 MuleSoft Job Scanner backend running on port ${PORT}`);
  console.log(`📡 Endpoints: GET /api/jobs  POST /api/scrape  GET /api/status`);

  // Initial scrape on startup (after 3 seconds)
  setTimeout(() => {
    console.log("⚡ Running initial scrape on startup...");
    runScraper().catch(console.error);
  }, 3000);

  // Auto-scrape every 6 hours
  setInterval(() => {
    if (!isScrapingNow) {
      console.log("⏰ Scheduled scrape triggered (6h interval)");
      runScraper().catch(console.error);
    }
  }, 6 * 60 * 60 * 1000);
});
