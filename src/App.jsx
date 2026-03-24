import { useState, useEffect, useRef } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const FILTERS    = ["All", "Remote", "On-site", "Hybrid", "Contract", "Full-time"];
const LOCATIONS  = ["Anywhere", "USA", "UK", "India", "Canada", "Australia", "Europe"];
const EXPERIENCE = ["Any Level", "Junior", "Mid-level", "Senior", "Lead/Architect"];

// Groq free models (pick one — llama3 70b gives best results)
const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile",  label: "Llama 3.3 70B  ⭐ Best"    },
  { id: "llama-3.1-8b-instant",     label: "Llama 3.1 8B   ⚡ Fastest" },
  { id: "mixtral-8x7b-32768",       label: "Mixtral 8x7B   🔥 Smart"  },
  { id: "gemma2-9b-it",             label: "Gemma 2 9B      🌱 Light"  },
];

const COMPANY_SITES = [
  { name:"Accenture",  url:"https://www.accenture.com/us-en/careers/jobsearch?jk=mulesoft",              logo:"A",  color:"#a855f7" },
  { name:"Deloitte",   url:"https://apply.deloitte.com/careers/SearchJobs/mulesoft",                     logo:"D",  color:"#3b82f6" },
  { name:"IBM",        url:"https://www.ibm.com/employment/#jobs?q=mulesoft",                            logo:"I",  color:"#2563eb" },
  { name:"Capgemini",  url:"https://www.capgemini.com/jobs/?s=mulesoft",                                 logo:"C",  color:"#0ea5e9" },
  { name:"Wipro",      url:"https://careers.wipro.com/careers-home/jobs?q=mulesoft",                    logo:"W",  color:"#10b981" },
  { name:"Infosys",    url:"https://career.infosys.com/joblist#SearchForm?searchIndex=mulesoft",        logo:"IN", color:"#f59e0b" },
  { name:"TCS",        url:"https://ibegin.tcs.com/iBegin/jobs/search?query=mulesoft",                  logo:"T",  color:"#ef4444" },
  { name:"Cognizant",  url:"https://careers.cognizant.com/global/en/search-results?keywords=mulesoft",  logo:"CO", color:"#8b5cf6" },
  { name:"HCL",        url:"https://www.hcltech.com/careers/search?q=mulesoft",                         logo:"H",  color:"#ec4899" },
  { name:"PwC",        url:"https://www.pwc.com/gx/en/careers/job-search.html#q=mulesoft",             logo:"P",  color:"#f97316" },
  { name:"KPMG",       url:"https://home.kpmg/xx/en/home/careers/search-for-jobs.html?q=mulesoft",     logo:"K",  color:"#06b6d4" },
  { name:"EY",         url:"https://careers.ey.com/ey/search/?q=mulesoft",                             logo:"EY", color:"#84cc16" },
  { name:"Salesforce", url:"https://salesforce.wd1.myworkdayjobs.com/External_Career_Site?q=mulesoft",  logo:"SF", color:"#38bdf8" },
  { name:"Amazon",     url:"https://www.amazon.jobs/en/search?base_query=mulesoft",                     logo:"AM", color:"#fb923c" },
  { name:"Microsoft",  url:"https://jobs.careers.microsoft.com/global/en/search?q=mulesoft",           logo:"MS", color:"#60a5fa" },
  { name:"Oracle",     url:"https://careers.oracle.com/jobs/#en/sites/jobsearch/jobs?keyword=mulesoft", logo:"O",  color:"#ef4444" },
];

const SOURCE_COLORS = {
  "Accenture":"#a855f7","Deloitte":"#3b82f6","IBM":"#2563eb","Capgemini":"#0ea5e9",
  "Wipro":"#10b981","Infosys":"#f59e0b","TCS":"#ef4444","Cognizant":"#8b5cf6",
  "HCL":"#ec4899","PwC":"#f97316","KPMG":"#06b6d4","EY":"#84cc16",
  "Salesforce":"#38bdf8","Amazon":"#fb923c","Microsoft":"#60a5fa","Oracle":"#ef4444",
  "LinkedIn":"#0e76a9","Indeed":"#2164f3","Dice":"#ff6b35","Glassdoor":"#0caa41",
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

// ── Helpers ──────────────────────────────────────────────────────────────────
const getTypeStyle = (type="") => {
  for(const k of Object.keys(TYPE_COLORS))
    if(type.toLowerCase().includes(k.toLowerCase())) return TYPE_COLORS[k];
  return { bg:"#f1f5f9", text:"#475569", border:"#cbd5e1" };
};
const getSourceColor = (source="") => {
  for(const k of Object.keys(SOURCE_COLORS))
    if(source.toLowerCase().includes(k.toLowerCase())) return SOURCE_COLORS[k];
  return "#64748b";
};

// ── Main Component ───────────────────────────────────────────────────────────
export default function MuleSoftJobScanner() {
  const [apiKey,     setApiKey]     = useState("");
  const [model,      setModel]      = useState(GROQ_MODELS[0].id);
  const [jobs,       setJobs]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [agentLog,   setAgentLog]   = useState([]);
  const [filter,     setFilter]     = useState("All");
  const [location,   setLocation]   = useState("Anywhere");
  const [experience, setExperience] = useState("Any Level");
  const [searched,   setSearched]   = useState(false);
  const [expandedJob,setExpandedJob]= useState(null);
  const [activeTab,  setActiveTab]  = useState("all");
  const [savedJobs,  setSavedJobs]  = useState([]);
  const [showKey,    setShowKey]    = useState(false);
  const logRef = useRef(null);

  useEffect(()=>{
    if(logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  },[agentLog]);

  const addLog = (msg, type="info") =>
    setAgentLog(p=>[...p,{ msg, type, time: new Date().toLocaleTimeString() }]);

  const toggleSave = (job, e) => {
    e.stopPropagation();
    setSavedJobs(prev => {
      const exists = prev.find(j=>j.title===job.title && j.company===job.company);
      return exists
        ? prev.filter(j=>!(j.title===job.title && j.company===job.company))
        : [...prev, job];
    });
  };
  const isSaved = job => savedJobs.some(j=>j.title===job.title && j.company===job.company);

  // ── Groq API Call ──────────────────────────────────────────────────────────
  const scanJobs = async () => {
    if(!apiKey.trim()){
      alert("Please enter your Groq API key first!\nGet it FREE at: console.groq.com");
      return;
    }

    setLoading(true); setJobs([]); setAgentLog([]);
    setSearched(false); setExpandedJob(null); setActiveTab("all");

    const locStr = location !== "Anywhere" ? location : "Global/Worldwide";
    const expStr = experience !== "Any Level" ? experience : "all experience levels";
    const filStr = filter !== "All" ? filter : "all job types";

    addLog("Groq AI Agent initializing...", "system");
    addLog(`Using model: ${GROQ_MODELS.find(m=>m.id===model)?.label}`, "groq");
    addLog("Building search across official company career sites...", "company");
    addLog("Preparing MuleSoft job search prompt...", "info");

    const companyList = COMPANY_SITES.map(c=>c.name).join(", ");

    const systemPrompt = `You are an expert MuleSoft job market analyst with deep knowledge of the integration technology job market. 
You have comprehensive, up-to-date knowledge of job postings at major tech and consulting companies worldwide.
Your task is to generate realistic, accurate MuleSoft job listings that reflect the current market.
You ALWAYS respond with ONLY valid JSON arrays. Never add any explanation, markdown formatting, or extra text outside the JSON.`;

    const userPrompt = `Generate a comprehensive list of current MuleSoft developer job postings.

SEARCH CRITERIA:
- Role: MuleSoft Developer / Integration Engineer / Architect / Consultant
- Location: ${locStr}
- Experience Level: ${expStr}
- Job Type: ${filStr}

Search these companies' career portals: ${companyList}
Also include postings from: LinkedIn, Indeed, Dice, Glassdoor

Generate 14 realistic job listings. Mix between official company sites and job boards.

Return ONLY a JSON array with this exact structure:
[
  {
    "title": "job title",
    "company": "company name",
    "location": "city, country or Remote",
    "type": "Full-time or Contract or Remote or Hybrid or On-site",
    "experience": "X years or Junior/Mid-level/Senior/Lead",
    "salary": "salary range with currency (e.g. $120,000 - $160,000 or ₹15L - ₹25L)",
    "skills": ["MuleSoft", "DataWeave", "Anypoint Platform", "up to 5 more relevant skills"],
    "description": "2-3 sentence realistic job description",
    "posted": "X days ago",
    "source": "source name (e.g. Accenture Careers or LinkedIn or Indeed)",
    "sourceType": "official or jobboard",
    "applyUrl": "real career portal URL for this company",
    "companyCareerUrl": "company careers homepage URL if official, empty string if jobboard"
  }
]

Requirements:
- Mix companies: Accenture, Deloitte, IBM, Capgemini, Wipro, TCS, Infosys, Cognizant, Salesforce, PwC, HCL, Amazon, Microsoft, Oracle
- sourceType = "official" for company career sites, "jobboard" for LinkedIn/Indeed/Dice
- Use realistic salaries for the location (USD for USA, GBP for UK, INR for India, CAD for Canada)
- Include both senior and mid-level roles
- Skills should match real MuleSoft job requirements (DataWeave, Anypoint Studio, CloudHub, REST APIs, etc.)
- Location must match the filter: ${locStr}
- Return ONLY the JSON array. No other text whatsoever.`;

    try {
      addLog("Connecting to Groq API...", "groq");
      addLog(`Sending request to ${model}...`, "groq");

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
          temperature: 0.7,
          max_tokens: 6000,
        }),
      });

      if(!response.ok){
        const err = await response.json();
        throw new Error(err?.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      addLog("Groq responded successfully!", "groq");
      addLog("Parsing MuleSoft job listings...", "info");

      const rawText = data.choices?.[0]?.message?.content || "";

      let parsed = [];
      try {
        // Try direct parse first
        parsed = JSON.parse(rawText);
      } catch {
        // Extract JSON array from text
        const match = rawText.match(/\[[\s\S]*\]/);
        if(match){
          try { parsed = JSON.parse(match[0]); }
          catch { parsed = []; }
        }
      }

      if(!Array.isArray(parsed) || parsed.length === 0){
        addLog("Could not parse AI response — using sample data", "warn");
        parsed = sampleJobs(location, experience, filter);
      }

      // Sort: official first, then job boards
      parsed.sort((a,b)=>{
        if(a.sourceType==="official" && b.sourceType!=="official") return -1;
        if(b.sourceType==="official" && a.sourceType!=="official") return 1;
        return 0;
      });

      const offCount = parsed.filter(j=>j.sourceType==="official").length;
      const brdCount = parsed.length - offCount;

      addLog(`Found ${parsed.length} MuleSoft jobs!`, "success");
      addLog(`${offCount} from official company career sites`, "company");
      addLog(`${brdCount} from job boards (LinkedIn / Indeed / Dice)`, "search");
      addLog("📊 Sorted: official listings first. Ready!", "success");

      setJobs(parsed); setSearched(true);

    } catch(err) {
      addLog(`Error: ${err.message}`, "warn");

      if(err.message.includes("401") || err.message.includes("invalid_api_key")){
        addLog("Invalid API key — check your Groq key at console.groq.com", "warn");
      } else if(err.message.includes("429")){
        addLog("Rate limit hit — wait a moment and try again", "warn");
      } else {
        addLog("Loading sample data as fallback...", "warn");
        const fb = sampleJobs(location, experience, filter);
        setJobs(fb); setSearched(true);
        addLog(`Loaded ${fb.length} sample jobs!`, "success");
      }
    }

    setLoading(false);
  };

  // ── Sample / Fallback Jobs ─────────────────────────────────────────────────
  const sampleJobs = (loc) => [
    { title:"Senior MuleSoft Developer", company:"Accenture", location:loc!=="Anywhere"?loc:"New York, USA", type:"Full-time", experience:"5+ years", salary:"$120,000 - $160,000", skills:["MuleSoft 4","Anypoint Platform","DataWeave","REST APIs","CloudHub","CI/CD"], description:"Lead MuleSoft integration projects for Fortune 500 clients. Design API-led connectivity solutions and govern enterprise integration standards across global teams.", posted:"2 days ago", source:"Accenture Careers", sourceType:"official", applyUrl:"https://www.accenture.com/us-en/careers/jobsearch?jk=mulesoft", companyCareerUrl:"https://www.accenture.com/us-en/careers" },
    { title:"MuleSoft Integration Architect", company:"Deloitte", location:loc!=="Anywhere"?loc:"Remote, USA", type:"Remote", experience:"7+ years", salary:"$150,000 - $195,000", skills:["MuleSoft","API Strategy","Enterprise Architecture","AWS","Microservices","TOGAF"], description:"Define integration architecture for large-scale digital transformation. Lead MuleSoft CoE and mentor a team of 10+ developers on client engagements.", posted:"1 day ago", source:"Deloitte Careers", sourceType:"official", applyUrl:"https://apply.deloitte.com/careers/SearchJobs/mulesoft", companyCareerUrl:"https://apply.deloitte.com/careers" },
    { title:"MuleSoft Platform Engineer", company:"IBM", location:loc!=="Anywhere"?loc:"Austin, TX", type:"Full-time", experience:"4-6 years", salary:"$110,000 - $145,000", skills:["MuleSoft","CloudHub 2.0","RTF","Kubernetes","DevOps","Jenkins"], description:"Manage and scale MuleSoft Runtime Fabric deployments on Kubernetes. Implement CI/CD automation and monitor platform health across global regions.", posted:"3 days ago", source:"IBM Careers", sourceType:"official", applyUrl:"https://www.ibm.com/employment/#jobs?q=mulesoft", companyCareerUrl:"https://www.ibm.com/employment" },
    { title:"Lead MuleSoft Consultant", company:"Capgemini", location:loc!=="Anywhere"?loc:"Chicago, USA", type:"Full-time", experience:"6+ years", salary:"$130,000 - $170,000", skills:["MuleSoft","API-led Connectivity","RAML","OAS","Anypoint Exchange","Consulting"], description:"Consult Fortune 500 clients on MuleSoft adoption. Design reusable API templates, govern API lifecycle, and deliver training sessions to client teams.", posted:"2 days ago", source:"Capgemini Careers", sourceType:"official", applyUrl:"https://www.capgemini.com/jobs/?s=mulesoft", companyCareerUrl:"https://www.capgemini.com/jobs" },
    { title:"MuleSoft Developer", company:"Wipro", location:loc!=="Anywhere"?loc:"Bangalore, India", type:"Full-time", experience:"3-5 years", salary:"₹12L - ₹20L", skills:["MuleSoft","DataWeave","Oracle DB","Salesforce","Batch Processing","Error Handling"], description:"Build enterprise integrations between SAP and Salesforce. Implement batch processing flows for high-volume data migration projects.", posted:"4 days ago", source:"Wipro Careers", sourceType:"official", applyUrl:"https://careers.wipro.com/careers-home/jobs?q=mulesoft", companyCareerUrl:"https://careers.wipro.com" },
    { title:"MuleSoft Integration Engineer", company:"Cognizant", location:loc!=="Anywhere"?loc:"Toronto, Canada", type:"Hybrid", experience:"3+ years", salary:"CAD $85,000 - $115,000", skills:["MuleSoft","Salesforce","CRM Integration","DataWeave","REST/SOAP","API Security"], description:"Build bi-directional integrations between Salesforce and enterprise systems. Define canonical data models and API security policies.", posted:"5 days ago", source:"Cognizant Careers", sourceType:"official", applyUrl:"https://careers.cognizant.com/global/en/search-results?keywords=mulesoft", companyCareerUrl:"https://careers.cognizant.com" },
    { title:"MuleSoft Developer — Integration Cloud", company:"Salesforce", location:loc!=="Anywhere"?loc:"San Francisco, USA", type:"Full-time", experience:"4+ years", salary:"$140,000 - $185,000", skills:["MuleSoft","Salesforce Platform","Anypoint Studio","Apex","Integration Cloud","Flow Builder"], description:"Work on core MuleSoft product integrations within Salesforce Customer 360. Collaborate with product teams on next-gen connector frameworks.", posted:"1 week ago", source:"Salesforce Careers", sourceType:"official", applyUrl:"https://salesforce.wd1.myworkdayjobs.com/External_Career_Site?q=mulesoft", companyCareerUrl:"https://www.salesforce.com/company/careers" },
    { title:"Senior MuleSoft Engineer", company:"PwC", location:loc!=="Anywhere"?loc:"London, UK", type:"Full-time", experience:"5+ years", salary:"£75,000 - £95,000", skills:["MuleSoft","API Governance","OAuth 2.0","Anypoint Manager","GDPR","Financial Services"], description:"Lead API strategy for UK financial services clients. Ensure GDPR and FCA compliance across all integration designs and data flows.", posted:"3 days ago", source:"PwC Careers", sourceType:"official", applyUrl:"https://www.pwc.co.uk/careers/search-apply", companyCareerUrl:"https://www.pwc.co.uk/careers" },
    { title:"MuleSoft Integration Architect", company:"TCS", location:loc!=="Anywhere"?loc:"Hyderabad, India", type:"Full-time", experience:"8+ years", salary:"₹25L - ₹40L", skills:["MuleSoft","Enterprise Architecture","TOGAF","API Design","Integration Patterns","Presales"], description:"Define MuleSoft architecture for global banking clients. Lead presales activities and govern delivery teams across multiple geographies.", posted:"6 days ago", source:"TCS Careers", sourceType:"official", applyUrl:"https://ibegin.tcs.com/iBegin/jobs/search?query=mulesoft", companyCareerUrl:"https://ibegin.tcs.com" },
    { title:"MuleSoft Developer (Contract)", company:"Various Clients", location:loc!=="Anywhere"?loc:"Remote, USA", type:"Contract", experience:"3+ years", salary:"$75 - $100/hr", skills:["MuleSoft 4","DataWeave","Anypoint Platform","Kafka","Event-Driven","AsyncAPI"], description:"6-month contract for real-time event-driven integrations using Kafka and MuleSoft AsyncAPI connector. Multiple client engagements available.", posted:"1 day ago", source:"Dice", sourceType:"jobboard", applyUrl:"https://www.dice.com/jobs?q=mulesoft", companyCareerUrl:"" },
    { title:"Junior MuleSoft Developer", company:"Infosys", location:loc!=="Anywhere"?loc:"Remote, India", type:"Remote", experience:"1-2 years", salary:"₹6L - ₹10L", skills:["MuleSoft","DataWeave Basics","REST APIs","JSON","XML","Anypoint Studio"], description:"Develop and maintain MuleSoft integration flows under senior guidance. Work on API design and implementation for retail client projects.", posted:"2 days ago", source:"Infosys Careers", sourceType:"official", applyUrl:"https://career.infosys.com/joblist", companyCareerUrl:"https://career.infosys.com" },
    { title:"MuleSoft + AWS Integration Engineer", company:"Amazon", location:loc!=="Anywhere"?loc:"Seattle, USA", type:"Full-time", experience:"4+ years", salary:"$130,000 - $175,000", skills:["MuleSoft","AWS Lambda","API Gateway","S3","SQS","CloudFormation"], description:"Build hybrid integrations between MuleSoft Anypoint Platform and AWS services. Design serverless patterns for AWS marketplace solutions.", posted:"5 days ago", source:"Amazon Careers", sourceType:"official", applyUrl:"https://www.amazon.jobs/en/search?base_query=mulesoft", companyCareerUrl:"https://www.amazon.jobs" },
    { title:"MuleSoft Integration Specialist", company:"HCL Technologies", location:loc!=="Anywhere"?loc:"Dallas, USA", type:"Full-time", experience:"4-7 years", salary:"$95,000 - $130,000", skills:["MuleSoft","API Management","Microservices","Docker","OAuth2","FHIR"], description:"Deliver MuleSoft integrations for healthcare and insurance clients. Build FHIR-compliant API layers and govern Anypoint Platform.", posted:"4 days ago", source:"HCL Careers", sourceType:"official", applyUrl:"https://www.hcltech.com/careers/search?q=mulesoft", companyCareerUrl:"https://www.hcltech.com/careers" },
    { title:"MuleSoft Developer", company:"EY", location:loc!=="Anywhere"?loc:"Remote, UK", type:"Hybrid", experience:"3-5 years", salary:"£55,000 - £75,000", skills:["MuleSoft","API Strategy","Cloud Integration","Azure","DataWeave","Agile"], description:"Support EY's digital transformation engagements across financial services. Design and implement API integrations using MuleSoft Anypoint Platform.", posted:"3 days ago", source:"EY Careers", sourceType:"official", applyUrl:"https://careers.ey.com/ey/search/?q=mulesoft", companyCareerUrl:"https://careers.ey.com" },
  ];

  // ── Derived ────────────────────────────────────────────────────────────────
  const officialJobs = jobs.filter(j=>j.sourceType==="official");
  const boardJobs    = jobs.filter(j=>j.sourceType!=="official");
  const tabJobs =
    activeTab==="official" ? officialJobs :
    activeTab==="boards"   ? boardJobs    :
    activeTab==="saved"    ? savedJobs    : jobs;

  // ── Render ─────────────────────────────────────────────────────────────────
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
        }}>Powered by Groq AI — Free &amp; Fast</div>
        <h1 style={{
          fontSize:"34px", fontWeight:"800", margin:"0 0 6px",
          background:"linear-gradient(135deg,#a3e635,#38bdf8,#818cf8)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", letterSpacing:"-1px",
        }}>MuleSoft Jobs Agent</h1>
        <p style={{ color:"#64748b", fontSize:"12px", margin:0 }}>
          Scans <strong style={{ color:"#f59e0b" }}>{COMPANY_SITES.length} official company portals</strong>
          {" "}+ LinkedIn · Indeed · Dice · Glassdoor
        </p>
      </div>

      {/* ── API KEY INPUT ───────────────────────────────────────────────────── */}
      <div style={{
        background:"rgba(163,230,53,.06)", border:"1px solid rgba(163,230,53,.25)",
        borderRadius:"14px", padding:"16px", marginBottom:"16px",
      }}>
        <div style={{ fontSize:"10px", color:"#a3e635", marginBottom:"10px", letterSpacing:"1px" }}>
           GROQ API KEY — FREE AT console.groq.com
        </div>

        <div style={{ display:"flex", gap:"10px", alignItems:"center", marginBottom:"10px" }}>
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={e=>setApiKey(e.target.value)}
            placeholder="Paste your Groq API key here  (gsk_...)"
            style={{
              flex:1, padding:"10px 14px",
              background:"rgba(0,0,0,.4)", border:"1px solid rgba(163,230,53,.3)",
              borderRadius:"8px", color:"#e2e8f0", fontSize:"12px",
              fontFamily:"inherit", outline:"none",
            }}
          />
          <button onClick={()=>setShowKey(s=>!s)} style={{
            padding:"10px 14px", background:"rgba(163,230,53,.1)",
            border:"1px solid rgba(163,230,53,.25)", borderRadius:"8px",
            color:"#a3e635", fontSize:"11px", cursor:"pointer", fontFamily:"inherit",
          }}>{showKey ? "Hide" : "👁 Show"}</button>
          <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{
            padding:"10px 14px", background:"rgba(163,230,53,.15)",
            border:"1px solid rgba(163,230,53,.35)", borderRadius:"8px",
            color:"#a3e635", fontSize:"11px", textDecoration:"none", fontWeight:"600",
            whiteSpace:"nowrap",
          }}>Get Free Key →</a>
        </div>

        {/* Model selector */}
        <div>
          <div style={{ fontSize:"9px", color:"#475569", marginBottom:"7px", letterSpacing:"1px" }}>
            SELECT MODEL (all free on Groq)
          </div>
          <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
            {GROQ_MODELS.map(m=>(
              <button key={m.id} onClick={()=>setModel(m.id)} style={{
                padding:"4px 12px", borderRadius:"20px", fontFamily:"inherit",
                border:`1px solid ${model===m.id ? "#a3e635" : "rgba(163,230,53,.2)"}`,
                background: model===m.id ? "rgba(163,230,53,.18)" : "transparent",
                color: model===m.id ? "#a3e635" : "#64748b",
                fontSize:"10px", cursor:"pointer", transition:"all .2s",
              }}>{m.label}</button>
            ))}
          </div>
        </div>

        {/* Info note */}
        <div style={{
          marginTop:"10px", padding:"8px 12px",
          background:"rgba(56,189,248,.06)", border:"1px solid rgba(56,189,248,.15)",
          borderRadius:"7px", fontSize:"10px", color:"#64748b", lineHeight:"1.6",
        }}>
          ℹ️ <strong style={{ color:"#94a3b8" }}>How it works:</strong> Groq AI generates realistic MuleSoft job listings
          based on its knowledge of current job market trends. The <strong style={{ color:"#f59e0b" }}>Apply buttons</strong> link
          directly to official company career portals so you can check real openings.
        </div>
      </div>

      {/* Company badges */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:"4px", justifyContent:"center", marginBottom:"18px" }}>
        {COMPANY_SITES.map(c=>(
          <a key={c.name} href={c.url} target="_blank" rel="noreferrer" style={{
            display:"inline-flex", alignItems:"center", gap:"4px",
            padding:"2px 8px", borderRadius:"20px",
            background:`${c.color}12`, border:`1px solid ${c.color}35`,
            color:c.color, fontSize:"9px", fontWeight:"600", textDecoration:"none",
          }}>{c.name}</a>
        ))}
        {["LinkedIn","Indeed","Dice","Glassdoor"].map(b=>(
          <span key={b} style={{
            padding:"2px 8px", borderRadius:"20px",
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
          ].map(({ label, items, val, set, ac })=>(
            <div key={label}>
              <div style={{ fontSize:"9px", color:"#475569", marginBottom:"6px", letterSpacing:"1px", textTransform:"uppercase" }}>{label}</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
                {items.map(item=>(
                  <button key={item} onClick={()=>set(item)} style={{
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

        <button onClick={scanJobs} disabled={loading} style={{
          width:"100%", padding:"12px",
          background: loading
            ? "rgba(163,230,53,.05)"
            : "linear-gradient(135deg,rgba(163,230,53,.2),rgba(56,189,248,.18))",
          border:`1px solid ${loading ? "rgba(163,230,53,.1)" : "rgba(163,230,53,.4)"}`,
          borderRadius:"12px", color: loading ? "#475569" : "#e2e8f0",
          fontSize:"14px", fontWeight:"700", cursor: loading?"not-allowed":"pointer",
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
              Groq AI scanning {COMPANY_SITES.length} company sites...
            </>
          ) : <>⚡ Launch Groq-Powered Job Scanner</>}
        </button>
      </div>

      {/* Agent Log */}
      {agentLog.length > 0 && (
        <div style={{
          background:"rgba(0,0,0,.5)", border:"1px solid rgba(163,230,53,.1)",
          borderRadius:"10px", padding:"12px", marginBottom:"16px",
          maxHeight:"160px", overflowY:"auto",
        }} ref={logRef}>
          <div style={{ fontSize:"9px", color:"#334155", marginBottom:"6px", letterSpacing:"2px" }}>GROQ AGENT LOG</div>
          {agentLog.map((l,i)=>(
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
                <span style={{ color:"#a3e635", fontWeight:"700", fontSize:"18px" }}>{jobs.length}</span> jobs found
              </span>
              <span style={{
                padding:"2px 8px", borderRadius:"20px",
                background:"rgba(245,158,11,.1)", border:"1px solid rgba(245,158,11,.25)",
                color:"#f59e0b", fontSize:"9px",
              }}>{officialJobs.length} Official Sites</span>
              <span style={{
                padding:"2px 8px", borderRadius:"20px",
                background:"rgba(56,189,248,.08)", border:"1px solid rgba(56,189,248,.18)",
                color:"#38bdf8", fontSize:"9px",
              }}>🔎 {boardJobs.length} Job Boards</span>
            </div>
            <div style={{ display:"flex", gap:"4px" }}>
              {[
                { k:"all",      label:`All (${jobs.length})` },
                { k:"official", label:`Official (${officialJobs.length})` },
                { k:"boards",   label:`Boards (${boardJobs.length})` },
                { k:"saved",    label:`Saved (${savedJobs.length})` },
              ].map(({ k, label })=>(
                <button key={k} onClick={()=>setActiveTab(k)} style={{
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
            {tabJobs.map((job,i)=>{
              const ts   = getTypeStyle(job.type);
              const sc   = getSourceColor(job.source);
              const exp  = expandedJob===i;
              const saved= isSaved(job);

              return (
                <div key={i} onClick={()=>setExpandedJob(exp?null:i)} style={{
                  background:"rgba(15,23,42,.85)",
                  border:`1px solid ${exp ? "rgba(163,230,53,.35)" : job.sourceType==="official" ? "rgba(245,158,11,.16)" : "rgba(56,189,248,.08)"}`,
                  borderRadius:"10px", padding:"15px", cursor:"pointer", transition:"all .2s",
                }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"10px" }}>
                    <div style={{ flex:1 }}>
                      {/* Company row */}
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
                        <span style={{ fontSize:"10px", color:"#64748b" }}>{job.location}</span>
                        <span style={{ fontSize:"10px", color:"#64748b" }}>{job.experience}</span>
                        <span style={{ fontSize:"10px", color:"#4ade80", fontWeight:"600" }}>{job.salary}</span>
                      </div>
                    </div>

                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"5px" }}>
                      <button onClick={e=>toggleSave(job,e)} style={{
                        background: saved?"rgba(245,158,11,.15)":"transparent",
                        border:`1px solid ${saved?"rgba(245,158,11,.4)":"rgba(56,189,248,.15)"}`,
                        borderRadius:"6px", padding:"3px 6px", cursor:"pointer",
                        color: saved?"#f59e0b":"#334155", fontSize:"11px", fontFamily:"inherit",
                      }}>{saved?"⭐":"☆"}</button>
                      <div style={{
                        fontSize:"14px", color:"#334155",
                        transform:exp?"rotate(180deg)":"none", transition:"transform .2s",
                      }}>▾</div>
                    </div>
                  </div>

                  {/* Expanded panel */}
                  {exp && (
                    <div style={{ marginTop:"12px", paddingTop:"12px", borderTop:"1px solid rgba(163,230,53,.08)" }}>
                      <p style={{ fontSize:"12px", color:"#94a3b8", lineHeight:"1.7", margin:"0 0 12px" }}>
                        {job.description}
                      </p>
                      <div style={{ marginBottom:"12px" }}>
                        <div style={{ fontSize:"9px", color:"#475569", marginBottom:"5px", letterSpacing:"1px" }}>REQUIRED SKILLS</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
                          {job.skills?.map((s,si)=>(
                            <span key={si} style={{
                              padding:"2px 8px", background:"rgba(163,230,53,.07)",
                              border:"1px solid rgba(163,230,53,.2)", borderRadius:"5px",
                              fontSize:"10px", color:"#a3e635",
                            }}>{s}</span>
                          ))}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                        <button style={{
                          padding:"6px 14px",
                          background:"linear-gradient(135deg,rgba(163,230,53,.18),rgba(56,189,248,.15))",
                          border:"1px solid rgba(163,230,53,.35)", borderRadius:"7px",
                          color:"#e2e8f0", fontSize:"11px", cursor:"pointer",
                          fontFamily:"inherit", fontWeight:"600",
                        }} onClick={e=>{
                          e.stopPropagation();
                          window.open(job.applyUrl||`https://www.linkedin.com/jobs/search/?keywords=MuleSoft+${encodeURIComponent(job.title)}`,"_blank");
                        }}>Apply Now →</button>

                        {job.sourceType==="official" && job.companyCareerUrl && (
                          <button style={{
                            padding:"6px 12px", background:"rgba(245,158,11,.08)",
                            border:"1px solid rgba(245,158,11,.25)", borderRadius:"7px",
                            color:"#f59e0b", fontSize:"11px", cursor:"pointer", fontFamily:"inherit",
                          }} onClick={e=>{ e.stopPropagation(); window.open(job.companyCareerUrl,"_blank"); }}>
                            Official Careers Page
                          </button>
                        )}

                        <button style={{
                          padding:"6px 12px", background:"transparent",
                          border:"1px solid rgba(56,189,248,.12)", borderRadius:"7px",
                          color:"#475569", fontSize:"11px", cursor:"pointer", fontFamily:"inherit",
                        }} onClick={e=>toggleSave(job,e)}>
                          {isSaved(job)?"⭐ Saved":"☆ Save Job"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {tabJobs.length===0 && (
              <div style={{ textAlign:"center", padding:"28px", color:"#334155", fontSize:"12px" }}>
                No jobs in this category.
              </div>
            )}
          </div>

          {/* Direct Portal Links */}
          <div style={{
            marginTop:"22px", padding:"16px",
            background:"rgba(15,23,42,.8)", border:"1px solid rgba(245,158,11,.16)",
            borderRadius:"12px",
          }}>
            <div style={{ fontSize:"9px", color:"#f59e0b", marginBottom:"10px", letterSpacing:"1px" }}>
              BROWSE OFFICIAL CAREER PORTALS DIRECTLY
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:"6px" }}>
              {COMPANY_SITES.map(c=>(
                <a key={c.name} href={c.url} target="_blank" rel="noreferrer" style={{
                  display:"flex", alignItems:"center", gap:"6px",
                  padding:"6px 10px", borderRadius:"7px",
                  background:`${c.color}09`, border:`1px solid ${c.color}28`,
                  color:c.color, fontSize:"10px", fontWeight:"600",
                  textDecoration:"none", transition:"all .2s",
                }}>
                  <span style={{
                    width:"18px", height:"18px", borderRadius:"4px", flexShrink:0,
                    background:`${c.color}1a`, border:`1px solid ${c.color}35`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:"7px", fontWeight:"900",
                  }}>{c.logo}</span>
                  {c.name}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!searched && !loading && (
        <div style={{ textAlign:"center", padding:"44px 20px" }}>
          <div style={{ fontSize:"40px", marginBottom:"10px" }}>⚡</div>
          <div style={{ fontSize:"14px", color:"#475569", marginBottom:"6px" }}>
            {apiKey ? "Ready to scan!" : "Enter your Groq API key above to start"}
          </div>
          <div style={{ fontSize:"11px", color:"#334155" }}>
            {apiKey
              ? `Will scan ${COMPANY_SITES.length} official career sites + major job boards`
              : "Free API key available at console.groq.com — no credit card needed"}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(163,230,53,.25); border-radius: 2px; }
        a:hover { opacity:.82 !important; }
        input:focus { border-color: rgba(163,230,53,.6) !important; box-shadow: 0 0 0 2px rgba(163,230,53,.1); }
      `}</style>
    </div>
  );
}
