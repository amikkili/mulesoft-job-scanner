import { useState, useEffect, useRef } from "react";

// ── Point this at your Render backend URL after deploying ────────────────────
// In development: http://localhost:3001
// In production:  https://mulesoft-job-scanner-api.onrender.com
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

const FILTERS    = ["All", "Remote", "On-site", "Hybrid", "Contract", "Full-time"];
const LOCATIONS  = ["Anywhere", "USA", "UK", "India", "Canada", "Australia", "Europe"];
const EXPERIENCE = ["Any Level", "Junior", "Mid-level", "Senior", "Lead/Architect"];

const COMPANY_SITES = [
  { name:"Accenture",  url:"https://www.accenture.com/us-en/careers/jobsearch?jk=mulesoft",              color:"#a855f7" },
  { name:"Deloitte",   url:"https://apply.deloitte.com/careers/SearchJobs/mulesoft",                     color:"#3b82f6" },
  { name:"IBM",        url:"https://www.ibm.com/employment/#jobs?q=mulesoft",                            color:"#2563eb" },
  { name:"Capgemini",  url:"https://www.capgemini.com/jobs/?s=mulesoft",                                 color:"#0ea5e9" },
  { name:"Wipro",      url:"https://careers.wipro.com/careers-home/jobs?q=mulesoft",                    color:"#10b981" },
  { name:"Infosys",    url:"https://career.infosys.com/joblist",                                        color:"#f59e0b" },
  { name:"TCS",        url:"https://ibegin.tcs.com/iBegin/jobs/search?query=mulesoft",                  color:"#ef4444" },
  { name:"Cognizant",  url:"https://careers.cognizant.com/global/en/search-results?keywords=mulesoft",  color:"#8b5cf6" },
  { name:"Salesforce", url:"https://salesforce.wd1.myworkdayjobs.com/External_Career_Site?q=mulesoft",  color:"#38bdf8" },
  { name:"PwC",        url:"https://www.pwc.com/gx/en/careers/job-search.html#q=mulesoft",             color:"#f97316" },
  { name:"Slalom",     url:"https://boards.greenhouse.io/slalom",                                       color:"#84cc16" },
  { name:"Thoughtworks",url:"https://boards.greenhouse.io/thoughtworks",                                color:"#ec4899" },
];

const SOURCE_COLORS = {
  "Accenture":"#a855f7","Deloitte":"#3b82f6","IBM":"#2563eb","Capgemini":"#0ea5e9",
  "Wipro":"#10b981","Infosys":"#f59e0b","TCS":"#ef4444","Cognizant":"#8b5cf6",
  "Salesforce":"#38bdf8","PwC":"#f97316","Slalom":"#84cc16","Thoughtworks":"#ec4899",
  "LinkedIn":"#0e76a9","Indeed":"#2164f3","Dice":"#ff6b35","Glassdoor":"#0caa41",
  "Greenhouse":"#24d05a","Lever":"#1f6feb",
};

const TYPE_COLORS = {
  "Full-time":{ bg:"#dcfce7", text:"#15803d", border:"#86efac" },
  "Remote":   { bg:"#dbeafe", text:"#1d4ed8", border:"#93c5fd" },
  "Contract": { bg:"#fef3c7", text:"#b45309", border:"#fcd34d" },
  "Hybrid":   { bg:"#f3e8ff", text:"#7e22ce", border:"#d8b4fe" },
  "On-site":  { bg:"#fee2e2", text:"#b91c1c", border:"#fca5a5" },
};

const LOG_COLORS = {
  info:"#94a3b8", search:"#38bdf8", success:"#4ade80",
  warn:"#fb923c", system:"#c084fc", company:"#f59e0b", groq:"#a3e635",
};

const getTypeStyle = t => {
  for(const k of Object.keys(TYPE_COLORS))
    if(t?.toLowerCase().includes(k.toLowerCase())) return TYPE_COLORS[k];
  return { bg:"#f1f5f9", text:"#475569", border:"#cbd5e1" };
};
const getSourceColor = s => {
  for(const k of Object.keys(SOURCE_COLORS))
    if(s?.toLowerCase().includes(k.toLowerCase())) return SOURCE_COLORS[k];
  return "#64748b";
};

export default function MuleSoftJobScanner() {
  const [jobs,        setJobs]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [agentLog,    setAgentLog]    = useState([]);
  const [filter,      setFilter]      = useState("All");
  const [location,    setLocation]    = useState("Anywhere");
  const [experience,  setExperience]  = useState("Any Level");
  const [searched,    setSearched]    = useState(false);
  const [expandedJob, setExpandedJob] = useState(null);
  const [activeTab,   setActiveTab]   = useState("all");
  const [savedJobs,   setSavedJobs]   = useState([]);
  const [backendOk,   setBackendOk]   = useState(null);  // null=checking, true/false
  const [lastScraped, setLastScraped] = useState(null);
  const logRef    = useRef(null);
  const pollRef   = useRef(null);

  // ── Check if backend is reachable on mount ─────────────────────────────
  useEffect(() => {
    fetch(`${BACKEND_URL}/`)
      .then(r => r.json())
      .then(d => {
        setBackendOk(true);
        if (d.lastScraped) setLastScraped(d.lastScraped);
      })
      .catch(() => setBackendOk(false));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [agentLog]);

  // Stop polling on unmount
  useEffect(() => () => { if(pollRef.current) clearInterval(pollRef.current); }, []);

  const addLog = (msg, type = "info") =>
    setAgentLog(p => [...p, { msg, type, time: new Date().toLocaleTimeString() }]);

  const toggleSave = (job, e) => {
    e.stopPropagation();
    setSavedJobs(prev => {
      const exists = prev.find(j => j.title===job.title && j.company===job.company);
      return exists
        ? prev.filter(j => !(j.title===job.title && j.company===job.company))
        : [...prev, job];
    });
  };
  const isSaved = job => savedJobs.some(j => j.title===job.title && j.company===job.company);

  // ── Poll backend /api/status while scraping is running ─────────────────
  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${BACKEND_URL}/api/status`);
        const data = await res.json();

        // Sync live logs from backend
        if (data.logs?.length) {
          setAgentLog(data.logs.slice(-30));
        }

        if (!data.isScrapingNow) {
          // Scraping finished — fetch results
          clearInterval(pollRef.current);
          const jobsRes  = await fetch(`${BACKEND_URL}/api/jobs`);
          const jobsData = await jobsRes.json();
          setJobs(jobsData.jobs || []);
          setLastScraped(jobsData.lastScrapedAt);
          setSearched(true);
          setLoading(false);
          addLog(`🎯 Done! ${jobsData.jobs?.length || 0} MuleSoft jobs found.`, "success");
        }
      } catch (err) {
        // Backend unreachable
        clearInterval(pollRef.current);
        setLoading(false);
        addLog("❌ Lost connection to backend", "warn");
      }
    }, 2000); // poll every 2 seconds
  };

  // ── Trigger scan ────────────────────────────────────────────────────────
  const scanJobs = async () => {
    if (!backendOk) {
      alert("⚠️ Backend is not reachable!\n\nMake sure:\n1. cd backend && npm install && npm start\n2. Backend is running on http://localhost:3001");
      return;
    }

    setLoading(true);
    setJobs([]);
    setAgentLog([]);
    setSearched(false);
    setExpandedJob(null);
    setActiveTab("all");

    addLog("🚀 Sending scan request to backend...", "system");
    addLog(`📡 Backend: ${BACKEND_URL}`, "info");

    try {
      const res  = await fetch(`${BACKEND_URL}/api/scrape`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ location, type: filter, experience }),
      });
      const data = await res.json();

      if (data.status === "started") {
        addLog("✅ Scraper pipeline started on server!", "success");
        addLog("🔄 Polling for live updates...", "info");
        startPolling();
      } else if (data.status === "already_running") {
        addLog("⚠️ Scraper already running — showing cached results", "warn");
        if (data.jobs?.length) {
          setJobs(data.jobs);
          setSearched(true);
        }
        setLoading(false);
      }
    } catch (err) {
      addLog(`❌ Could not reach backend: ${err.message}`, "warn");
      addLog("💡 Is the backend running? cd backend && npm start", "info");
      setLoading(false);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────
  const officialJobs = jobs.filter(j => j.sourceType === "official");
  const boardJobs    = jobs.filter(j => j.sourceType !== "official");
  const tabJobs =
    activeTab === "official" ? officialJobs :
    activeTab === "boards"   ? boardJobs    :
    activeTab === "saved"    ? savedJobs    : jobs;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(135deg,#0a0f1e 0%,#0d1b2a 50%,#0a1628 100%)",
      fontFamily:"'JetBrains Mono','Fira Code',monospace",
      padding:"24px", color:"#e2e8f0",
    }}>

      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:"22px" }}>
        <div style={{
          display:"inline-flex", alignItems:"center", gap:"8px",
          background:"linear-gradient(135deg,rgba(163,230,53,.12),rgba(56,189,248,.12))",
          border:"1px solid rgba(163,230,53,.3)", borderRadius:"16px",
          padding:"5px 16px", marginBottom:"12px",
          fontSize:"10px", color:"#a3e635", letterSpacing:"2px", textTransform:"uppercase",
        }}>🕷️ Real Web Scraping · Puppeteer + Groq AI</div>
        <h1 style={{
          fontSize:"34px", fontWeight:"800", margin:"0 0 6px",
          background:"linear-gradient(135deg,#a3e635,#38bdf8,#818cf8)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          letterSpacing:"-1px",
        }}>MuleSoft Jobs Agent</h1>
        <p style={{ color:"#64748b", fontSize:"12px", margin:0 }}>
          Like JobSurface — scrapes <strong style={{ color:"#f59e0b" }}>company career pages</strong> +
          {" "}Greenhouse · Lever · Indeed · LinkedIn · Dice in real-time
        </p>
      </div>

      {/* Backend Status Badge */}
      <div style={{ display:"flex", justifyContent:"center", marginBottom:"16px" }}>
        <div style={{
          display:"inline-flex", alignItems:"center", gap:"8px",
          padding:"6px 14px", borderRadius:"20px",
          background: backendOk === null ? "rgba(100,116,139,.1)"
                    : backendOk        ? "rgba(74,222,128,.1)"
                    :                    "rgba(248,113,113,.1)",
          border: `1px solid ${
            backendOk === null ? "rgba(100,116,139,.3)"
          : backendOk        ? "rgba(74,222,128,.3)"
          :                    "rgba(248,113,113,.3)"}`,
          fontSize:"11px",
          color: backendOk === null ? "#64748b"
               : backendOk        ? "#4ade80"
               :                    "#f87171",
        }}>
          <span style={{
            width:"8px", height:"8px", borderRadius:"50%", flexShrink:0,
            background: backendOk === null ? "#64748b"
                      : backendOk        ? "#4ade80"
                      :                    "#f87171",
            animation: backendOk && !searched ? "pulse 2s infinite" : "none",
          }}/>
          {backendOk === null ? "Checking backend..."
         : backendOk        ? `✅ Backend connected · ${BACKEND_URL}`
         :                    `❌ Backend offline · Start with: cd backend && npm start`}
          {lastScraped && backendOk && (
            <span style={{ color:"#334155" }}>
              · Last scraped: {new Date(lastScraped).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* How it works — pipeline visualization */}
      {!searched && !loading && (
        <div style={{
          background:"rgba(15,23,42,.6)", border:"1px solid rgba(163,230,53,.15)",
          borderRadius:"12px", padding:"14px 18px", marginBottom:"16px",
          fontSize:"11px", color:"#475569",
        }}>
          <div style={{ color:"#64748b", marginBottom:"8px", letterSpacing:"1px", fontSize:"9px" }}>
            🕷️ SCRAPING PIPELINE
          </div>
          <div style={{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" }}>
            {[
              { icon:"🏢", label:"Greenhouse API", color:"#84cc16" },
              { icon:"🏢", label:"Lever API",       color:"#a3e635" },
              { icon:"🌐", label:"Indeed (Puppeteer)", color:"#38bdf8" },
              { icon:"🌐", label:"LinkedIn (Puppeteer)", color:"#0e76a9" },
              { icon:"🌐", label:"Dice (Puppeteer)",   color:"#ff6b35" },
              { icon:"🧠", label:"Groq Enrichment",   color:"#f59e0b" },
            ].map((s, i) => (
              <div key={s.label} style={{ display:"flex", alignItems:"center", gap:"4px" }}>
                <span style={{
                  padding:"2px 8px", borderRadius:"12px",
                  background:`${s.color}12`, border:`1px solid ${s.color}35`,
                  color:s.color, fontSize:"10px",
                }}>{s.icon} {s.label}</span>
                {i < 5 && <span style={{ color:"#1e293b" }}>→</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Company badges */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:"4px", justifyContent:"center", marginBottom:"16px" }}>
        {COMPANY_SITES.map(c => (
          <a key={c.name} href={c.url} target="_blank" rel="noreferrer" style={{
            display:"inline-flex", alignItems:"center", gap:"3px",
            padding:"2px 8px", borderRadius:"20px",
            background:`${c.color}12`, border:`1px solid ${c.color}35`,
            color:c.color, fontSize:"9px", fontWeight:"600", textDecoration:"none",
          }}>🏢 {c.name}</a>
        ))}
        {["LinkedIn","Indeed","Dice","Glassdoor","Greenhouse","Lever"].map(b=>(
          <span key={b} style={{
            padding:"2px 7px", borderRadius:"20px",
            background:"rgba(100,116,139,.07)", border:"1px solid rgba(100,116,139,.2)",
            color:"#64748b", fontSize:"9px",
          }}>🔎 {b}</span>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        background:"rgba(15,23,42,.8)", border:"1px solid rgba(56,189,248,.18)",
        borderRadius:"14px", padding:"18px", marginBottom:"16px",
      }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"14px", marginBottom:"14px" }}>
          {[
            { label:"Job Type",         items:FILTERS,    val:filter,     set:setFilter,     ac:"#38bdf8" },
            { label:"Location",         items:LOCATIONS,  val:location,   set:setLocation,   ac:"#818cf8" },
            { label:"Experience Level", items:EXPERIENCE, val:experience, set:setExperience, ac:"#a78bfa" },
          ].map(({ label, items, val, set, ac }) => (
            <div key={label}>
              <div style={{ fontSize:"9px", color:"#475569", marginBottom:"6px", letterSpacing:"1px", textTransform:"uppercase" }}>{label}</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
                {items.map(item => (
                  <button key={item} onClick={() => set(item)} style={{
                    padding:"3px 9px", borderRadius:"20px", fontFamily:"inherit",
                    border:`1px solid ${val===item ? ac : `${ac}28`}`,
                    background: val===item ? `${ac}1e` : "transparent",
                    color: val===item ? ac : "#64748b",
                    fontSize:"10px", cursor:"pointer", transition:"all .2s",
                  }}>{item}</button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button onClick={scanJobs} disabled={loading || backendOk === false} style={{
          width:"100%", padding:"12px",
          background: loading || backendOk===false
            ? "rgba(163,230,53,.04)"
            : "linear-gradient(135deg,rgba(163,230,53,.2),rgba(56,189,248,.18))",
          border:`1px solid ${loading || backendOk===false ? "rgba(163,230,53,.08)" : "rgba(163,230,53,.4)"}`,
          borderRadius:"12px", color: loading||backendOk===false ? "#334155" : "#e2e8f0",
          fontSize:"14px", fontWeight:"700",
          cursor: loading||backendOk===false ? "not-allowed" : "pointer",
          letterSpacing:"1px", transition:"all .3s",
          display:"flex", alignItems:"center", justifyContent:"center", gap:"10px",
          fontFamily:"inherit",
        }}>
          {loading ? (
            <>
              <span style={{
                width:"13px", height:"13px",
                border:"2px solid rgba(163,230,53,.22)", borderTop:"2px solid #a3e635",
                borderRadius:"50%", display:"inline-block", animation:"spin 1s linear infinite",
              }}/>
              Scraping company career pages + job boards...
            </>
          ) : backendOk === false
            ? "❌ Backend Offline — Start the backend server first"
            : "🕷️ Launch Real Web Scraper"}
        </button>
      </div>

      {/* Live Agent Log */}
      {agentLog.length > 0 && (
        <div style={{
          background:"rgba(0,0,0,.55)", border:"1px solid rgba(163,230,53,.1)",
          borderRadius:"10px", padding:"12px", marginBottom:"16px",
          maxHeight:"200px", overflowY:"auto",
        }} ref={logRef}>
          <div style={{ fontSize:"9px", color:"#334155", marginBottom:"6px", letterSpacing:"2px" }}>
            ▶ LIVE SCRAPER LOG  {loading && <span style={{ color:"#a3e635", animation:"blink 1s infinite" }}>● RUNNING</span>}
          </div>
          {agentLog.map((l, i) => (
            <div key={i} style={{ fontSize:"10px", color:LOG_COLORS[l.type]||"#94a3b8", marginBottom:"2px", display:"flex", gap:"10px" }}>
              <span style={{ color:"#1e293b", minWidth:"68px", flexShrink:0 }}>{l.time}</span>
              <span>{l.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {searched && (
        <div>
          {/* Stats + Tabs */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px", flexWrap:"wrap", gap:"8px" }}>
            <div style={{ display:"flex", gap:"8px", alignItems:"center", flexWrap:"wrap" }}>
              <span style={{ fontSize:"12px", color:"#64748b" }}>
                <span style={{ color:"#a3e635", fontWeight:"700", fontSize:"18px" }}>{jobs.length}</span> real jobs scraped
              </span>
              <span style={{
                padding:"2px 8px", borderRadius:"20px",
                background:"rgba(245,158,11,.1)", border:"1px solid rgba(245,158,11,.25)",
                color:"#f59e0b", fontSize:"9px",
              }}>🏢 {officialJobs.length} Official Career Sites</span>
              <span style={{
                padding:"2px 8px", borderRadius:"20px",
                background:"rgba(56,189,248,.08)", border:"1px solid rgba(56,189,248,.18)",
                color:"#38bdf8", fontSize:"9px",
              }}>🔎 {boardJobs.length} Job Boards</span>
            </div>
            <div style={{ display:"flex", gap:"4px" }}>
              {[
                { k:"all",      label:`All (${jobs.length})` },
                { k:"official", label:`🏢 Official (${officialJobs.length})` },
                { k:"boards",   label:`🔎 Boards (${boardJobs.length})` },
                { k:"saved",    label:`⭐ Saved (${savedJobs.length})` },
              ].map(({ k, label }) => (
                <button key={k} onClick={() => setActiveTab(k)} style={{
                  padding:"4px 10px", borderRadius:"7px", fontSize:"10px",
                  cursor:"pointer", fontFamily:"inherit", transition:"all .2s",
                  background: activeTab===k ? "rgba(163,230,53,.15)" : "transparent",
                  border:`1px solid ${activeTab===k ? "rgba(163,230,53,.4)" : "rgba(163,230,53,.12)"}`,
                  color: activeTab===k ? "#a3e635" : "#64748b",
                }}>{label}</button>
              ))}
            </div>
          </div>

          {/* Job Cards */}
          <div style={{ display:"grid", gap:"8px" }}>
            {tabJobs.map((job, i) => {
              const ts    = getTypeStyle(job.type);
              const sc    = getSourceColor(job.source);
              const isExp = expandedJob === i;
              const saved = isSaved(job);

              return (
                <div key={i} onClick={() => setExpandedJob(isExp ? null : i)} style={{
                  background:"rgba(15,23,42,.85)",
                  border:`1px solid ${isExp ? "rgba(163,230,53,.35)" : job.sourceType==="official" ? "rgba(245,158,11,.16)" : "rgba(56,189,248,.08)"}`,
                  borderRadius:"10px", padding:"15px", cursor:"pointer", transition:"all .2s",
                }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"10px" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px" }}>
                        <div style={{
                          width:"30px", height:"30px", borderRadius:"7px", flexShrink:0,
                          background:`linear-gradient(135deg,${sc}25,${sc}10)`,
                          border:`1px solid ${sc}38`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:"10px", fontWeight:"800", color:sc,
                        }}>{job.company?.[0]||"?"}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
                            <span style={{ fontSize:"11px", color:"#94a3b8", fontWeight:"600" }}>{job.company}</span>
                            {job.sourceType==="official" && (
                              <span style={{
                                padding:"1px 5px", borderRadius:"8px", fontSize:"8px",
                                background:"rgba(245,158,11,.1)", border:"1px solid rgba(245,158,11,.25)",
                                color:"#f59e0b", fontWeight:"700",
                              }}>✓ OFFICIAL</span>
                            )}
                            <span style={{
                              padding:"1px 5px", borderRadius:"8px", fontSize:"8px",
                              background:"rgba(163,230,53,.08)", border:"1px solid rgba(163,230,53,.2)",
                              color:"#a3e635",
                            }}>🕷️ Scraped</span>
                          </div>
                          <div style={{ fontSize:"9px", color:"#334155" }}>
                            via <span style={{ color:sc }}>{job.source}</span> · {job.posted}
                          </div>
                        </div>
                      </div>

                      <h3 style={{ margin:"0 0 6px", fontSize:"14px", fontWeight:"700", color:"#e2e8f0" }}>
                        {job.title}
                      </h3>

                      <div style={{ display:"flex", flexWrap:"wrap", gap:"4px", alignItems:"center" }}>
                        <span style={{
                          padding:"1px 8px", borderRadius:"20px", fontSize:"9px", fontWeight:"600",
                          background:ts.bg, color:ts.text, border:`1px solid ${ts.border}`,
                        }}>{job.type}</span>
                        <span style={{ fontSize:"10px", color:"#64748b" }}>📍 {job.location}</span>
                        <span style={{ fontSize:"10px", color:"#64748b" }}>🎯 {job.experience}</span>
                        {job.salary && job.salary !== "Not specified" && (
                          <span style={{ fontSize:"10px", color:"#4ade80", fontWeight:"600" }}>{job.salary}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"5px" }}>
                      <button onClick={e => toggleSave(job, e)} style={{
                        background: saved ? "rgba(245,158,11,.15)" : "transparent",
                        border:`1px solid ${saved ? "rgba(245,158,11,.4)" : "rgba(56,189,248,.15)"}`,
                        borderRadius:"6px", padding:"3px 6px", cursor:"pointer",
                        color: saved ? "#f59e0b" : "#334155", fontSize:"11px", fontFamily:"inherit",
                      }}>{saved ? "⭐" : "☆"}</button>
                      <div style={{
                        fontSize:"14px", color:"#334155",
                        transform: isExp ? "rotate(180deg)" : "none", transition:"transform .2s",
                      }}>▾</div>
                    </div>
                  </div>

                  {isExp && (
                    <div style={{ marginTop:"12px", paddingTop:"12px", borderTop:"1px solid rgba(163,230,53,.08)" }}>
                      <p style={{ fontSize:"12px", color:"#94a3b8", lineHeight:"1.7", margin:"0 0 12px" }}>
                        {job.description}
                      </p>

                      {job.skills?.length > 0 && (
                        <div style={{ marginBottom:"12px" }}>
                          <div style={{ fontSize:"9px", color:"#475569", marginBottom:"5px", letterSpacing:"1px" }}>REQUIRED SKILLS</div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
                            {job.skills.map((s, si) => (
                              <span key={si} style={{
                                padding:"2px 8px", background:"rgba(163,230,53,.07)",
                                border:"1px solid rgba(163,230,53,.2)", borderRadius:"5px",
                                fontSize:"10px", color:"#a3e635",
                              }}>{s}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                        <button style={{
                          padding:"6px 14px",
                          background:"linear-gradient(135deg,rgba(163,230,53,.18),rgba(56,189,248,.15))",
                          border:"1px solid rgba(163,230,53,.35)", borderRadius:"7px",
                          color:"#e2e8f0", fontSize:"11px", cursor:"pointer",
                          fontFamily:"inherit", fontWeight:"600",
                        }} onClick={e => {
                          e.stopPropagation();
                          window.open(job.applyUrl || `https://www.linkedin.com/jobs/search/?keywords=MuleSoft+${encodeURIComponent(job.title)}`, "_blank");
                        }}>🕷️ Apply (Scraped Link) →</button>

                        {job.companyCareerUrl && (
                          <button style={{
                            padding:"6px 12px", background:"rgba(245,158,11,.08)",
                            border:"1px solid rgba(245,158,11,.25)", borderRadius:"7px",
                            color:"#f59e0b", fontSize:"11px", cursor:"pointer", fontFamily:"inherit",
                          }} onClick={e => { e.stopPropagation(); window.open(job.companyCareerUrl, "_blank"); }}>
                            🏢 Careers Page
                          </button>
                        )}

                        <button style={{
                          padding:"6px 12px", background:"transparent",
                          border:"1px solid rgba(56,189,248,.12)", borderRadius:"7px",
                          color:"#475569", fontSize:"11px", cursor:"pointer", fontFamily:"inherit",
                        }} onClick={e => toggleSave(job, e)}>
                          {isSaved(job) ? "⭐ Saved" : "☆ Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {tabJobs.length === 0 && (
              <div style={{ textAlign:"center", padding:"30px", color:"#334155", fontSize:"12px" }}>
                No jobs in this category yet.
              </div>
            )}
          </div>
        </div>
      )}

      {!searched && !loading && (
        <div style={{ textAlign:"center", padding:"44px 20px" }}>
          <div style={{ fontSize:"40px", marginBottom:"10px" }}>🕷️</div>
          <div style={{ fontSize:"14px", color:"#475569", marginBottom:"6px" }}>
            {backendOk ? "Backend ready — Click launch to start real web scraping!" : "Start your backend server to begin"}
          </div>
          <div style={{ fontSize:"11px", color:"#334155" }}>
            {backendOk
              ? "Scrapes Greenhouse · Lever · Indeed · LinkedIn · Dice simultaneously"
              : "cd backend && npm install && npm start"}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        @keyframes blink   { 0%,100% { opacity:1; } 50% { opacity:0; } }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(163,230,53,.25); border-radius:2px; }
        a:hover { opacity:.82 !important; }
      `}</style>
    </div>
  );
}
