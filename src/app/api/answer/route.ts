import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { buildDBContext } from "@/lib/answer-engine";

// ─── Types ───

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnswerRequest {
  question: string;
  persona: string;
  conversationHistory?: ConversationMessage[];
}

interface UploadedContent {
  filename: string;
  uploadedAt: string;
  content: string;
  charCount: number;
}

// SSE event types
interface SSEChunkEvent {
  type: "chunk";
  text: string;
}

interface SSEDoneEvent {
  type: "done";
  confidence: number;
  sources: string[];
  followups: string[];
}

interface SSEErrorEvent {
  type: "error";
  error: string;
  errorCode?: string;
}

type SSEEvent = SSEChunkEvent | SSEDoneEvent | SSEErrorEvent;

// ─── Load company context once at module level ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let companyContext: any;
try {
  const raw = readFileSync(
    join(process.cwd(), "data", "company-context.json"),
    "utf-8"
  );
  companyContext = JSON.parse(raw);
} catch (err) {
  console.error("[/api/answer] Failed to load company-context.json:", err);
  companyContext = null;
}

// ─── Load uploaded document content (read fresh each request) ───

const CONTENT_FILE = join(process.cwd(), "data", "uploaded-content.json");
const UPDATES_FILE = join(process.cwd(), "data", "updates.json");

// ─── Load Neumm updates (knowledge base) ───

interface CIBUpdate {
  id: string;
  topic: string;
  content: string;
  files: { filename: string; extractedText: string | null }[];
  author: string;
  timestamp: string;
  extractedContent: string;
  superseded: boolean;
}

function loadCIBUpdates(): CIBUpdate[] {
  try {
    if (existsSync(UPDATES_FILE)) {
      const raw = readFileSync(UPDATES_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    console.warn("[/api/answer] Could not read updates.json");
  }
  return [];
}

function getActiveUpdates(): CIBUpdate[] {
  const all = loadCIBUpdates();
  // Group by topic, keep only non-superseded
  return all.filter((u) => !u.superseded);
}

function findRelevantUpdates(question: string): CIBUpdate[] {
  const activeUpdates = getActiveUpdates();
  if (activeUpdates.length === 0) return [];

  const questionLower = question.toLowerCase();
  // Extract keywords (words > 3 chars, minus stopwords)
  const stopWords = new Set(["what", "is", "the", "a", "an", "how", "why", "when", "where", "who", "are", "do", "does", "can", "will", "should", "would", "could", "this", "that", "these", "those", "with", "from", "about", "into", "have", "has", "been", "being", "more", "most", "some", "than", "then", "also", "just", "only", "very", "much", "tell", "give", "list", "show", "describe"]);
  const keywords = questionLower
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .map((w) => w.replace(/[^a-z0-9]/g, ""));

  const scored = activeUpdates.map((update) => {
    let score = 0;
    const updateText = `${update.topic} ${update.content} ${update.extractedContent}`.toLowerCase();

    for (const kw of keywords) {
      if (updateText.includes(kw)) score += 2;
    }

    // Boost recent updates
    const daysOld = (Date.now() - new Date(update.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld < 7) score += 3;
    else if (daysOld < 30) score += 1;

    // Boost if topic matches question keywords
    const topicLower = update.topic.toLowerCase();
    for (const kw of keywords) {
      if (topicLower.includes(kw)) score += 5;
    }

    return { update, score };
  });

  // Return top 5 most relevant with score > 0, or all if few
  const relevant = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.update);

  // If no keywords matched but we have updates, include most recent ones
  if (relevant.length === 0 && activeUpdates.length > 0) {
    return activeUpdates.slice(0, 3);
  }

  return relevant;
}

function buildUpdatesContext(question: string): string {
  const relevant = findRelevantUpdates(question);
  if (relevant.length === 0) return "";

  const sections = relevant.map((u) => {
    let section = `Topic: ${u.topic}\nProvided by: ${u.author} on ${new Date(u.timestamp).toLocaleDateString()}`;
    if (u.content) section += `\nContent: ${u.content}`;
    if (u.extractedContent) {
      const truncated = u.extractedContent.length > 3000
        ? u.extractedContent.slice(0, 3000) + "\n... [truncated]"
        : u.extractedContent;
      section += `\nAttached Document Content:\n${truncated}`;
    }
    return section;
  });

  return `\n\nRECENT UPDATES FROM INITIATIVE OWNERS (${relevant.length} relevant update${relevant.length > 1 ? "s" : ""} — these are MORE CURRENT than the base context):\n${sections.join("\n\n")}`;
}

function getUpdateSourceLabels(question: string): string[] {
  const relevant = findRelevantUpdates(question);
  return relevant.map((u) => {
    const date = new Date(u.timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let timeAgo: string;
    if (diffHours < 1) timeAgo = "just now";
    else if (diffHours < 24) timeAgo = `${diffHours}h ago`;
    else if (diffDays < 7) timeAgo = `${diffDays}d ago`;
    else timeAgo = date.toLocaleDateString();

    return `📝 Update: ${u.topic} (${u.author}, ${timeAgo})`;
  });
}

function loadUploadedContent(): UploadedContent[] {
  try {
    if (existsSync(CONTENT_FILE)) {
      const raw = readFileSync(CONTENT_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    console.warn("[/api/answer] Could not read uploaded-content.json");
  }
  return [];
}

// ─── Keyword-based relevance matching for uploaded docs ───

const KEYWORD_MAP: Record<string, string[]> = {
  meeting: ["meeting", "notes", "minutes", "agenda", "discussion", "action items", "attendees"],
  requirements: ["requirements", "specs", "specification", "functional", "non-functional", "user story", "acceptance criteria"],
  design: ["design", "wireframe", "mockup", "figma", "ui", "ux", "layout", "prototype"],
  technical: ["technical", "architecture", "api", "database", "schema", "endpoint", "code", "implementation"],
  planning: ["planning", "roadmap", "timeline", "milestone", "sprint", "backlog", "epic"],
  report: ["report", "analysis", "metrics", "kpi", "performance", "dashboard", "summary"],
  legal: ["legal", "contract", "agreement", "terms", "compliance", "policy", "regulation"],
  customer: ["customer", "feedback", "survey", "support", "ticket", "complaint", "restaurant", "venue"],
  payments: ["payment", "stripe", "square", "pci", "card", "refund", "split", "tips"],
  kitchen: ["kitchen", "kds", "order", "menu", "modifier", "routing", "bar"],
};

function getRelevantUploads(question: string): UploadedContent[] {
  const uploads = loadUploadedContent();
  if (uploads.length === 0) return [];

  const questionLower = question.toLowerCase();

  const scored = uploads.map((doc) => {
    let score = 0;
    const filenameLower = doc.filename.toLowerCase();
    const contentLower = doc.content.toLowerCase().slice(0, 2000);

    for (const [, keywords] of Object.entries(KEYWORD_MAP)) {
      for (const kw of keywords) {
        if (questionLower.includes(kw)) {
          if (filenameLower.includes(kw)) score += 3;
          if (contentLower.includes(kw)) score += 1;
        }
      }
    }

    const filenameBase = filenameLower.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    if (questionLower.includes(filenameBase) || questionLower.includes(filenameLower)) {
      score += 10;
    }

    return { doc, score };
  });

  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  if (relevant.length === 0 && uploads.length > 0) {
    const broadTerms = ["document", "file", "upload", "attached", "shared", "provided"];
    const isBroadDocQuestion = broadTerms.some((term) => questionLower.includes(term));
    if (isBroadDocQuestion) {
      return uploads.slice(-3);
    }
    return [];
  }

  return relevant.map((s) => s.doc);
}

function buildUploadedContentContext(question: string): string {
  const relevantDocs = getRelevantUploads(question);
  if (relevantDocs.length === 0) return "";

  const sections = relevantDocs.map((u) => {
    const truncatedContent =
      u.content.length > 5000
        ? u.content.slice(0, 5000) + "\n... [truncated]"
        : u.content;
    return `Filename: ${u.filename}\nUploaded: ${new Date(u.uploadedAt).toLocaleDateString()}\nContent:\n${truncatedContent}`;
  });

  return `\n\nUPLOADED DOCUMENTS (${relevantDocs.length} relevant file${relevantDocs.length > 1 ? "s" : ""}):\n${sections.join("\n\n")}`;
}

function getUploadedSourceLabels(question: string): string[] {
  const relevantDocs = getRelevantUploads(question);
  if (relevantDocs.length === 0) return [];

  return relevantDocs.map((doc) => {
    const uploadDate = new Date(doc.uploadedAt);
    const now = new Date();
    const diffMs = now.getTime() - uploadDate.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let timeAgo: string;
    if (diffHours < 1) timeAgo = "just now";
    else if (diffHours < 24) timeAgo = `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    else if (diffDays < 7) timeAgo = `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    else timeAgo = uploadDate.toLocaleDateString();

    return `📄 ${doc.filename} (uploaded ${timeAgo})`;
  });
}

// ─── Persona → AI provider routing ───

const GPT4_PERSONAS = new Set(["developer", "technical-services"]);

const PERSONA_LABELS: Record<string, string> = {
  developer: "Developer",
  "product-manager": "Product Manager",
  executive: "Executive",
  sales: "Sales",
  marketing: "Marketing",
  "customer-support": "Customer Support",
  "customer-success": "Customer Success",
  "technical-services": "Technical Services",
  legal: "Legal",
  design: "Design",
};

// ─── Question type classification ───

type QuestionType = "requirements" | "status" | "team" | "risks" | "tech" | "customers" | "comparison" | "general";

function classifyQuestion(question: string): QuestionType {
  const q = question.toLowerCase();

  // Requirements / features / scope
  if (/\b(requirements?|features?|scope|mvp|phase\s*[12]|what('s| is| are).*(?:included?|built|building|deliver|support)|capabilities|functionality|modules?|what can|what does)\b/.test(q)) {
    return "requirements";
  }
  // Status / progress / timeline
  if (/\b(status|progress|timeline|milestone|completion|complete|deadline|schedule|launch|when|how far|on track|blockers?|blocking|update|updates)\b/.test(q)) {
    return "status";
  }
  // Team / people / responsibilities
  if (/\b(team|who|members?|roles?|responsibilities|people|staff|engineer|developer|designer|lead|manager|owns?|working on|assigned)\b/.test(q)) {
    return "team";
  }
  // Risks / challenges / issues
  if (/\b(risks?|challenges?|issues?|problems?|concerns?|threats?|vulnerabilit|mitigation|what could go wrong|worr)\b/.test(q)) {
    return "risks";
  }
  // Tech stack / architecture / implementation
  if (/\b(tech\s*stack|architecture|infrastructure|technology|technologies|framework|database|backend|frontend|api|hosting|cloud|aws|react|node|postgres|redis|websocket|stripe|square)\b/.test(q)) {
    return "tech";
  }
  // Customer / pilot / research / feedback
  if (/\b(customers?|pilots?|restaurants?|research|feedback|pain\s*points?|user\s*research|venues?|urban\s*fork|bean.*leaf|sapore)\b/.test(q)) {
    return "customers";
  }
  // Comparison / competitors
  if (/\b(competitors?|comparison|compare|vs|versus|lightspeed|toast|square pos|how do we|different from|better than|advantage)\b/.test(q)) {
    return "comparison";
  }

  return "general";
}

// ─── Response depth guidance based on question type ───

function getResponseDepthGuidance(questionType: QuestionType): string {
  switch (questionType) {
    case "requirements":
      return `RESPONSE DEPTH — COMPREHENSIVE LIST REQUIRED:
You MUST list EVERY SINGLE item from the context. Do NOT summarize or skip items.
- For MVP features: list ALL 16 features as numbered bullet points with brief descriptions
- For Phase 2 features: list ALL 9 features as numbered bullet points
- For requirements: list every requirement, specification, and constraint
- Include performance targets, compliance requirements, and open questions
- Group items by category (e.g., "Order Management", "Payments", "Kitchen", "Reporting")
- For each feature, add a 1-line detail from context (who's building it, status, key decision)
- This response should be LONG and THOROUGH — 400-800 words is appropriate
- Do NOT say "and more" or "including" — list EVERYTHING explicitly`;

    case "status":
      return `RESPONSE DEPTH — DETAILED STATUS REPORT:
Provide a comprehensive status update covering:
- Overall completion percentage and launch date
- Each milestone with its current status
- Recent updates with dates and who did what
- What's in progress right now and who owns it
- What's blocking progress or needs decisions
- Open questions that affect the timeline
- This response should be 300-500 words`;

    case "team":
      return `RESPONSE DEPTH — COMPLETE TEAM OVERVIEW:
List EVERY team member with their role, focus area, and recent contributions.
- Name, title, and primary responsibilities
- Recent decisions they made (with dates)
- Recent work they completed (with dates)
- What they're currently working on
- Risk areas they own
- This response should be 300-500 words`;

    case "risks":
      return `RESPONSE DEPTH — COMPREHENSIVE RISK ANALYSIS:
List EVERY identified risk with full details:
- Risk description
- Mitigation strategy
- Owner responsible
- Open questions that create additional risk
- Compliance requirements that pose risk if missed
- Performance targets that are at risk
- This response should be 300-500 words`;

    case "tech":
      return `RESPONSE DEPTH — COMPLETE TECHNICAL OVERVIEW:
Cover the entire technology stack with details:
- Every technology/framework with its purpose
- Architecture decisions and reasoning
- Performance targets and benchmarks
- Offline capabilities and how they work
- Security and compliance implementation
- Open technical questions
- This response should be 300-500 words`;

    case "customers":
      return `RESPONSE DEPTH — DETAILED CUSTOMER INSIGHTS:
Cover all customer and research data:
- Every pilot restaurant with full details (name, type, seats, location, status, notes)
- All pain points with frequency data
- All desired outcomes
- Research methodology and key findings
- How customer feedback shaped product decisions
- This response should be 300-500 words`;

    case "comparison":
      return `RESPONSE DEPTH — THOROUGH COMPETITIVE ANALYSIS:
Compare in detail:
- Each competitor with strengths, weaknesses, and market position
- How PlateOS differentiates on each dimension
- Specific metrics and features where we have an advantage
- Market gaps we fill
- This response should be 300-500 words`;

    default:
      return `RESPONSE DEPTH — DETAILED ANSWER:
Provide a thorough, well-structured answer. Use bullet points for lists.
- Include specific names, dates, and numbers from context
- Cover all relevant aspects of the topic
- 200-400 words is typical for general questions`;
  }
}

// ─── Context builder: pick relevant slices per persona + question type ───

function buildContextForPersona(persona: string, question: string): string {
  if (!companyContext) return "No company context available.";

  const ctx = companyContext;
  const questionType = classifyQuestion(question);
  const sections: string[] = [];

  // Always include company overview & project status
  sections.push(
    `COMPANY: ${ctx.company.name} — ${ctx.company.industry}, ${ctx.company.employees} employees, ${ctx.company.headquarters}. ${ctx.company.revenue}. ${ctx.company.customers}. Mission: ${ctx.company.mission}`
  );

  sections.push(
    `PROJECT: ${ctx.project.name}\n` +
      `  Status: ${ctx.project.status}\n` +
      `  Last Updated: ${ctx.project.lastUpdated}\n` +
      `  Timeline: ${ctx.project.timeline}\n` +
      `  Priority: ${ctx.project.priority}\n` +
      `  Budget: ${ctx.project.budget}\n` +
      `  Milestones:\n` +
      ctx.project.milestones
        .map(
          (m: { name: string; status: string; date: string }) =>
            `    - ${m.name}: ${m.status} (${m.date})`
        )
        .join("\n")
  );

  // ─── For comprehensive question types, provide ALL relevant context regardless of persona ───

  if (questionType === "requirements") {
    sections.push(
      `MVP FEATURES (${ctx.mvpFeatures.length} items — you MUST list EVERY one):\n` +
        ctx.mvpFeatures.map((f: string, i: number) => `  ${i + 1}. ${f}`).join("\n")
    );
    sections.push(
      `PHASE 2 FEATURES (deferred to 2027 — ${ctx.phase2Features.length} items):\n` +
        ctx.phase2Features.map((f: string, i: number) => `  ${i + 1}. ${f}`).join("\n")
    );
    sections.push(
      `TECH STACK:\n` +
        Object.entries(ctx.techStack)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n")
    );
    sections.push(
      `KEY DECISIONS (that shaped requirements):\n` +
        ctx.decisions
          .map(
            (d: { date: string; decision: string; reasoning: string; decidedBy: string }) =>
              `  - [${d.date}] ${d.decision} — Reason: ${d.reasoning}. Decided by ${d.decidedBy}`
          )
          .join("\n")
    );
    sections.push(
      `OPEN QUESTIONS (unresolved scope items):\n` +
        ctx.openQuestions.map((q: string) => `  - ${q}`).join("\n")
    );
    sections.push(
      `PERFORMANCE TARGETS:\n` +
        `  Order Latency: ${ctx.metrics.orderLatencyTarget}\n` +
        `  Uptime: ${ctx.metrics.uptimeTarget}\n` +
        `  Payment Success: ${ctx.metrics.paymentSuccessRate}\n` +
        `  Error Rate: ${ctx.metrics.errorRateTarget}\n` +
        `  Peak Orders/Hour: ${ctx.metrics.peakOrdersPerHour}`
    );
    sections.push(
      `COMPLIANCE REQUIREMENTS:\n` +
        ctx.compliance.requirements.map((r: string) => `  - ${r}`).join("\n") +
        `\n  Implementation:\n` +
        ctx.compliance.implementation.map((i: string) => `  - ${i}`).join("\n")
    );
    sections.push(
      `CUSTOMER PAIN POINTS (drove requirements):\n` +
        ctx.customers.topPainPoints.map((p: string) => `  - ${p}`).join("\n")
    );
    sections.push(
      `CUSTOMER DESIRED OUTCOMES:\n` +
        ctx.customers.desiredOutcomes.map((o: string) => `  - ${o}`).join("\n")
    );
    sections.push(
      `PILOT RESTAURANTS:\n` +
        ctx.customers.pilot
          .map(
            (p: { name: string; type: string; seats: number | string; location: string; status: string; notes: string }) =>
              `  - ${p.name} (${p.type}, ${p.seats} seats, ${p.location}) — ${p.status}. ${p.notes}`
          )
          .join("\n")
    );
    return sections.join("\n\n");
  }

  if (questionType === "status") {
    sections.push(
      `TEAM:\n` +
        ctx.team
          .map(
            (t: { name: string; role: string; focus: string }) =>
              `  - ${t.name} (${t.role}) — ${t.focus}`
          )
          .join("\n")
    );
    sections.push(
      `ALL RECENT UPDATES (chronological):\n` +
        ctx.recentUpdates
          .map(
            (u: { date: string; update: string; category: string }) =>
              `  - [${u.date}] [${u.category}] ${u.update}`
          )
          .join("\n")
    );
    sections.push(
      `KEY DECISIONS:\n` +
        ctx.decisions
          .map(
            (d: { date: string; decision: string; decidedBy: string }) =>
              `  - [${d.date}] ${d.decision} — by ${d.decidedBy}`
          )
          .join("\n")
    );
    sections.push(
      `OPEN QUESTIONS:\n` +
        ctx.openQuestions.map((q: string) => `  - ${q}`).join("\n")
    );
    sections.push(
      `RISKS:\n` +
        ctx.risks
          .map((r: { risk: string; mitigation: string; owner: string }) =>
            `  - ${r.risk} → Mitigation: ${r.mitigation} (Owner: ${r.owner})`
          )
          .join("\n")
    );
    return sections.join("\n\n");
  }

  if (questionType === "team") {
    sections.push(
      `TEAM (${ctx.team.length} members):\n` +
        ctx.team
          .map(
            (t: { name: string; role: string; focus: string }) =>
              `  - ${t.name} (${t.role}) — Focus: ${t.focus}`
          )
          .join("\n")
    );
    sections.push(
      `DECISIONS (who decided what):\n` +
        ctx.decisions
          .map(
            (d: { date: string; decision: string; reasoning: string; decidedBy: string }) =>
              `  - [${d.date}] ${d.decision} — Decided by ${d.decidedBy}. Reason: ${d.reasoning}`
          )
          .join("\n")
    );
    sections.push(
      `RECENT UPDATES (who did what):\n` +
        ctx.recentUpdates
          .map(
            (u: { date: string; update: string; category: string }) =>
              `  - [${u.date}] [${u.category}] ${u.update}`
          )
          .join("\n")
    );
    sections.push(
      `RISKS (ownership):\n` +
        ctx.risks
          .map((r: { risk: string; owner: string }) =>
            `  - ${r.risk} — Owner: ${r.owner}`
          )
          .join("\n")
    );
    return sections.join("\n\n");
  }

  if (questionType === "risks") {
    sections.push(
      `RISKS (${ctx.risks.length} identified):\n` +
        ctx.risks
          .map((r: { risk: string; mitigation: string; owner: string }) =>
            `  - RISK: ${r.risk}\n    Mitigation: ${r.mitigation}\n    Owner: ${r.owner}`
          )
          .join("\n")
    );
    sections.push(
      `OPEN QUESTIONS (potential risk areas):\n` +
        ctx.openQuestions.map((q: string) => `  - ${q}`).join("\n")
    );
    sections.push(
      `COMPLIANCE REQUIREMENTS:\n` +
        ctx.compliance.requirements.map((r: string) => `  - ${r}`).join("\n")
    );
    sections.push(
      `PERFORMANCE TARGETS (risk if missed):\n` +
        `  Order Latency: ${ctx.metrics.orderLatencyTarget}\n` +
        `  Uptime: ${ctx.metrics.uptimeTarget}\n` +
        `  Payment Success: ${ctx.metrics.paymentSuccessRate}\n` +
        `  Error Rate: ${ctx.metrics.errorRateTarget}\n` +
        `  Peak Orders/Hour: ${ctx.metrics.peakOrdersPerHour}`
    );
    sections.push(
      `COMPETITORS (competitive risks):\n` +
        ctx.competitors
          .map(
            (c: { name: string; strength: string; weakness: string; posTimeline: string }) =>
              `  - ${c.name}: Strength: ${c.strength}. Weakness: ${c.weakness}. Status: ${c.posTimeline}`
          )
          .join("\n")
    );
    return sections.join("\n\n");
  }

  if (questionType === "tech") {
    sections.push(
      `TECH STACK (complete):\n` +
        Object.entries(ctx.techStack)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n")
    );
    sections.push(
      `MVP FEATURES (${ctx.mvpFeatures.length} items):\n` +
        ctx.mvpFeatures.map((f: string) => `  - ${f}`).join("\n")
    );
    sections.push(
      `TECHNICAL DECISIONS:\n` +
        ctx.decisions
          .map(
            (d: { date: string; decision: string; reasoning: string; decidedBy: string }) =>
              `  - [${d.date}] ${d.decision} (Reason: ${d.reasoning}) — Decided by ${d.decidedBy}`
          )
          .join("\n")
    );
    sections.push(
      `PERFORMANCE TARGETS:\n` +
        `  Order Latency: ${ctx.metrics.orderLatencyTarget}\n` +
        `  Uptime: ${ctx.metrics.uptimeTarget}\n` +
        `  Payment Success: ${ctx.metrics.paymentSuccessRate}\n` +
        `  Error Rate: ${ctx.metrics.errorRateTarget}\n` +
        `  Peak Orders/Hour: ${ctx.metrics.peakOrdersPerHour}`
    );
    sections.push(
      `COMPLIANCE:\n` +
        `  Certifications: ${ctx.compliance.certifications.join(", ")}\n` +
        `  Implementation:\n` +
        ctx.compliance.implementation.map((i: string) => `    - ${i}`).join("\n")
    );
    sections.push(
      `OPEN QUESTIONS (technical):\n` +
        ctx.openQuestions.map((q: string) => `  - ${q}`).join("\n")
    );
    sections.push(
      `RISKS:\n` +
        ctx.risks
          .map((r: { risk: string; mitigation: string; owner: string }) =>
            `  - ${r.risk} → Mitigation: ${r.mitigation} (Owner: ${r.owner})`
          )
          .join("\n")
    );
    sections.push(
      `RECENT TECHNICAL UPDATES:\n` +
        ctx.recentUpdates
          .filter(
            (u: { category: string }) =>
              u.category === "Development" ||
              u.category === "Engineering" ||
              u.category === "QA"
          )
          .map(
            (u: { date: string; update: string }) =>
              `  - [${u.date}] ${u.update}`
          )
          .join("\n")
    );
    return sections.join("\n\n");
  }

  if (questionType === "customers") {
    sections.push(
      `PILOT RESTAURANTS (${ctx.customers.pilot.length} venues):\n` +
        ctx.customers.pilot
          .map(
            (p: { name: string; type: string; seats: number | string; location: string; status: string; notes: string }) =>
              `  - ${p.name} (${p.type}, ${p.seats} seats, ${p.location}) — ${p.status}. ${p.notes}`
          )
          .join("\n")
    );
    sections.push(
      `TOP PAIN POINTS (from research):\n` +
        ctx.customers.topPainPoints.map((p: string) => `  - ${p}`).join("\n")
    );
    sections.push(
      `DESIRED OUTCOMES:\n` +
        ctx.customers.desiredOutcomes.map((o: string) => `  - ${o}`).join("\n")
    );
    sections.push(
      `RESEARCH:\n` +
        `  Sources: ${ctx.research.sources.join("; ")}\n` +
        `  Methodology: ${ctx.research.methodology}\n` +
        `  Key Findings:\n` +
        ctx.research.keyFindings.map((f: string) => `    - ${f}`).join("\n")
    );
    sections.push(
      `MVP FEATURES (what pilots will get):\n` +
        ctx.mvpFeatures.map((f: string) => `  - ${f}`).join("\n")
    );
    sections.push(
      `PHASE 2 (what pilots are waiting for):\n` +
        ctx.phase2Features.map((f: string) => `  - ${f}`).join("\n")
    );
    return sections.join("\n\n");
  }

  if (questionType === "comparison") {
    sections.push(
      `COMPETITORS (${ctx.competitors.length}):\n` +
        ctx.competitors
          .map(
            (c: { name: string; strength: string; weakness: string; posTimeline: string }) =>
              `  - ${c.name}:\n    Strength: ${c.strength}\n    Weakness: ${c.weakness}\n    Status: ${c.posTimeline}`
          )
          .join("\n")
    );
    sections.push(
      `OUR MVP FEATURES (${ctx.mvpFeatures.length} items):\n` +
        ctx.mvpFeatures.map((f: string) => `  - ${f}`).join("\n")
    );
    sections.push(
      `PERFORMANCE TARGETS:\n` +
        `  Order Latency: ${ctx.metrics.orderLatencyTarget}\n` +
        `  Uptime: ${ctx.metrics.uptimeTarget}\n` +
        `  Peak Orders/Hour: ${ctx.metrics.peakOrdersPerHour}`
    );
    sections.push(
      `RESEARCH FINDINGS:\n` +
        ctx.research.keyFindings.map((f: string) => `  - ${f}`).join("\n")
    );
    return sections.join("\n\n");
  }

  // ─── "general" question type: use persona-based context (expanded) ───

  switch (persona) {
    case "developer":
    case "technical-services":
      sections.push(
        `TECH STACK:\n` +
          Object.entries(ctx.techStack)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n")
      );
      sections.push(
        `MVP FEATURES (${ctx.mvpFeatures.length} items):\n` +
          ctx.mvpFeatures.map((f: string) => `  - ${f}`).join("\n")
      );
      sections.push(
        `RECENT TECHNICAL DECISIONS:\n` +
          ctx.decisions
            .map(
              (d: { date: string; decision: string; reasoning: string; decidedBy: string }) =>
                `  - [${d.date}] ${d.decision} (Reason: ${d.reasoning}) — Decided by ${d.decidedBy}`
            )
            .join("\n")
      );
      sections.push(
        `OPEN QUESTIONS:\n` +
          ctx.openQuestions.map((q: string) => `  - ${q}`).join("\n")
      );
      sections.push(
        `PERFORMANCE TARGETS:\n` +
          `  Order Latency: ${ctx.metrics.orderLatencyTarget}\n` +
          `  Uptime: ${ctx.metrics.uptimeTarget}\n` +
          `  Payment Success: ${ctx.metrics.paymentSuccessRate}\n` +
          `  Error Rate: ${ctx.metrics.errorRateTarget}\n` +
          `  Peak Orders/Hour: ${ctx.metrics.peakOrdersPerHour}`
      );
      sections.push(
        `RISKS:\n` +
          ctx.risks
            .map((r: { risk: string; mitigation: string; owner: string }) =>
              `  - ${r.risk} → Mitigation: ${r.mitigation} (Owner: ${r.owner})`
            )
            .join("\n")
      );
      sections.push(
        `RECENT UPDATES:\n` +
          ctx.recentUpdates
            .filter(
              (u: { category: string }) =>
                u.category === "Development" ||
                u.category === "Engineering" ||
                u.category === "QA"
            )
            .map(
              (u: { date: string; update: string }) =>
                `  - [${u.date}] ${u.update}`
            )
            .join("\n")
      );
      break;

    case "product-manager":
      sections.push(
        `TEAM:\n` +
          ctx.team
            .map(
              (t: { name: string; role: string; focus: string }) =>
                `  - ${t.name} (${t.role}) — ${t.focus}`
            )
            .join("\n")
      );
      sections.push(
        `DECISIONS:\n` +
          ctx.decisions
            .map(
              (d: { date: string; decision: string; reasoning: string; decidedBy: string }) =>
                `  - [${d.date}] ${d.decision} — Decided by ${d.decidedBy}. Reason: ${d.reasoning}`
            )
            .join("\n")
      );
      sections.push(
        `OPEN QUESTIONS:\n` +
          ctx.openQuestions.map((q: string) => `  - ${q}`).join("\n")
      );
      sections.push(
        `MVP FEATURES (${ctx.mvpFeatures.length} items):\n` +
          ctx.mvpFeatures.map((f: string) => `  - ${f}`).join("\n")
      );
      sections.push(
        `PHASE 2 (deferred):\n` +
          ctx.phase2Features.map((f: string) => `  - ${f}`).join("\n")
      );
      sections.push(
        `CUSTOMER RESEARCH — TOP PAIN POINTS:\n` +
          ctx.customers.topPainPoints.map((p: string) => `  - ${p}`).join("\n")
      );
      sections.push(
        `PILOT RESTAURANTS:\n` +
          ctx.customers.pilot
            .map(
              (p: { name: string; type: string; seats: number | string; status: string; notes: string }) =>
                `  - ${p.name} (${p.type}, ${p.seats} seats) — ${p.status}. ${p.notes}`
            )
            .join("\n")
      );
      break;

    case "executive":
      sections.push(
        `KEY METRICS:\n` +
          `  Order Latency Target: ${ctx.metrics.orderLatencyTarget}\n` +
          `  Uptime Target: ${ctx.metrics.uptimeTarget}\n` +
          `  Pilot Restaurants: ${ctx.metrics.pilotRestaurants}\n` +
          `  Avg Order Value: ${ctx.metrics.avgOrderValue}\n` +
          `  Peak Orders/Hour: ${ctx.metrics.peakOrdersPerHour}`
      );
      sections.push(
        `COMPETITORS:\n` +
          ctx.competitors
            .map(
              (c: { name: string; strength: string; weakness: string; posTimeline: string }) =>
                `  - ${c.name}: Strength: ${c.strength}. Weakness: ${c.weakness}. Status: ${c.posTimeline}`
            )
            .join("\n")
      );
      sections.push(
        `PILOT RESTAURANTS:\n` +
          ctx.customers.pilot
            .map(
              (p: { name: string; type: string; seats: number | string; status: string; notes: string }) =>
                `  - ${p.name} (${p.type}, ${p.seats} seats) — ${p.status}. ${p.notes}`
            )
            .join("\n")
      );
      sections.push(
        `RISKS:\n` +
          ctx.risks
            .map((r: { risk: string; mitigation: string; owner: string }) =>
              `  - ${r.risk} (Owner: ${r.owner})`
            )
            .join("\n")
      );
      break;

    case "sales":
      sections.push(
        `PILOT RESTAURANTS:\n` +
          ctx.customers.pilot
            .map(
              (p: { name: string; type: string; seats: number | string; location: string; status: string; notes: string }) =>
                `  - ${p.name} (${p.type}, ${p.location}) — ${p.status}. ${p.notes}`
            )
            .join("\n")
      );
      sections.push(
        `COMPETITORS:\n` +
          ctx.competitors
            .map(
              (c: { name: string; strength: string; weakness: string }) =>
                `  - ${c.name}: Strength: ${c.strength}. Weakness: ${c.weakness}`
            )
            .join("\n")
      );
      sections.push(
        `MVP FEATURES (selling points):\n` +
          ctx.mvpFeatures.map((f: string) => `  - ${f}`).join("\n")
      );
      sections.push(
        `PHASE 2 (do NOT promise yet):\n` +
          ctx.phase2Features.map((f: string) => `  - ${f}`).join("\n")
      );
      sections.push(
        `CUSTOMER DESIRED OUTCOMES:\n` +
          ctx.customers.desiredOutcomes.map((o: string) => `  - ${o}`).join("\n")
      );
      break;

    case "marketing":
      sections.push(
        `COMPETITORS:\n` +
          ctx.competitors
            .map(
              (c: { name: string; strength: string; weakness: string }) =>
                `  - ${c.name}: Strength: ${c.strength}. Weakness: ${c.weakness}`
            )
            .join("\n")
      );
      sections.push(
        `KEY METRICS: ${ctx.metrics.pilotRestaurants} pilot restaurants, Avg order $${ctx.metrics.avgOrderValue}, Peak ${ctx.metrics.peakOrdersPerHour} orders/hour`
      );
      sections.push(
        `CUSTOMER PAIN POINTS:\n` +
          ctx.customers.topPainPoints.map((p: string) => `  - ${p}`).join("\n")
      );
      sections.push(
        `DESIRED OUTCOMES:\n` +
          ctx.customers.desiredOutcomes.map((o: string) => `  - ${o}`).join("\n")
      );
      sections.push(
        `RESEARCH FINDINGS:\n` +
          ctx.research.keyFindings.map((f: string) => `  - ${f}`).join("\n")
      );
      break;

    case "customer-support":
      sections.push(
        `TECH STACK: ${ctx.techStack.frontend} frontend, ${ctx.techStack.backend} backend, ${ctx.techStack.payments} payments`
      );
      sections.push(
        `MVP FEATURES:\n` +
          ctx.mvpFeatures.map((f: string) => `  - ${f}`).join("\n")
      );
      sections.push(
        `OPEN QUESTIONS:\n` +
          ctx.openQuestions.map((q: string) => `  - ${q}`).join("\n")
      );
      sections.push(
        `RECENT DECISIONS:\n` +
          ctx.decisions
            .map(
              (d: { date: string; decision: string; reasoning: string }) =>
                `  - [${d.date}] ${d.decision}: ${d.reasoning}`
            )
            .join("\n")
      );
      sections.push(
        `KNOWN LIMITATIONS (Phase 2):\n` +
          ctx.phase2Features.map((f: string) => `  - NOT in MVP: ${f}`).join("\n")
      );
      break;

    case "customer-success":
      sections.push(
        `PILOT RESTAURANTS:\n` +
          ctx.customers.pilot
            .map(
              (p: { name: string; type: string; seats: number | string; status: string; notes: string }) =>
                `  - ${p.name} (${p.type}, ${p.seats} seats) — ${p.status}. ${p.notes}`
            )
            .join("\n")
      );
      sections.push(
        `KEY METRICS: ${ctx.metrics.pilotRestaurants} pilots, Avg order ${ctx.metrics.avgOrderValue}, Latency target ${ctx.metrics.orderLatencyTarget}`
      );
      sections.push(
        `CUSTOMER PAIN POINTS:\n` +
          ctx.customers.topPainPoints.map((p: string) => `  - ${p}`).join("\n")
      );
      sections.push(
        `DESIRED OUTCOMES:\n` +
          ctx.customers.desiredOutcomes.map((o: string) => `  - ${o}`).join("\n")
      );
      sections.push(
        `RECENT PRODUCT UPDATES:\n` +
          ctx.recentUpdates
            .filter(
              (u: { category: string }) => u.category === "Product" || u.category === "Design"
            )
            .map(
              (u: { date: string; update: string }) =>
                `  - [${u.date}] ${u.update}`
            )
            .join("\n")
      );
      break;

    case "legal":
      sections.push(
        `COMPLIANCE:\n` +
          `  Certifications: ${ctx.compliance.certifications.join(", ")}\n` +
          `  Pending Audits: ${ctx.compliance.pendingAudits.join(", ")}\n` +
          `  Requirements:\n` +
          ctx.compliance.requirements.map((r: string) => `    - ${r}`).join("\n") +
          `\n  Implementation:\n` +
          ctx.compliance.implementation.map((i: string) => `    - ${i}`).join("\n")
      );
      sections.push(
        `PILOT RESTAURANTS (contract context):\n` +
          ctx.customers.pilot
            .map(
              (p: { name: string; seats: number | string; status: string }) =>
                `  - ${p.name} (${p.seats} seats) — ${p.status}`
            )
            .join("\n")
      );
      sections.push(
        `PAYMENT DATA: ${ctx.techStack.payments} — tokenized, never stores card numbers`
      );
      break;

    case "design":
      sections.push(
        `TEAM:\n` +
          ctx.team
            .filter(
              (t: { role: string }) =>
                t.role === "UX Designer" || t.role === "Frontend Developer" || t.role === "Product Manager"
            )
            .map(
              (t: { name: string; role: string; focus: string }) =>
                `  - ${t.name} (${t.role}) — ${t.focus}`
            )
            .join("\n")
      );
      sections.push(
        `RECENT DESIGN UPDATES:\n` +
          ctx.recentUpdates
            .filter((u: { category: string }) => u.category === "Design")
            .map(
              (u: { date: string; update: string }) =>
                `  - [${u.date}] ${u.update}`
            )
            .join("\n")
      );
      sections.push(
        `RESEARCH FINDINGS:\n` +
          ctx.research.keyFindings.map((f: string) => `  - ${f}`).join("\n")
      );
      sections.push(
        `CUSTOMER PAIN POINTS:\n` +
          ctx.customers.topPainPoints.map((p: string) => `  - ${p}`).join("\n")
      );
      sections.push(
        `DESIGN DECISIONS:\n` +
          ctx.decisions
            .filter((d: { decidedBy: string }) => d.decidedBy.includes("Marcus") || d.decidedBy.includes("UX"))
            .map(
              (d: { date: string; decision: string; reasoning: string }) =>
                `  - [${d.date}] ${d.decision}: ${d.reasoning}`
            )
            .join("\n")
      );
      break;

    default:
      sections.push(`FULL CONTEXT:\n${JSON.stringify(ctx, null, 2)}`);
  }

  return sections.join("\n\n");
}

// ─── Rich source labels with dates (per persona) ───

function getSourceLabels(persona: string): string[] {
  if (!companyContext) return ["Company Knowledge Base"];

  const ctx = companyContext;

  const sources: Record<string, string[]> = {
    developer: [
      `Project Status (updated ${ctx.project.lastUpdated})`,
      `Technical Decision Log (${ctx.decisions.length} decisions)`,
      `Sprint Board — Payment Integration: In Progress`,
    ],
    "product-manager": [
      `Product Roadmap (MVP Dec 1, 2026)`,
      `Decision Log (${ctx.decisions.length} decisions)`,
      `Customer Research (${ctx.customers.pilot.length} pilot restaurants)`,
    ],
    executive: [
      `Executive Dashboard (${ctx.metrics.pilotRestaurants} pilots)`,
      `Budget & Timeline ($${ctx.project.budget})`,
      `Competitive Analysis (${ctx.competitors.length} competitors tracked)`,
    ],
    sales: [
      `Pilot Accounts (${ctx.customers.pilot.length} restaurants)`,
      `Competitive Intel (${ctx.competitors.length} competitors)`,
      `MVP Feature List (${ctx.mvpFeatures.length} features)`,
    ],
    marketing: [
      `Market Analysis (${ctx.competitors.length} competitors)`,
      `Customer Research (${ctx.research.sources.length} venues)`,
      `Product Positioning (restaurant POS)`,
    ],
    "customer-support": [
      `Product Documentation (${ctx.mvpFeatures.length} MVP features)`,
      `Technical Specs (${Object.keys(ctx.techStack).length} components)`,
      `Decision Log (${ctx.decisions[ctx.decisions.length - 1]?.date})`,
    ],
    "customer-success": [
      `Pilot Restaurant Dashboard (${ctx.customers.pilot.length} venues)`,
      `Customer Research (${ctx.research.keyFindings.length} findings)`,
      `Product Roadmap (MVP vs Phase 2)`,
    ],
    "technical-services": [
      `Infrastructure Docs (AWS CloudFront)`,
      `Tech Stack Registry (${Object.keys(ctx.techStack).length} services)`,
      `Performance Targets (${ctx.metrics.orderLatencyTarget} latency)`,
    ],
    legal: [
      `Compliance Registry (${ctx.compliance.certifications.join(", ")})`,
      `Audit Schedule (${ctx.compliance.pendingAudits[0]})`,
      `Pilot Contracts (${ctx.customers.pilot.length} venues)`,
    ],
    design: [
      `Design System (${ctx.recentUpdates.find((u: { category: string }) => u.category === "Design")?.date})`,
      `User Research (${ctx.research.sources.length} venues, ${ctx.research.keyFindings.length} findings)`,
      `Design Decision Log (Marcus Williams)`,
    ],
  };

  return sources[persona] || ["Company Knowledge Base"];
}

// ─── Dynamic confidence scoring ───

function scoreConfidence(answer: string): number {
  if (!companyContext) return 0.5;

  let contextHits = 0;
  const ctx = companyContext;

  // Check for references to team members
  for (const member of ctx.team) {
    if (answer.includes(member.name)) contextHits++;
  }

  // Check for dates from decisions
  for (const d of ctx.decisions) {
    if (answer.includes(d.date) || answer.includes(d.decision.substring(0, 20)))
      contextHits++;
  }

  // Check for pilot restaurant names
  for (const p of ctx.customers.pilot) {
    if (answer.includes(p.name)) contextHits++;
  }

  // Check for specific metrics/numbers
  const metrics = [
    ctx.metrics.orderLatencyTarget,
    ctx.metrics.uptimeTarget,
    ctx.metrics.avgOrderValue,
    String(ctx.metrics.peakOrdersPerHour),
    ctx.project.budget,
  ];
  for (const m of metrics) {
    if (answer.includes(m)) contextHits++;
  }

  // Check for competitor names
  for (const comp of ctx.competitors) {
    if (answer.includes(comp.name)) contextHits++;
  }

  // Check for tech stack mentions
  for (const val of Object.values(ctx.techStack)) {
    if (answer.includes(val as string)) contextHits++;
  }

  if (contextHits >= 3) return 0.92;
  if (contextHits >= 1) return 0.75;
  return 0.55;
}

// ─── Conversation context builder ───

function buildConversationContext(history?: ConversationMessage[]): string {
  if (!history || history.length === 0) return "";

  // Take last 10 messages, truncate long ones
  const recent = history.slice(-10);
  const formatted = recent.map((msg) => {
    const content = msg.content.length > 500
      ? msg.content.slice(0, 500) + "..."
      : msg.content;
    return `[${msg.role === "user" ? "User" : "Assistant"}]: ${content}`;
  });

  return `\n\nCONVERSATION HISTORY (recent messages for context — you may reference earlier parts of the conversation):\n${formatted.join("\n")}`;
}

// ─── Prompts ───

function buildSystemPrompt(persona: string, question: string, conversationHistory?: ConversationMessage[], dbContextText?: string): string {
  const label = PERSONA_LABELS[persona] || persona;
  const context = buildContextForPersona(persona, question);
  const uploadedContext = buildUploadedContentContext(question);
  const updatesContext = buildUpdatesContext(question);
  const conversationContext = buildConversationContext(conversationHistory);
  const questionType = classifyQuestion(question);
  const depthGuidance = getResponseDepthGuidance(questionType);

  let prompt = `You are an expert assistant for Neumm at PlateOS. You answer questions for the **${label}** persona about the PlateOS POS System — a cloud-based restaurant point of sale system being built for the Australian market.

COMPANY CONTEXT:
${context}`;

  if (dbContextText) {
    prompt += `

LIVE DATA FROM CONNECTED TOOLS (GitHub, Jira, Confluence, Slack — this is the most current data):
${dbContextText}`;
  }

  if (updatesContext) {
    prompt += `
${updatesContext}`;
  }

  if (uploadedContext) {
    prompt += `
${uploadedContext}`;
  }

  if (conversationContext) {
    prompt += `
${conversationContext}`;
  }

  prompt += `

${depthGuidance}

RESPONSE FORMAT:
1. Start with a **bold summary sentence** — the single most important takeaway
2. Then provide **detailed content** using markdown:
   - Use \`**bold**\` for key terms, names, dates, and numbers
   - Use \`- \` bullet points for lists
   - Use numbered lists \`1. \` when listing features, requirements, or ordered items
   - Use \`### \` subheadings to organize long answers into sections
3. Reference **specific people by name**, **exact dates**, and **concrete numbers** from the context
4. End with a **bold next step or recommendation** if relevant
5. Use **bold** for key terms, names, and important data points

CRITICAL RULES:
- Use ONLY the provided context. Do NOT make up information.
- When the question asks for a LIST (features, requirements, risks, team members), you MUST list EVERY SINGLE item from the context. Never summarize with "and more" or "including several others" — be EXHAUSTIVE.
- Be specific and actionable, not generic. Include real names, dates, and numbers.
- If context is insufficient, state what you know and flag what's missing.
- Tailor language to the ${label} persona's needs and priorities.
- Always distinguish between MVP (Dec 2026) and Phase 2 (2027) scope.
- Reference the 3 Sydney pilot restaurants when discussing customer insights.
- Match your response length to the question complexity: simple questions get concise answers, complex questions get comprehensive answers.
- For "what are the requirements/features" type questions: list ALL items individually, grouped by category, with details for each.
- If RECENT UPDATES FROM INITIATIVE OWNERS are provided above, they are MORE CURRENT than the base context. When updates contradict the base context, trust the updates. Always cite who provided the update and when (e.g., "According to the update from **Sarah Martinez** on **Feb 20**...").

FOLLOW-UP SUGGESTIONS:
After your answer, on a new line, write exactly this format:
FOLLOWUPS: question one? | question two? | question three?
These should be 3 short, relevant follow-up questions the user might want to ask next, related to your answer and the ${label} persona's perspective. Keep each under 60 characters.`;

  if (conversationHistory && conversationHistory.length > 0) {
    prompt += `
- You have conversation history above. Reference earlier messages naturally when relevant (e.g., "As mentioned earlier..." or "Building on the previous point...").`;
  }

  if (uploadedContext) {
    prompt += `
- When referencing uploaded documents, **cite the filename** in your answer (e.g., "According to **meeting-notes.txt**...").
- Prioritize information from uploaded documents when it is directly relevant to the question.
- Clearly distinguish between company context data and uploaded document content.`;
  }

  return prompt;
}

function buildUserPrompt(persona: string, question: string): string {
  const label = PERSONA_LABELS[persona] || persona;
  const hasRelevantUploads = getRelevantUploads(question).length > 0;
  const questionType = classifyQuestion(question);

  let prompt = `Persona: ${label}
Question: ${question}

Answer using all available context about the PlateOS POS System.`;

  if (hasRelevantUploads) {
    prompt += ` When referencing uploaded documents, cite the filename in your answer.`;
  }

  prompt += ` Use markdown formatting with bold and bullet points. Reference specific people, dates, and decisions.`;

  // Add question-type-specific instructions
  if (questionType === "requirements") {
    prompt += ` This is a requirements/features question — you MUST list EVERY SINGLE feature and requirement from the context. Do NOT summarize or abbreviate. List all ${companyContext?.mvpFeatures?.length || 16} MVP features and all ${companyContext?.phase2Features?.length || 9} Phase 2 features individually. Group by category. Include performance targets and compliance requirements.`;
  } else if (questionType === "status") {
    prompt += ` Provide a comprehensive status update with dates, team members, and specific progress details.`;
  } else if (questionType === "team") {
    prompt += ` List every team member with their role, focus, recent work, and decisions.`;
  } else if (questionType === "risks") {
    prompt += ` List every identified risk with full mitigation details and owners.`;
  } else if (questionType === "tech") {
    prompt += ` Cover the complete technology stack with architecture details.`;
  }

  prompt += ` End with FOLLOWUPS: line.`;

  return prompt;
}

// ─── Parse follow-ups from AI response ───

function parseFollowups(text: string): { answer: string; followups: string[] } {
  const followupMatch = text.match(/\n?FOLLOWUPS:\s*(.+)$/i);
  if (followupMatch) {
    const answer = text.slice(0, followupMatch.index).trim();
    const followups = followupMatch[1]
      .split("|")
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, 3);
    return { answer, followups };
  }
  return { answer: text, followups: [] };
}

// ─── SSE helper ───

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ─── AI streaming: Claude (Anthropic) ───

async function streamClaude(
  persona: string,
  question: string,
  conversationHistory: ConversationMessage[] | undefined,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  dbContextText?: string
): Promise<{ fullText: string; provider: string }> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: buildSystemPrompt(persona, question, conversationHistory, dbContextText),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(persona, question),
      },
    ],
  });

  let fullText = "";

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const chunk = event.delta.text;
      fullText += chunk;
      // Don't stream the FOLLOWUPS line — we'll parse it at the end
      if (!fullText.includes("FOLLOWUPS:")) {
        await writer.write(encoder.encode(formatSSE({ type: "chunk", text: chunk })));
      }
    }
  }

  return { fullText, provider: "Claude Sonnet" };
}

// ─── AI streaming: GPT-4 (OpenAI) ───

async function streamGPT4(
  persona: string,
  question: string,
  conversationHistory: ConversationMessage[] | undefined,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  dbContextText?: string
): Promise<{ fullText: string; provider: string }> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 4096,
    stream: true,
    messages: [
      { role: "system", content: buildSystemPrompt(persona, question, conversationHistory, dbContextText) },
      { role: "user", content: buildUserPrompt(persona, question) },
    ],
  });

  let fullText = "";

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) {
      fullText += text;
      // Don't stream the FOLLOWUPS line
      if (!fullText.includes("FOLLOWUPS:")) {
        await writer.write(encoder.encode(formatSSE({ type: "chunk", text })));
      }
    }
  }

  return { fullText, provider: "GPT-4o" };
}

// ─── Fallback follow-ups per persona ───

function getFallbackFollowups(persona: string): string[] {
  const followups: Record<string, string[]> = {
    developer: ["What's blocking the payment integration?", "What are the performance benchmarks?", "Who owns the offline mode work?"],
    "product-manager": ["What's at risk for the Dec 1 launch?", "Which open questions need answers first?", "How are pilot restaurants responding?"],
    executive: ["What's the burn rate on the $320K budget?", "How do we compare to Lightspeed POS?", "What's the multi-venue timeline?"],
    sales: ["What are the strongest selling points?", "How do pilots describe their experience?", "What should we NOT promise prospects?"],
    marketing: ["What messaging resonates with owners?", "How does our speed compare to competitors?", "What pilot data can we share publicly?"],
    "customer-support": ["What are the most common user issues?", "How does offline mode work for staff?", "What's NOT available in the MVP?"],
    "customer-success": ["Which pilot needs the most attention?", "What are the top adoption blockers?", "When does multi-venue launch?"],
    "technical-services": ["What's the disaster recovery plan?", "How do we handle peak Friday loads?", "What monitoring is in place?"],
    legal: ["What's the PCI-DSS audit timeline?", "How is payment data encrypted?", "Are pilot agreements in place?"],
    design: ["What's the training time target?", "How did split payment UX test?", "What's the next design priority?"],
  };
  return followups[persona] || ["Tell me more about this topic", "What are the key risks?", "Who should I talk to about this?"];
}

// ─── Fallback mock answers with markdown formatting ───

const FALLBACK_ANSWERS: Record<string, string> = {
  developer:
    "**PlateOS POS is 70% complete** with active development across payments, KDS, and offline mode.\n\n### Current Development Status\n\n**Completed:**\n- Core order system (Oct 2026)\n- UX research & design (Sep 2026)\n- Table/floor plan management with drag-and-drop (Oct 28)\n- KDS v1 with real-time order routing (Nov 14, Priya Patel)\n- Stripe Terminal API card payment integration (Nov 15, James Chen)\n- Offline store-and-forward payment queue (Nov 3, James Chen)\n\n**In Progress:**\n- Payment integration — Apple Pay & Google Pay next\n- KDS & kitchen routing refinements\n- Offline mode & sync\n\n**Not Started:**\n- Real-time dashboard\n- QA, PCI-DSS & load testing\n\n### Tech Stack\n- **Frontend**: React Native for tablets + PWA\n- **Backend**: Node.js + PostgreSQL + Redis\n- **Payments**: Stripe Terminal API\n- **Hosting**: AWS CloudFront CDN\n- **Offline**: IndexedDB + service workers\n- **Real-time**: WebSockets for kitchen/bar updates\n\n### MVP Features (16 total)\n1. Order taking (dine-in and takeaway)\n2. Kitchen Display System (KDS)\n3. Bar order routing\n4. Card, Apple Pay, Google Pay, cash payments\n5. Split bill functionality\n6. Item modifiers and notes\n7. Real-time sales dashboard\n8. Staff performance tracking\n9. Table and floor plan management\n10. Menu management\n11. Staff roles and PIN login\n12. GST/tax reporting\n13. Offline payment queue\n14. Tips support\n15. Refunds (full and partial)\n16. Export reports to CSV and PDF\n\n### Performance Targets\n- Order latency: **under 300ms** (decided Nov 8 by James Chen & Sarah Martinez)\n- Uptime: **99.9%**\n- Payment success rate: **>99%**\n- Error rate: **<0.1%**\n- Peak capacity: **120 orders/hour**\n\n**Next step:** Complete Apple Pay/Google Pay integration and begin PCI-DSS load testing with **Lisa Thompson**.",

  "product-manager":
    "**PlateOS MVP launches December 1, 2026** — currently 70% complete with 16 features in scope and 6 open questions to resolve.\n\n### MVP Features (16 total)\n1. **Order taking** (dine-in and takeaway)\n2. **Kitchen Display System (KDS)** — shipped v1 Nov 14 by Priya Patel\n3. **Bar order routing**\n4. **Payments** — card, Apple Pay, Google Pay, cash (Stripe Terminal API)\n5. **Split bill functionality** — confirmed MVP-required Nov 12 based on pilot feedback\n6. **Item modifiers and notes**\n7. **Real-time sales dashboard** — requirements finalized Nov 18 by Sarah Martinez\n8. **Staff performance tracking**\n9. **Table and floor plan management** — shipped Oct 28 by Priya Patel\n10. **Menu management**\n11. **Staff roles and PIN login**\n12. **GST/tax reporting**\n13. **Offline payment queue** — implemented Nov 3 by James Chen\n14. **Tips support**\n15. **Refunds** (full and partial)\n16. **Export reports** to CSV and PDF\n\n### Phase 2 (Deferred to 2027)\n1. Online ordering integration\n2. Inventory and stock management\n3. Loyalty programs and CRM\n4. Multi-venue management\n5. Advanced analytics and AI insights\n6. Accounting integrations (Xero, MYOB)\n7. Delivery platform integrations (Uber Eats, DoorDash)\n8. Customer-facing display screens\n9. Reservation system integration\n\n### Open Questions\n- QR code ordering: MVP or Phase 2?\n- Payment gateway: Stripe or Square?\n- iPad Pro support or standard iPad?\n- Kitchen printers in MVP or KDS only?\n- Minimum internet speed required?\n- Android tablets or iOS only for MVP?\n\n### Key Decisions\n- **Oct 15**: Single-venue MVP, multi-venue deferred (Sarah Martinez)\n- **Oct 22**: Tablet-first UI design (Marcus Williams)\n- **Nov 3**: Offline store-and-forward (James Chen)\n- **Nov 8**: 300ms order latency target (Sarah + James)\n- **Nov 12**: Split payments in MVP (Sarah Martinez)\n- **Nov 18**: Real-time dashboard, not batch (Sarah Martinez)\n\n**Next step:** Resolve the 6 open questions — especially payment gateway (Stripe vs Square) and QR ordering scope.",

  executive:
    "**PlateOS is our sole product at 70% complete** — $320K budget, December 1, 2026 MVP launch targeting Australian restaurants.\n\n### Key Metrics\n- **Budget**: $320K\n- **Completion**: 70%\n- **MVP Launch**: December 1, 2026\n- **Pilot Restaurants**: 3 in Sydney\n- **Avg Order Value**: $42\n- **Peak Capacity Target**: 120 orders/hour\n- **Order Latency Target**: Under 300ms\n- **Uptime Target**: 99.9%\n\n### Pilot Restaurants\n- **The Urban Fork** (Inner-city casual dining, 80 seats, Sydney CBD) — Active Pilot, primary venue, high-volume dine-in\n- **Bean & Leaf Café** (Suburban café, 35 seats, Surry Hills) — Active Pilot, 60% takeaway, stress-tests order queue\n- **Sapore Group** (Small restaurant group, 2 venues, Newtown) — Waitlist for Phase 2, needs multi-venue\n\n### Competitive Landscape\n- **Lightspeed POS**: Established but slow UI, expensive\n- **Square POS**: Simple but lacks restaurant features, no KDS\n- **Toast POS**: Strong restaurant features but US-only\n\n### Risks\n1. Peak load during Friday/Saturday night → Redis caching for sub-300ms response\n2. Staff training friction → Design for <5 taps per order\n3. Hardware variability → Device-agnostic design tested on iPad 9th gen\n4. Internet outages → Offline mode with local queue\n5. Payment gateway downtime → Fallback to manual entry\n\n**Decision needed:** Approve payment gateway choice (Stripe vs Square) before the end of November.",

  sales:
    "**Position PlateOS as a fast, modern POS built specifically for Australian restaurants** — purpose-built alternative to imported systems.\n\n### MVP Features — Selling Points (16 total)\n1. **Order taking** — dine-in and takeaway\n2. **Kitchen Display System** — real-time order routing\n3. **Bar order routing** — separate drink orders\n4. **Multi-payment** — card, Apple Pay, Google Pay, cash\n5. **Split bill functionality** — top customer request\n6. **Item modifiers and notes** — custom orders\n7. **Real-time sales dashboard** — live revenue during service\n8. **Staff performance tracking**\n9. **Table and floor plan management**\n10. **Menu management**\n11. **Staff roles and PIN login**\n12. **GST/tax reporting** — ATO compliant\n13. **Offline payment queue** — works during internet outages\n14. **Tips support**\n15. **Refunds** — full and partial\n16. **Export reports** — CSV and PDF\n\n### Key Differentiators\n- **Speed**: Sub-300ms order submission vs competitors' slow UIs\n- **Offline mode**: Orders and payments continue during internet outages\n- **Simplicity**: 3-5 taps per order vs 8 taps on competitor systems\n- **Training**: Under 30 minutes for new staff (vs hours on Lightspeed)\n- **KDS**: Built-in kitchen display (Square doesn't have this)\n- **Australian-built**: GST native, local support, no US-centric features\n\n### Do NOT Promise (Phase 2 — 2027)\n1. Online ordering integration\n2. Inventory/stock management\n3. Loyalty programs/CRM\n4. Multi-venue management\n5. AI analytics\n6. Xero/MYOB accounting integration\n7. Uber Eats/DoorDash integration\n8. Customer-facing displays\n9. Reservation integration\n\n### Pilot Results\n- **The Urban Fork** (80 seats, Sydney CBD) — Active pilot, high-volume dine-in\n- **Bean & Leaf Café** (35 seats, Surry Hills) — Active pilot, 60% takeaway\n\n**Next step:** Use pilot restaurant results as proof points in demos. Focus on speed and split-bill ease.",

  marketing:
    "**Our value proposition: Lightning-fast restaurant POS** that eliminates rush-hour friction and split-bill headaches for Australian restaurants.\n\n### Key Messages\n- **Speed**: Sub-300ms orders vs 8 taps on competitors = 3-5 taps on PlateOS\n- **Split bills made easy**: Top pain point from all 3 pilot restaurants, scored 4.5/5 usability\n- **Works offline**: Internet drops 2-3 times/week in older buildings — we keep running\n- **Real-time insights**: Owners check sales 5+ times during service\n- **Easy to learn**: Under 30 minutes training vs hours on competitors\n\n### Customer Research Findings\n- Average order takes **8 taps** on competitor systems — our target is **3-5 taps**\n- Split bills account for **30% of transactions** at dinner service\n- Staff turnover averages **40% annually** — training must be under 30 minutes\n- Internet drops **2-3 times per week** in older buildings\n- Owners check sales **5+ times** during a service\n\n### Competitive Positioning\n- **vs Lightspeed**: Faster, simpler, cheaper. Lightspeed is complex and expensive\n- **vs Square**: We have KDS, split bills, restaurant-specific features Square lacks\n- **vs Toast**: We're in Australia. Toast is US-only with expensive hardware lock-in\n\n### Pilot Pain Points (messaging fuel)\n1. Slow order entry during rush (all 3 pilots)\n2. Poor kitchen communication (2 pilots)\n3. Split bill friction (all 3 pilots)\n4. Retrospective reporting only (2 pilots)\n5. High staff turnover = constant training (all 3 pilots)\n\n**Next step:** Prepare launch messaging around speed and simplicity for December 1 MVP launch.",

  "customer-support":
    "**PlateOS MVP includes 16 features** using React Native tablets with Stripe Terminal payments and WebSocket kitchen updates.\n\n### MVP Features (what customers get)\n1. Order taking (dine-in and takeaway)\n2. Kitchen Display System (KDS) — real-time routing\n3. Bar order routing\n4. Card, Apple Pay, Google Pay, cash payments\n5. Split bill functionality\n6. Item modifiers and notes\n7. Real-time sales dashboard\n8. Staff performance tracking\n9. Table and floor plan management\n10. Menu management\n11. Staff roles and PIN login\n12. GST/tax reporting\n13. Offline payment queue\n14. Tips support\n15. Refunds (full and partial)\n16. Export reports (CSV and PDF)\n\n### NOT in MVP (Phase 2 — 2027)\n1. Online ordering integration\n2. Inventory/stock management\n3. Loyalty programs/CRM\n4. Multi-venue management\n5. AI analytics\n6. Xero/MYOB integration\n7. Uber Eats/DoorDash integration\n8. Customer-facing displays\n9. Reservation integration\n\n### Key Technical Details for Support\n- **Offline mode**: Orders and payments queue locally during internet outages, sync when connection returns\n- **Staff login**: PIN codes with role-based permissions\n- **Split payments**: Confirmed MVP Nov 12 — top pilot complaint\n- **Order latency target**: Under 300ms\n\n### Open Questions (unresolved)\n- QR code ordering — MVP or Phase 2?\n- Android tablet support or iOS only?\n- Kitchen printers or KDS only?\n\n**Prepare for:** Questions about Android support, QR ordering, and inventory management — all deferred to Phase 2.",

  "customer-success":
    "**Three pilot restaurants are actively testing PlateOS** in Sydney, each representing a different restaurant type.\n\n### Pilot Restaurant Details\n\n**1. The Urban Fork**\n- Type: Inner-city casual dining\n- Location: Sydney CBD\n- Seats: 80\n- Status: **Active Pilot** (primary venue)\n- Focus: High-volume dine-in testing\n\n**2. Bean & Leaf Café**\n- Type: Suburban café with heavy takeaway\n- Location: Surry Hills, Sydney\n- Seats: 35\n- Status: **Active Pilot**\n- Focus: 60% takeaway volume, stress-tests order queue\n\n**3. Sapore Group**\n- Type: Small restaurant group\n- Location: Newtown, Sydney\n- Seats: 2 venues (45 + 60 seats)\n- Status: **Waitlist for Phase 2**\n- Focus: Needs multi-venue management, using single-venue MVP for now\n\n### Top Pain Points (from all pilots)\n1. **Slow order entry** during rush periods (all 3)\n2. **Poor kitchen communication** and missed modifications (2 of 3)\n3. **Split bill friction** at payment time (all 3)\n4. **Retrospective reporting** only, not real-time (2 of 3)\n5. **High staff turnover** = constant training burden (all 3)\n\n### Desired Outcomes\n- Faster service during peak times\n- Fewer order errors and kitchen confusion\n- Painless split payments\n- Real-time sales performance visibility\n- Easy training for new staff\n\n### Research Findings\n- 8 taps average on competitors → our target is 3-5\n- Split bills = 30% of dinner transactions\n- Staff turnover 40% annually → training under 30 minutes\n- Internet drops 2-3 times/week\n- Owners check sales 5+ times during service\n\n**Action needed:** Schedule check-in with Sapore Group to manage multi-venue timeline expectations (2027).",

  "technical-services":
    "**PlateOS runs on React Native (tablets) + Node.js/PostgreSQL/Redis backend** hosted on AWS CloudFront.\n\n### Complete Tech Stack\n- **Frontend**: React Native for tablets + Progressive Web App\n- **Backend**: Node.js + PostgreSQL + Redis (caching)\n- **Payments**: Stripe Terminal API (card, Apple Pay, Google Pay)\n- **Hosting**: AWS CloudFront CDN for low latency\n- **Offline**: IndexedDB + service workers\n- **Real-time**: WebSockets for kitchen/bar order updates\n\n### Performance Targets\n- Order latency: **under 300ms**\n- Uptime: **99.9% SLA**\n- Payment success rate: **>99%**\n- Error rate: **<0.1%**\n- Peak capacity: **120 orders/hour**\n\n### Architecture Decisions\n- **Nov 3**: Offline store-and-forward — orders queue locally, sync on reconnect (James Chen)\n- **Nov 8**: 300ms latency target based on research (James Chen + Sarah Martinez)\n- **Oct 22**: Tablet-first UI — large touch targets for rush service (Marcus Williams)\n- **Nov 18**: Real-time dashboard over batch reporting (Sarah Martinez)\n\n### Compliance & Security\n- **PCI-DSS Level 1** audit scheduled November 2026 (Lisa Thompson)\n- Tokenized payment data — never store card numbers\n- TLS 1.3 for all API calls\n- Encrypted local storage for offline queue\n- Regular penetration testing\n- AWS compliance certifications\n\n### Risks & Mitigations\n1. **Peak load** (Fri/Sat night) → Redis caching, sub-300ms targets (James Chen)\n2. **Hardware variability** → Device-agnostic, tested on iPad 9th gen minimum (Priya Patel)\n3. **Internet outages** → Offline mode with local queue (James Chen)\n4. **Payment gateway downtime** → Fallback to manual entry, retry queue (Lisa Thompson)\n\n**Next step:** Configure AWS CloudFront CDN and schedule load testing for peak scenarios with **Lisa Thompson**.",

  legal:
    "**PlateOS requires PCI-DSS Level 1 compliance** for payment card processing, plus Australian Privacy Act and GST reporting compliance.\n\n### Compliance Requirements\n1. **PCI-DSS Level 1** — payment card data processing\n2. **Data encryption** at rest and in transit\n3. **Australian Privacy Act** compliance for customer data\n4. **GST reporting** requirements (ATO)\n5. **99.9% uptime SLA** target\n\n### Security Implementation\n1. **Tokenized payment data** — never store card numbers\n2. **TLS 1.3** for all API calls\n3. **Encrypted local storage** for offline queue\n4. **Regular penetration testing**\n5. **AWS compliance certifications**\n\n### Certifications Status\n- PCI-DSS Level 1: **In progress** — audit scheduled November 2026\n- Australian Privacy Act: **Compliant**\n- GST reporting: **Compliant**\n\n### Key Activities\n- **Lisa Thompson** (QA Lead) began PCI-DSS compliance testing on **Nov 5**\n- Tokenization verified, penetration test scheduled\n- Offline payment queue uses encrypted local storage\n\n### Pilot Restaurant Contracts\n- **The Urban Fork** (80 seats) — Active Pilot\n- **Bean & Leaf Café** (35 seats) — Active Pilot\n- **Sapore Group** (2 venues, 105 seats total) — Waitlist for Phase 2\n\n### Payment Processing\n- **Stripe Terminal API** — tokenized, never stores card numbers\n- Supports card, Apple Pay, Google Pay, cash\n- Offline store-and-forward for payment queuing during outages\n\n**Action needed:** Review pilot restaurant agreements and ensure data processing terms cover offline payment queuing.",

  design:
    "**Marcus Williams leads tablet-first design** with large touch targets, targeting under 30 minutes training for new staff.\n\n### Design Team\n- **Marcus Williams** (UX Designer) — Fast order entry, split payments, staff training UX\n- **Priya Patel** (Frontend Developer) — Tablet UI, KDS, order flow\n- **Sarah Martinez** (Product Manager) — MVP scope, customer research, feature prioritization\n\n### Key Design Decisions\n- **Oct 22**: **Tablet-first UI** — restaurant staff need large touch targets during peak service, not phone-sized buttons (Marcus Williams)\n- **Nov 10**: **Split payment UX** tested with 3 pilot restaurant staff — scored **4.5/5 usability** (Marcus Williams)\n\n### Research Findings\n- Competitor systems take **8 taps** per order — our target is **3-5 taps**\n- Split bills account for **30% of transactions** at dinner\n- Staff turnover **40% annually** — training must be **under 30 minutes**\n- Internet drops **2-3 times/week** in older buildings\n- Owners check sales **5+ times** during service — real-time dashboard matters\n\n### Customer Pain Points (driving design)\n1. Slow order entry during rush (all 3 pilots)\n2. Poor kitchen communication (2 pilots)\n3. Split bill friction (all 3 pilots)\n4. Retrospective-only reporting (2 pilots)\n5. High staff turnover = training burden (all 3 pilots)\n\n### Recent Design Updates\n- **Oct 22**: Tablet-first design rationale presented — large touch targets, visibility during rush\n- **Nov 10**: Split payment UX completed and tested with pilots — 4.5/5 score\n\n**Next step:** Design the **real-time dashboard** UI for restaurant owners — they check sales 5+ times during service.",
};

// ─── Route handler ───

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AnswerRequest;

    if (!body.question || typeof body.question !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'question' field" },
        { status: 400 }
      );
    }

    if (!body.persona || typeof body.persona !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'persona' field" },
        { status: 400 }
      );
    }

    const { question, persona, conversationHistory } = body;

    const useGPT4 = GPT4_PERSONAS.has(persona);

    const keyToCheck = useGPT4 ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
    const hasKey = !!keyToCheck && keyToCheck !== "your-key-here";

    const uploadedFileSources = getUploadedSourceLabels(question);
    const hasUploadedContext = uploadedFileSources.length > 0;
    const updateSourceLabels = getUpdateSourceLabels(question);
    const hasUpdateContext = updateSourceLabels.length > 0;

    // Gather live data from connected tools (GitHub, Jira, Confluence, Slack)
    let dbContextText: string | undefined;
    let dbSourceLabels: string[] = [];
    try {
      const dbCtx = buildDBContext(question);
      if (dbCtx.hasData) {
        dbContextText = dbCtx.contextText;
        dbSourceLabels = dbCtx.sourceLabels;
      }
    } catch {
      // DB context is optional — don't fail the request
    }

    // ─── Fallback path (no key or fallback mode) → stream as single chunk ───
    if (!hasKey) {
      console.warn(
        `[/api/answer] No API key for ${useGPT4 ? "OpenAI" : "Anthropic"}, using fallback`
      );
      const answerText =
        FALLBACK_ANSWERS[persona] ||
        `Placeholder response for ${PERSONA_LABELS[persona] || persona}. Configure API keys in .env.local for real AI.`;
      let sources: string[] = ["Mock Data (API key not configured)"];
      if (dbSourceLabels.length > 0) {
        sources = [...dbSourceLabels, ...sources];
      }
      if (hasUpdateContext) {
        sources = [...updateSourceLabels, ...sources];
      }
      if (hasUploadedContext) {
        sources = [...sources, ...uploadedFileSources];
      }
      const followups = getFallbackFollowups(persona);

      return createFallbackStream(answerText, 0.6, sources, followups);
    }

    // ─── Streaming AI path ───
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Run streaming in background
    (async () => {
      try {
        let result: { fullText: string; provider: string };

        if (useGPT4) {
          result = await streamGPT4(persona, question, conversationHistory, writer, encoder, dbContextText);
        } else {
          result = await streamClaude(persona, question, conversationHistory, writer, encoder, dbContextText);
        }

        const { fullText } = result;

        // Parse follow-ups from AI response
        const { answer: cleanAnswer, followups: aiFollowups } = parseFollowups(fullText);

        // If we held back part of the text (before FOLLOWUPS:), we need to check
        // if we streamed too much. The streamed text should only be the answer part.
        // Since we stopped streaming at "FOLLOWUPS:", the client has the answer text.
        // But we may have streamed some chars of "FOLLOWUPS" before detecting it.
        // We'll send a "replace" if needed — but actually we prevented streaming once
        // fullText includes "FOLLOWUPS:", so the client should have clean text.

        let sources = getSourceLabels(persona);
        if (dbSourceLabels.length > 0) {
          sources = [...dbSourceLabels, ...sources];
        }
        if (hasUpdateContext) {
          sources = [...updateSourceLabels, ...sources];
        }
        if (hasUploadedContext) {
          sources = [...uploadedFileSources, ...sources];
        }

        let confidence = scoreConfidence(cleanAnswer);
        if (dbSourceLabels.length > 0) {
          confidence = Math.min(0.97, confidence + 0.08);
        }
        if (hasUploadedContext) {
          confidence = Math.min(0.97, confidence + 0.05);
        }
        if (hasUpdateContext) {
          confidence = Math.min(0.97, confidence + 0.03);
        }

        const followups = aiFollowups.length > 0 ? aiFollowups : getFallbackFollowups(persona);

        await writer.write(encoder.encode(formatSSE({
          type: "done",
          confidence,
          sources,
          followups,
        })));
      } catch (aiError) {
        const errMsg = aiError instanceof Error ? aiError.message : String(aiError);
        const errMsgLower = errMsg.toLowerCase();

        const statusCode =
          (aiError as { status?: number })?.status ??
          (aiError as { statusCode?: number })?.statusCode;

        const isAuthError =
          statusCode === 401 ||
          statusCode === 403 ||
          errMsgLower.includes("invalid api key") ||
          errMsgLower.includes("invalid x-api-key") ||
          errMsgLower.includes("incorrect api key") ||
          errMsgLower.includes("authentication_error") ||
          errMsgLower.includes("permission denied");

        if (isAuthError) {
          console.error(`[/api/answer] Invalid API key:`, errMsg);
          await writer.write(encoder.encode(formatSSE({
            type: "error",
            error: "API key is invalid or expired. Please check your configuration.",
            errorCode: "INVALID_KEY",
          })));
          await writer.close();
          return;
        }

        const isTimeout =
          statusCode === 408 ||
          statusCode === 504 ||
          errMsgLower.includes("timeout") ||
          errMsgLower.includes("etimedout") ||
          errMsgLower.includes("econnaborted") ||
          (aiError instanceof Error && aiError.name === "AbortError");

        if (isTimeout) {
          console.error(`[/api/answer] AI call timed out:`, errMsg);
          await writer.write(encoder.encode(formatSSE({
            type: "error",
            error: "The AI took too long to respond. Try a simpler question.",
            errorCode: "TIMEOUT",
          })));
          await writer.close();
          return;
        }

        // Rate limit / billing → fall back to cached answers
        if (statusCode === 429 || errMsgLower.includes("rate limit") || errMsgLower.includes("rate_limit")) {
          console.warn(`[/api/answer] Rate limited, falling back:`, errMsg);
        } else if (errMsgLower.includes("credit balance") || errMsgLower.includes("billing") || errMsgLower.includes("insufficient_quota")) {
          console.warn(`[/api/answer] AI billing/credits issue, falling back:`, errMsg);
        } else {
          console.error(`[/api/answer] AI call failed (status=${statusCode}):`, errMsg);
        }

        // Send fallback as stream
        const fallbackText =
          FALLBACK_ANSWERS[persona] ||
          "Sorry, the AI service is temporarily unavailable. Please try again.";
        let sources: string[] = ["Fallback Data (AI temporarily unavailable)"];
        if (dbSourceLabels.length > 0) {
          sources = [...dbSourceLabels, ...sources];
        }
        if (hasUpdateContext) {
          sources = [...updateSourceLabels, ...sources];
        }
        if (hasUploadedContext) {
          sources = [...sources, ...uploadedFileSources];
        }

        // Stream fallback text in chunks to simulate streaming
        const words = fallbackText.split(" ");
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? "" : " ") + words[i];
          await writer.write(encoder.encode(formatSSE({ type: "chunk", text: chunk })));
        }

        await writer.write(encoder.encode(formatSSE({
          type: "done",
          confidence: 0.6,
          sources,
          followups: getFallbackFollowups(persona),
        })));
      } finally {
        try { await writer.close(); } catch { /* already closed */ }
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[/api/answer] Unhandled error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── Helper: create a streaming response from fallback text ───

function createFallbackStream(
  answerText: string,
  confidence: number,
  sources: string[],
  followups: string[]
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      // Stream fallback text word by word with small delays for effect
      const words = answerText.split(" ");
      for (let i = 0; i < words.length; i++) {
        const chunk = (i === 0 ? "" : " ") + words[i];
        await writer.write(encoder.encode(formatSSE({ type: "chunk", text: chunk })));
      }

      await writer.write(encoder.encode(formatSSE({
        type: "done",
        confidence,
        sources,
        followups,
      })));
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
