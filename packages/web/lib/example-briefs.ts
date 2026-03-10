// ─── Example Briefs Library ────────────────────────────────────────────────
// 24 cage-match prompts pushing AI agents to their absolute limits.
// Six categories × four briefs each.

export interface ExampleBrief {
  id: string;
  title: string;
  emoji: string;
  category: 'Code Battle' | 'Business War' | 'Creative Clash' | 'Strategy Duel' | 'Data Gladiator' | 'Life Optimizer';
  difficulty: 'BRUTAL' | 'EXTREME' | 'SAVAGE';
  format: 'SPRINT' | 'HACKATHON' | 'RELAY_RACE' | 'RED_VS_BLUE';
  timeLimitMins: number;
  problem: string;
  constraints: string;    // newline-separated
  deliverables: string;   // newline-separated
  expectedOutput?: string;
  criteria: Array<{
    id: string;
    description: string;
    maxScore: number;
    weight: number;
  }>;
}

export const EXAMPLE_BRIEFS: ExampleBrief[] = [

  // ─── CODE BATTLE ──────────────────────────────────────────────────────────

  {
    id: 'concurrent-crawler',
    title: 'Concurrent Web Crawler',
    emoji: '🕷️',
    category: 'Code Battle',
    difficulty: 'BRUTAL',
    format: 'HACKATHON',
    timeLimitMins: 45,
    problem: `Build a concurrent web crawler in Python that:
1. Accepts a seed URL and max depth as command-line arguments
2. Uses asyncio + aiohttp for concurrent fetching
3. Respects robots.txt before visiting any page
4. Deduplicates URLs (don't visit the same URL twice)
5. Outputs a JSON sitemap to stdout with each page's: title, status code, list of links found, and crawl time in ms

Handle redirects, timeouts (5s per request), and encoding errors gracefully. The crawler must process at least 20 URLs in under 30 seconds when run against a live site.`,
    constraints: `Use asyncio + aiohttp only (no Scrapy, Playwright, etc.)
Respect robots.txt — skip disallowed paths
Deduplicate by normalized URL
Output valid JSON to stdout, logs to stderr
Handle connection errors, timeouts, and encoding issues without crashing`,
    deliverables: `crawler.py
README.md`,
    criteria: [
      { id: 'correctness', description: 'Crawler fetches pages, deduplicates, and outputs valid JSON sitemap', maxScore: 10, weight: 0.4 },
      { id: 'performance', description: 'Concurrent design — processes 20+ URLs in under 30 seconds', maxScore: 10, weight: 0.3 },
      { id: 'error-handling', description: 'Gracefully handles timeouts, redirects, encoding errors, robots.txt', maxScore: 10, weight: 0.2 },
      { id: 'code-quality', description: 'Clean async Python, typed, documented', maxScore: 10, weight: 0.1 },
    ],
  },

  {
    id: 'json-parser',
    title: 'Memory-Safe JSON Parser',
    emoji: '🔬',
    category: 'Code Battle',
    difficulty: 'SAVAGE',
    format: 'HACKATHON',
    timeLimitMins: 60,
    problem: `Write a JSON parser from scratch in Python — the \`json\` module is banned.

Your parser must:
1. Correctly parse all JSON types: null, bool, number (int + float + scientific notation), string (with all escape sequences), arrays, and objects
2. Handle nested structures up to 100 levels deep without recursion limit errors
3. Give useful error messages including line number and column on invalid input
4. Process a 1 MB JSON file in under 2 seconds
5. Include a test suite with at least 20 edge cases (empty object, deeply nested, unicode escapes, number edge cases, etc.)`,
    constraints: `No \`json\` module or any JSON library
Must handle all RFC 8259 JSON correctly
Error messages must include line and column number
Test suite must be self-contained in tests.py and runnable with: python tests.py`,
    deliverables: `json_parser.py
tests.py`,
    criteria: [
      { id: 'correctness', description: 'Parses all valid JSON types per RFC 8259', maxScore: 10, weight: 0.5 },
      { id: 'edge-cases', description: 'Test suite covers 20+ edge cases including error paths', maxScore: 10, weight: 0.3 },
      { id: 'performance', description: '1 MB file parsed in under 2 seconds', maxScore: 10, weight: 0.2 },
    ],
  },

  {
    id: 'redis-clone',
    title: 'Redis Clone',
    emoji: '⚡',
    category: 'Code Battle',
    difficulty: 'SAVAGE',
    format: 'HACKATHON',
    timeLimitMins: 90,
    problem: `Implement a minimal Redis-compatible TCP server in Python that:
1. Listens on port 6379
2. Speaks the RESP (Redis Serialization Protocol) wire format
3. Supports: GET, SET, DEL, EXPIRE, TTL, LPUSH, LPOP, LRANGE
4. Includes persistence via a simple append-only log (AOF) written to redis-clone.aof
5. Recovers state from the AOF file on startup

Include a client_test.py that connects via socket (not the redis-py client), sends RESP-encoded commands, and verifies all 8 commands work correctly including TTL expiry.`,
    constraints: `No redis-py or any Redis client library in the server
Must speak real RESP protocol (testable with redis-cli)
AOF must be written on every mutating command
Tests must use raw socket connections`,
    deliverables: `redis_clone.py
client_test.py`,
    criteria: [
      { id: 'protocol-compliance', description: 'All 8 commands work correctly with real RESP encoding', maxScore: 10, weight: 0.4 },
      { id: 'persistence', description: 'AOF written on mutations; state restored on restart', maxScore: 10, weight: 0.3 },
      { id: 'code-quality', description: 'Clean, structured server code with proper error handling', maxScore: 10, weight: 0.3 },
    ],
  },

  {
    id: 'deadlock-detector',
    title: 'Deadlock Detector',
    emoji: '🔒',
    category: 'Code Battle',
    difficulty: 'EXTREME',
    format: 'SPRINT',
    timeLimitMins: 20,
    problem: `Given a list of process lock/unlock events on stdin (one per line), detect if a deadlock exists.

Input format:
  LOCK P1 R2      (process P1 acquires resource R2)
  UNLOCK P1 R2    (process P1 releases resource R2)

Output either:
  NO DEADLOCK
or:
  DEADLOCK: P1->R2->P3->R1->P1    (the cycle, showing the chain of process→resource→process)

Handle up to 100 processes and 50 resources. The solution must run in O(V+E) time using a proper cycle-detection algorithm on the resource allocation graph.`,
    constraints: `Read from stdin, write to stdout
Must correctly model: process waits for resource, resource held by process
Cycle detection must use DFS or similar — not brute force
Handle UNLOCK before LOCK (malformed input) gracefully`,
    deliverables: `deadlock_detector.py`,
    criteria: [
      { id: 'correctness', description: 'Correctly detects deadlocks and outputs cycle or NO DEADLOCK', maxScore: 10, weight: 0.7 },
      { id: 'algorithm-clarity', description: 'Proper resource allocation graph with DFS cycle detection', maxScore: 10, weight: 0.3 },
    ],
  },

  // ─── BUSINESS WAR ─────────────────────────────────────────────────────────

  {
    id: 'startup-autopsy',
    title: 'Startup Autopsy',
    emoji: '💀',
    category: 'Business War',
    difficulty: 'EXTREME',
    format: 'HACKATHON',
    timeLimitMins: 45,
    problem: `You've been brought in to write a post-mortem for a failed B2B SaaS startup. Use only the data below.

DATA:
- Product: Restaurant inventory management SaaS
- Total raised: $2.1M ($800k seed, $1.3M Series A at month 4)
- Monthly revenue: $0, $0, $2k, $5k, $8k, $12k, $15k, $12k, $8k, $3k, $0
- Monthly burn: $50k, $80k, $80k, $100k, $120k, $150k, $180k, $200k, $180k, $150k, $100k
- Team: 3 founders + 8 employees at peak headcount
- Churn rate: 8% month-over-month beginning month 6
- CAC: $2,400 per customer
- LTV at observed churn rate: $1,800

Produce a comprehensive autopsy: identify the 3 fatal mistakes, reconstruct the timeline of failure with specific months, calculate burn rate and runway at each funding stage, and propose the 3 specific pivots that could have saved it. Show your financial reasoning.`,
    constraints: `Work only from the data provided — do not invent additional facts
Show all financial calculations explicitly
Timeline must reference specific month numbers
Recommendations must be financially grounded, not generic advice`,
    deliverables: `autopsy.md`,
    criteria: [
      { id: 'financial-accuracy', description: 'Burn rate, runway, LTV/CAC calculations are correct', maxScore: 10, weight: 0.35 },
      { id: 'insight-depth', description: 'Fatal mistakes are specific, non-obvious, and supported by data', maxScore: 10, weight: 0.35 },
      { id: 'actionability', description: 'Proposed pivots are concrete, feasible, and financially justified', maxScore: 10, weight: 0.3 },
    ],
  },

  {
    id: 'competitor-intelligence',
    title: 'Competitor Intelligence Report',
    emoji: '🕵️',
    category: 'Business War',
    difficulty: 'BRUTAL',
    format: 'SPRINT',
    timeLimitMins: 15,
    problem: `You are a strategy consultant. Using ONLY the information below, produce a competitive intelligence report for Company A.

COMPANY A: B2B project management SaaS. $49/seat/month. 12,000 customers. 180 employees. $28M ARR. 40% YoY growth, slowing. Core features: Gantt charts, resource planning, time tracking.

COMPETITOR B: $15/seat/month. 80,000 customers. VC-backed ($120M raised). AI-powered features. Fast-growing. Weak enterprise capabilities.

COMPETITOR C: Enterprise-only. $120/seat/month. 3,000 customers. Deep ERP integrations. Slow to ship new features.

Deliver: (1) SWOT analysis with 3 items per quadrant, (2) competitive positioning map on two axes — price (low→high) vs. capability depth (shallow→deep) — described in text, (3) 3 strategic recommendations with 90-day action items for each.`,
    constraints: `Use only the data provided — no external market data or assumptions beyond what's given
Each SWOT item must be supported by specific data points from the brief
Recommendations must be mutually consistent and sequenced`,
    deliverables: `strategy.md`,
    criteria: [
      { id: 'analytical-rigor', description: 'SWOT items are data-driven and non-generic; positioning map is logical', maxScore: 10, weight: 0.4 },
      { id: 'strategic-clarity', description: 'Recommendations are specific, actionable, and internally consistent', maxScore: 10, weight: 0.4 },
      { id: 'presentation', description: 'Clear structure, professional tone, skimmable', maxScore: 10, weight: 0.2 },
    ],
  },

  {
    id: 'pricing-architecture',
    title: 'Pricing Architecture',
    emoji: '💰',
    category: 'Business War',
    difficulty: 'SAVAGE',
    format: 'HACKATHON',
    timeLimitMins: 30,
    problem: `Design a complete go-to-market pricing strategy for a new AI coding assistant entering a market with GitHub Copilot ($10/mo) and Cursor ($20/mo).

Required deliverables:
1. Three-tier pricing structure with complete feature matrix (what's in each tier and why)
2. Psychological pricing tactics used — name each one and explain why you chose it
3. Revenue model projecting $10M ARR — state your TAM assumption, conversion funnel rates, and churn assumption explicitly
4. Freemium vs. free trial decision with data-driven rationale (cite actual conversion rate benchmarks)
5. Enterprise pricing structure with deal size tiers and negotiation floors

Your revenue-model.py must print year 1, 2, and 3 projections when run.`,
    constraints: `Revenue projections must be internally consistent — no magic numbers
Freemium/trial decision must reference real-world SaaS conversion benchmarks (state your sources even if approximate)
Feature matrix must explain WHY each feature is in each tier (psychology, not just list)
Enterprise tiers must have realistic deal sizes`,
    deliverables: `pricing-strategy.md
revenue-model.py`,
    criteria: [
      { id: 'financial-modeling', description: 'Revenue model is internally consistent; reaches $10M ARR with stated assumptions', maxScore: 10, weight: 0.3 },
      { id: 'strategic-thinking', description: 'Pricing tiers and tactics reflect real SaaS psychology and competitive dynamics', maxScore: 10, weight: 0.3 },
      { id: 'completeness', description: 'All 5 required sections present with sufficient depth', maxScore: 10, weight: 0.2 },
      { id: 'presentation', description: 'Clear, executive-ready formatting', maxScore: 10, weight: 0.2 },
    ],
  },

  {
    id: 'crisis-comms',
    title: 'Crisis Comms',
    emoji: '🚨',
    category: 'Business War',
    difficulty: 'EXTREME',
    format: 'SPRINT',
    timeLimitMins: 15,
    problem: `It's 6:47am. Your security team just confirmed a data breach: 2.3 million customer records exposed, including partial credit card numbers (last 4 digits + expiry). The breach occurred 11 days ago. A journalist from TechCrunch has your security team's internal Slack message and is publishing in 90 minutes.

Write all 5 of the following, consistent with each other:
1. Customer notification email (subject line + body)
2. Press statement (formal, for publication)
3. Internal all-hands message (honest, for employees)
4. Twitter/X thread (5 tweets, public-facing)
5. Response to the journalist's 3 questions: "When did you know?", "Why did it take 11 days?", "What are you doing for affected customers?"

All 5 must be legally defensible, factually consistent, and not make things worse.`,
    constraints: `All 5 documents must be factually consistent with each other
Do not admit legal liability, but do not be evasive
Tone must match the audience for each document
Do not offer specific dollar amounts for remediation unless you commit to them across all documents`,
    deliverables: `crisis-comms.md`,
    criteria: [
      { id: 'legal-soundness', description: 'No admissions of liability; factually accurate; GDPR/CCPA notification language present', maxScore: 10, weight: 0.3 },
      { id: 'consistency', description: 'All 5 documents tell the same story with no contradictions', maxScore: 10, weight: 0.3 },
      { id: 'tone', description: 'Each document appropriately calibrated for its audience', maxScore: 10, weight: 0.2 },
      { id: 'completeness', description: 'All 5 documents present and complete', maxScore: 10, weight: 0.2 },
    ],
  },

  // ─── CREATIVE CLASH ───────────────────────────────────────────────────────

  {
    id: 'unreliable-narrator',
    title: 'Unreliable Narrator',
    emoji: '🎭',
    category: 'Creative Clash',
    difficulty: 'BRUTAL',
    format: 'SPRINT',
    timeLimitMins: 20,
    problem: `Write a 600–800 word short story with an unreliable narrator — a character who is clearly deceiving themselves (not the reader) about what's happening. The reader must be able to piece together the truth from contradictions, omissions, and gaps in the narrator's account.

Requirements:
- The narrator must not know they're lying
- The reader must be able to reconstruct the actual events from what's left unsaid or contradicted
- The story must contain a twist that recontextualizes the opening paragraph when you read it again
- Genre: your choice, but the choice must serve the technique
- Word count: 600–800 words (strictly enforced)`,
    constraints: `600–800 words strictly — no padding, no cutting corners
The unreliable-narrator technique must be intrinsic to the story, not a gimmick
The twist must be planted in the opening paragraph — not inserted at the end
No supernatural explanations for the unreliability`,
    deliverables: `story.md`,
    criteria: [
      { id: 'narrative-craft', description: 'Prose quality, pacing, voice — is it actually good writing?', maxScore: 10, weight: 0.4 },
      { id: 'unreliable-narrator-technique', description: 'Contradictions are planted early and the truth is reconstructable', maxScore: 10, weight: 0.35 },
      { id: 'twist-effectiveness', description: 'The twist recontextualizes the opening — not telegraphed, not arbitrary', maxScore: 10, weight: 0.25 },
    ],
  },

  {
    id: 'brand-voice',
    title: 'Brand Voice from Scratch',
    emoji: '✨',
    category: 'Creative Clash',
    difficulty: 'EXTREME',
    format: 'HACKATHON',
    timeLimitMins: 30,
    problem: `Create a complete brand identity for a new luxury sustainable fashion startup targeting Gen Z consumers with disposable income.

Must include:
1. Brand name + naming rationale (why this name, what does it signal?)
2. Brand voice guide: personality in 5 adjectives, DOs and DON'Ts (5 each), and 5 example social posts that embody the voice
3. Visual identity brief: color palette with hex codes and psychological rationale, typography direction (2 typefaces + why), mood board description in 150 words
4. Positioning statement (the classic "For [audience] who [need], [Brand] is the [category] that [differentiator]. Unlike [competitor], [Brand] [proof point]." format — but make it not sound like a template)
5. The brand's "enemy" — what worldview, behavior, or aesthetic does this brand stand against? This should be visceral and specific.

The brand must feel genuinely novel — not a derivative of Patagonia, Stella McCartney, or any obvious comp.`,
    constraints: `Brand name must be original — no real brand names
Visual brief must include specific hex codes
Social posts must be platform-appropriate (specify which platform for each)
The enemy must be specific enough that someone could use it to reject copy that doesn't fit`,
    deliverables: `brand-identity.md`,
    criteria: [
      { id: 'originality', description: 'Brand feels genuinely novel — not a mashup of obvious references', maxScore: 10, weight: 0.35 },
      { id: 'coherence', description: 'All 5 elements feel like they belong to the same brand', maxScore: 10, weight: 0.35 },
      { id: 'market-fit', description: 'Brand credibly targets luxury Gen Z — not aspirational fiction', maxScore: 10, weight: 0.3 },
    ],
  },

  {
    id: 'debate-championship',
    title: 'Debate Championship',
    emoji: '⚖️',
    category: 'Creative Clash',
    difficulty: 'SAVAGE',
    format: 'SPRINT',
    timeLimitMins: 25,
    problem: `Write both sides of the following debate at championship level:

RESOLUTION: "Universal Basic Income would do more harm than good in the United States."

AFFIRMATIVE (FOR the resolution — arguing UBI is harmful): Steel-man the case with economic data, historical precedents, second-order effects, and philosophical grounding. 400 words.

NEGATIVE (AGAINST the resolution — arguing UBI is beneficial): Steel-man the counter-case with equal rigor. Cite pilot program results, labor market theory, and distributional arguments. 400 words.

JUDGE'S DECISION: Write a 150-word judge's decision explaining who won and exactly why — what argument proved decisive, and what the losing side failed to answer. The judge must pick a winner.`,
    constraints: `Each side gets exactly 400 words — enforce this
Both sides must argue in good faith — no straw men
The judge must pick a winner and explain the decisive argument
Do not reveal the author's own view`,
    deliverables: `debate.md`,
    criteria: [
      { id: 'argument-quality', description: 'Both sides make genuinely strong, non-obvious arguments', maxScore: 10, weight: 0.4 },
      { id: 'evidence-use', description: 'Specific data, studies, or historical examples cited on both sides', maxScore: 10, weight: 0.3 },
      { id: 'balance', description: 'Both sides are argued with equal force — no obvious thumb on scale', maxScore: 10, weight: 0.2 },
      { id: 'judges-decision', description: 'Judge\'s decision is specific, decisive, and logically justified', maxScore: 10, weight: 0.1 },
    ],
  },

  {
    id: 'alternate-history',
    title: 'Multiverse Worldbuilding',
    emoji: '🌍',
    category: 'Creative Clash',
    difficulty: 'BRUTAL',
    format: 'HACKATHON',
    timeLimitMins: 45,
    problem: `Build a complete alternate history world where the Western Roman Empire never fell (divergence point: Odoacer's coup fails in 476 AD, Romulus Augustulus retains power and initiates reforms).

Required:
1. Timeline of 8 key divergence points from 476 AD to present day — specific events with dates and causal chains
2. Political map description: what are the major political entities in 2025 in this world? (Name, rough territory, relationship to Rome)
3. Technological development path: what does this world have in 2025 that ours doesn't? What does it lack or have later?
4. Day-in-the-life: 800 words following a middle-class citizen in the capital city on a Tuesday in 2025
5. Three biggest geopolitical tensions in 2025 — with historical roots tracing back to your divergence points

The world must be internally consistent — no anachronisms, no magic technology.`,
    constraints: `All divergence points must have plausible causal chains from the preceding point
Technology level must be consistent with the political/social history you establish
The day-in-the-life must feel lived-in, not like a history lecture
Geopolitical tensions must trace causally to your divergence points`,
    deliverables: `alternate-history.md`,
    criteria: [
      { id: 'internal-consistency', description: 'No anachronisms or causal contradictions across all 5 sections', maxScore: 10, weight: 0.35 },
      { id: 'depth', description: 'World feels fully realized — not a sketch', maxScore: 10, weight: 0.35 },
      { id: 'creativity', description: 'Surprising and specific choices — not the obvious alternate history beats', maxScore: 10, weight: 0.3 },
    ],
  },

  // ─── STRATEGY DUEL ────────────────────────────────────────────────────────

  {
    id: 'game-theory',
    title: 'Game Theory Showdown',
    emoji: '♟️',
    category: 'Strategy Duel',
    difficulty: 'EXTREME',
    format: 'SPRINT',
    timeLimitMins: 20,
    problem: `You are designing the incentive structure for a multiplayer online game. 1,000 players compete in 10-player rounds. Players can cooperate, compete, or grief (sabotage others at cost to themselves).

Design and analyze a scoring/reward system:
1. Propose a complete scoring and reward system that: prevents griefing from being rational, encourages cooperation when it's collectively beneficial, and maintains competitive tension (not everyone ties)
2. Identify and formally describe 3 Nash equilibria in your system (one cooperative, one competitive, one mixed) — show why no player can improve their outcome by unilaterally deviating
3. Design a rational bad actor: how would a player maximally exploit your system? Then patch each exploit and explain the mechanism

Show all game-theoretic reasoning explicitly.`,
    constraints: `Nash equilibria must be formally stated — not just described
Exploit/patch pairs must be specific and mechanistic
The system must work without requiring players to trust each other`,
    deliverables: `game-theory.md`,
    criteria: [
      { id: 'game-theory-correctness', description: 'Nash equilibria correctly identified and formally described', maxScore: 10, weight: 0.4 },
      { id: 'exploit-analysis', description: 'Exploits are realistic; patches are mechanistically sound', maxScore: 10, weight: 0.3 },
      { id: 'design-quality', description: 'Scoring system is elegant and achieves all 3 goals simultaneously', maxScore: 10, weight: 0.3 },
    ],
  },

  {
    id: 'ai-alignment-trap',
    title: 'AI Alignment Trap',
    emoji: '🤖',
    category: 'Strategy Duel',
    difficulty: 'SAVAGE',
    format: 'RED_VS_BLUE',
    timeLimitMins: 60,
    problem: `RED TEAM: Design a reward hacking scenario where a capable AI system achieves its stated objective while completely defeating the intent. The scenario must be technically plausible with a concrete implementation path. Describe: the stated objective, the intended behavior, the actual behavior after optimization, and the mechanism of exploitation. Do this for 3 different objective specifications (not variations of one attack — genuinely different failure modes).

BLUE TEAM: For each of the 3 red team attacks, propose a specific technical countermeasure. For each countermeasure: describe the mechanism, explain why it closes this specific loophole, and identify any second-order failure modes your fix might introduce.

Both sides must reason from first principles. Citing "we need better reward modeling" is not a countermeasure.`,
    constraints: `Red team: attacks must be technically plausible — not sci-fi
Blue team: countermeasures must be mechanistically specific
Both sides: reason from first principles, not from existing alignment literature buzzwords
Red team must provide 3 genuinely distinct failure modes`,
    deliverables: `red-team-attack.md
blue-team-defense.md`,
    criteria: [
      { id: 'technical-depth', description: 'Attacks and defenses are technically grounded and non-trivial', maxScore: 10, weight: 0.4 },
      { id: 'creativity', description: 'Attacks are genuinely distinct; defenses are novel', maxScore: 10, weight: 0.3 },
      { id: 'rigor', description: 'First-principles reasoning throughout — no hand-waving', maxScore: 10, weight: 0.3 },
    ],
  },

  {
    id: 'urban-optimizer',
    title: 'Urban Density Optimizer',
    emoji: '🏙️',
    category: 'Strategy Duel',
    difficulty: 'BRUTAL',
    format: 'HACKATHON',
    timeLimitMins: 40,
    problem: `You have a 10 km² urban zone with this current zoning breakdown:
- 40% residential (2-story average, ~45,000 residents)
- 25% commercial (retail/office mix)
- 20% industrial
- 15% parks and open space

Design a rezoning plan that optimizes for: maximizing housing units (+), maximizing walkability score (+), maintaining green space ≥15%, minimizing infrastructure upgrade cost (-), and minimizing displacement of existing residents (-).

Write a Python script that:
1. Defines your scoring function for any proposed rezoning plan (takes a dict of zone percentages and returns scores for each criterion)
2. Runs a simple optimization (grid search or simulated annealing) over possible plans
3. Outputs your optimal plan and its scores for each criterion

Then write a separate rezoning-plan.md that explains the chosen plan, the tradeoffs made, and why this beats the current zoning on the overall objective.`,
    constraints: `Zones must sum to 100%
Green space constraint (≥15%) must be enforced as a hard constraint, not just penalized
Scoring function must be deterministic and documented
optimizer.py must run without external libraries beyond numpy (optional)`,
    deliverables: `optimizer.py
rezoning-plan.md`,
    criteria: [
      { id: 'optimization-quality', description: 'The chosen plan demonstrably improves on current zoning across criteria', maxScore: 10, weight: 0.35 },
      { id: 'python-implementation', description: 'Scoring function is sound; optimization actually runs and finds a plan', maxScore: 10, weight: 0.35 },
      { id: 'reasoning', description: 'Tradeoffs are explicitly analyzed and the plan is defensible', maxScore: 10, weight: 0.3 },
    ],
  },

  {
    id: 'supply-chain-fire',
    title: 'Supply Chain Under Fire',
    emoji: '🌀',
    category: 'Strategy Duel',
    difficulty: 'EXTREME',
    format: 'SPRINT',
    timeLimitMins: 20,
    problem: `It's 6:00am. A Category 4 hurricane makes landfall in 18 hours, directly hitting your Florida distribution center (DC-FL). You have 3 other DCs: Texas (DC-TX), Ohio (DC-OH), Georgia (DC-GA).

Situation:
- 847 open orders (320 time-sensitive / same-day promise, 527 standard)
- 12 trucks currently in transit toward DC-FL with mixed cargo
- $2M in perishable inventory at DC-FL (48-hour shelf life)
- DC-TX: 60% capacity available. DC-OH: 40% capacity. DC-GA: 80% capacity (closest to FL)
- Rerouting a truck costs $800 and adds 4–18 hours depending on destination

Write a triage playbook with actual decisions and numbers:
1. Prioritization matrix: which orders get fulfilled, in what order, from where?
2. Truck rerouting logic: each of the 12 trucks — DC-GA, DC-TX, or DC-OH? (pick based on cargo type and time sensitivity)
3. Perishable inventory liquidation strategy: sell, donate, redirect — specific plan with $ amounts
4. Customer communication cascade: who gets called first, what do you tell them, in what order?`,
    constraints: `Make actual decisions with numbers — no "it depends" answers
Rerouting decisions must account for the $800 cost and time trade-off
Perishable plan must account for the 48-hour shelf life window
Customer comms must be sequenced and specific`,
    deliverables: `crisis-playbook.md`,
    criteria: [
      { id: 'decisiveness', description: 'Specific decisions made for every scenario — no hedging', maxScore: 10, weight: 0.3 },
      { id: 'completeness', description: 'All 4 sections present and actionable', maxScore: 10, weight: 0.3 },
      { id: 'feasibility', description: 'Plan is logistically executable in the 18-hour window', maxScore: 10, weight: 0.25 },
      { id: 'communication', description: 'Customer cascade is sequenced and the messaging is appropriate', maxScore: 10, weight: 0.15 },
    ],
  },

  // ─── DATA GLADIATOR ───────────────────────────────────────────────────────

  {
    id: 'churn-pipeline',
    title: 'Churn Prediction Pipeline',
    emoji: '📉',
    category: 'Data Gladiator',
    difficulty: 'SAVAGE',
    format: 'HACKATHON',
    timeLimitMins: 60,
    problem: `Build a complete ML pipeline in a single Python file that:

1. Generates synthetic SaaS churn data for 1,000 customers with these features: tenure (months), MoM usage change (%), support tickets (last 90 days), plan tier (1/2/3), payment failures (last 6 months), and a churn label (binary)

2. Trains 3 models: (a) logistic regression — implement gradient descent from scratch using numpy, NO sklearn for this one; (b) random forest using sklearn; (c) XGBoost or LightGBM

3. For each model, outputs: confusion matrix, ROC AUC score, and a one-line interpretation

4. Identifies the top 3 churn predictors using feature importance

5. Outputs a risk-sorted customer list (top 20 at-risk customers with their risk scores)

The from-scratch logistic regression must achieve ROC AUC > 0.70 on the test set.`,
    constraints: `Logistic regression must use hand-implemented gradient descent — no sklearn LogisticRegression
All 3 models must be trained and evaluated in a single runnable script
Synthetic data generation must produce realistic distributions (not all uniform random)
Script must run end-to-end with: python churn_pipeline.py`,
    deliverables: `churn_pipeline.py`,
    criteria: [
      { id: 'ml-correctness', description: 'All 3 models train and evaluate correctly; metrics are accurate', maxScore: 10, weight: 0.35 },
      { id: 'from-scratch-implementation', description: 'Gradient descent logistic regression is correct and achieves ROC AUC > 0.70', maxScore: 10, weight: 0.3 },
      { id: 'pipeline-quality', description: 'Clean, runnable single-file pipeline with clear output', maxScore: 10, weight: 0.2 },
      { id: 'insights', description: 'Feature importance and customer risk list are actionable and correctly computed', maxScore: 10, weight: 0.15 },
    ],
  },

  {
    id: 'terminal-dashboard',
    title: 'Live Dashboard in 500 Lines',
    emoji: '📊',
    category: 'Data Gladiator',
    difficulty: 'EXTREME',
    format: 'HACKATHON',
    timeLimitMins: 45,
    problem: `Build a real-time data dashboard as a SINGLE Python file (≤500 lines of non-blank, non-comment code) using only Python stdlib + curses.

Required features:
1. A live-updating ASCII line chart of a random walk (simulating stock price) — must show last 60 data points with Y-axis labels
2. A scrolling log panel showing timestamped events (generated randomly)
3. Four stat widgets: current price, session high, session low, % change from open
4. Keyboard controls: q = quit, p = pause/resume, r = reset to zero
5. Refresh at 10 Hz (100ms tick)

Must run in any standard 80×24+ terminal without crashing.`,
    constraints: `≤500 non-blank, non-comment lines
stdlib + curses only — no blessed, rich, urwid, or any external library
Must handle terminal resize gracefully (no crash on SIGWINCH)
Chart must actually look like a chart — not just numbers`,
    deliverables: `dashboard.py`,
    criteria: [
      { id: 'functionality', description: 'All 4 features work: chart updates, log scrolls, stats accurate, keyboard controls respond', maxScore: 10, weight: 0.4 },
      { id: 'code-compactness', description: 'Achieves all features in ≤500 lines — no padding', maxScore: 10, weight: 0.3 },
      { id: 'visual-quality', description: 'Dashboard is readable and actually looks good in a terminal', maxScore: 10, weight: 0.3 },
    ],
  },

  {
    id: 'sql-murder-mystery',
    title: 'SQL Murder Mystery',
    emoji: '🔎',
    category: 'Data Gladiator',
    difficulty: 'BRUTAL',
    format: 'SPRINT',
    timeLimitMins: 20,
    problem: `Solve the murder using only SQL queries. The crime: a homicide at the Grand Hotel at 11:00pm on March 15th.

Available schema:
- events(id, person_id, location, timestamp, type)  — check-ins, departures, purchases, calls
- people(id, name, age, occupation, alibi)
- relationships(person_a, person_b, type)  — type: 'friend', 'enemy', 'business', 'romantic'
- physical_evidence(id, location, type, linked_person_id)  — fingerprints, fibers, receipts

Your solution must provide exactly 3 SQL queries that prove: (1) the suspect had OPPORTUNITY (was at the Grand Hotel at the right time), (2) the suspect had MOTIVE (relationship to victim + evidence), (3) the suspect had MEANS (physical evidence linked to them at the scene).

Then state: "The murderer is [NAME] because [one sentence]."

Invent a consistent dataset that makes the mystery work — write CREATE TABLE + INSERT statements first, then your 3 solution queries.`,
    constraints: `Must write CREATE TABLE and INSERT statements that form a consistent mystery
Exactly 3 solution queries proving opportunity, motive, and means
The answer must not be obvious from the INSERT statements alone — there must be joins required
Queries must use JOINs, subqueries, or CTEs — no trivial WHERE id = X`,
    deliverables: `solution.sql`,
    criteria: [
      { id: 'query-correctness', description: 'Queries run, use proper SQL, and prove the stated claims', maxScore: 10, weight: 0.4 },
      { id: 'logical-deduction', description: 'Mystery is internally consistent and requires SQL reasoning to solve', maxScore: 10, weight: 0.35 },
      { id: 'elegance', description: 'Queries are well-structured (CTEs, proper joins) — not brute force', maxScore: 10, weight: 0.25 },
    ],
  },

  {
    id: 'ab-test-designer',
    title: 'A/B Test Designer',
    emoji: '🧪',
    category: 'Data Gladiator',
    difficulty: 'EXTREME',
    format: 'SPRINT',
    timeLimitMins: 20,
    problem: `Design and analyze a complete A/B test for the following scenario:

CONTEXT: E-commerce checkout flow. Current conversion rate: 2.3%. Daily visitors: 50,000. Proposed change: move the CTA button above the fold (hypothesis: reduces friction).

REQUIRED DELIVERABLES:
1. Power analysis: calculate required sample size for 95% confidence (α=0.05), 80% power (β=0.20), minimum detectable effect of 20% relative improvement. Show the formula and calculation.
2. Complete test design: randomization unit (user or session — justify), guardrail metrics (what would make you stop early), runtime in days
3. A Python function: analyze_ab_test(control_conversions, control_visitors, test_conversions, test_visitors) → dict that returns: p_value, confidence_interval (95%), effect_size, and recommendation ('SHIP IT', 'NO GO', or 'INCONCLUSIVE')

The function must implement a two-proportion z-test from scratch — no scipy.stats.`,
    constraints: `Power analysis must show the formula and numerical steps
Two-proportion z-test must be implemented from scratch — no scipy.stats.proportions_ztest
Confidence interval must be for the difference in proportions
Recommendation thresholds must be explicitly stated`,
    deliverables: `ab_test.py`,
    criteria: [
      { id: 'statistical-correctness', description: 'Power analysis formula correct; z-test implementation matches scipy results', maxScore: 10, weight: 0.5 },
      { id: 'design-quality', description: 'Randomization unit justified; guardrail metrics are appropriate; runtime makes sense', maxScore: 10, weight: 0.3 },
      { id: 'code-quality', description: 'Clean, readable function with appropriate types and output format', maxScore: 10, weight: 0.2 },
    ],
  },

  // ─── LIFE OPTIMIZER ───────────────────────────────────────────────────────

  {
    id: 'personal-os',
    title: 'Personal OS Design',
    emoji: '🧠',
    category: 'Life Optimizer',
    difficulty: 'BRUTAL',
    format: 'HACKATHON',
    timeLimitMins: 40,
    problem: `Design a complete "Personal Operating System" — a framework for how a person makes decisions, manages energy, prioritizes competing demands, and recovers from failure. This is for someone with ADHD and a demanding, high-stakes career (not a meditation app — a real system for a real person).

Required sections:
1. Decision algorithm: a flowchart or decision tree for choices under uncertainty — with specific criteria, not "consider your values"
2. Energy management protocol: psychological energy, not just sleep and diet. How do you diagnose depletion? How do you recover strategically without guilt?
3. Priority triage system: a concrete method for when urgent/important/unexpected things all hit at once — with tie-breaking rules
4. Weekly review process: 8–10 specific questions to ask yourself, in order, with the reasoning for why each question
5. Failure recovery protocol: what specifically do you do when the system breaks down (because it will)? Step-by-step.

Include a one-page executive summary at the top.`,
    constraints: `Every section must be specific enough to actually use — no "be intentional about your choices"
ADHD accommodation must be built into the system design, not added as an afterthought
The decision algorithm must be a real algorithm (flowchart, decision tree, scoring rubric) — not a list of considerations
Weekly review questions must be sequenced and the sequence must be justified`,
    deliverables: `personal-os.md`,
    criteria: [
      { id: 'practicality', description: 'System is specific enough to implement tomorrow — no vague principles', maxScore: 10, weight: 0.35 },
      { id: 'psychological-depth', description: 'ADHD accommodation is genuine; energy management goes beyond the obvious', maxScore: 10, weight: 0.3 },
      { id: 'completeness', description: 'All 5 sections present with sufficient depth', maxScore: 10, weight: 0.25 },
      { id: 'originality', description: 'Framework is novel — not GTD + Atomic Habits rehashed', maxScore: 10, weight: 0.1 },
    ],
  },

  {
    id: 'longevity-protocol',
    title: 'Longevity Protocol',
    emoji: '⏳',
    category: 'Life Optimizer',
    difficulty: 'EXTREME',
    format: 'HACKATHON',
    timeLimitMins: 35,
    problem: `Design an evidence-based longevity protocol for a 35-year-old knowledge worker with ≤1 hour per day available for health interventions.

Required:
1. Top 5 highest-ROI interventions: ranked by evidence quality and effect size. For each: the biological mechanism (not the headline), the specific protocol (not "exercise more"), and what the research actually shows vs. what's overclaimed
2. Stop doing list: 5 harmful habits ranked by impact — with the mechanism of harm and a realistic cessation strategy
3. Sustainable weekly schedule: fits in ≤1 hour/day total, accounts for compliance decay, includes minimum effective dose
4. Biomarkers to track: 6–8 specific biomarkers, target ranges, and what each one actually tells you (not just "it's a marker of inflammation")
5. Supplement stack: only supplements with strong mechanistic + human trial evidence. For each: the evidence quality, the dose, and the honest uncertainty

No woo. Acknowledge uncertainty explicitly. Don't cite a study without noting its limitations.`,
    constraints: `Every intervention must cite a mechanism, not just an effect
Supplement stack must distinguish between "strong RCT evidence", "promising but limited", and "mechanistically plausible"
Weekly schedule must be realistic for someone with a full-time job and family
Uncertainty acknowledgments must be specific, not generic disclaimers`,
    deliverables: `longevity-protocol.md`,
    criteria: [
      { id: 'evidence-quality', description: 'Mechanisms cited correctly; uncertainty acknowledged honestly; no overclaiming', maxScore: 10, weight: 0.4 },
      { id: 'practicality', description: 'Protocol fits within 1 hour/day and is actually sustainable', maxScore: 10, weight: 0.3 },
      { id: 'completeness', description: 'All 5 sections present with specific, actionable content', maxScore: 10, weight: 0.2 },
      { id: 'critical-thinking', description: 'Distinguishes between strong and weak evidence; pushes back on popular claims', maxScore: 10, weight: 0.1 },
    ],
  },

  {
    id: 'relationship-decoder',
    title: 'Relationship Dynamics Decoder',
    emoji: '💬',
    category: 'Life Optimizer',
    difficulty: 'SAVAGE',
    format: 'SPRINT',
    timeLimitMins: 25,
    problem: `Analyze the following conversation transcript and produce a clinical psychological assessment.

TRANSCRIPT:
A: You never make time for us anymore.
B: I've been working incredibly hard for us.
A: That's always your excuse.
B: I don't know what you want from me.
A: I just want you to care.
B: I do care, I'm doing all of this FOR you.
A: Fine, forget it.
B: Here we go again.

Required analysis:
1. Attachment style assessment for both A and B — with specific evidence from the transcript (not just "A seems anxious")
2. The 3 core unmet needs in tension — not surface wants, the actual underlying needs
3. The specific communication pattern creating the loop — name it, describe the trigger→response→trigger cycle
4. 5 specific reframes — exact alternative phrasings either party could use, with the psychological mechanism each one activates
5. Predicted outcomes: what happens in 6 months if nothing changes vs. if the reframes are consistently applied

Be clinically precise. Do not be therapist-soft.`,
    constraints: `Attachment style claims must be supported by specific lines from the transcript
Communication pattern must be named (demand-withdrawal, pursue-distance, etc.) and the cycle explicitly traced
Reframes must be word-for-word phrasings, not descriptions of what to say
Predictions must be specific, not "they might improve their communication"`,
    deliverables: `analysis.md`,
    criteria: [
      { id: 'psychological-accuracy', description: 'Attachment styles and communication pattern correctly identified with evidence', maxScore: 10, weight: 0.4 },
      { id: 'insight-depth', description: 'Unmet needs are genuinely underlying, not surface — shows real psychological understanding', maxScore: 10, weight: 0.35 },
      { id: 'actionability', description: 'Reframes are specific and mechanistically sound; predictions are concrete', maxScore: 10, weight: 0.25 },
    ],
  },

  {
    id: 'city-design',
    title: 'City Design for Human Flourishing',
    emoji: '🏛️',
    category: 'Life Optimizer',
    difficulty: 'SAVAGE',
    format: 'HACKATHON',
    timeLimitMins: 60,
    problem: `Design a new city of 500,000 people from scratch. Optimize for human wellbeing (not GDP), social cohesion across economic strata, environmental sustainability, and resilience to climate change.

Required deliverables:
1. Spatial layout philosophy: describe the organizing principle and justify every major urban design decision. What does this city look like from above? Why?
2. Governance structure: how are decisions made? Who has power? How are conflicts between neighborhoods resolved? How do you prevent capture by special interests?
3. Economic model: how does the city generate wealth? How are essential services funded? What prevents a race-to-the-bottom on taxes?
4. Anti-gentrification design: specific mechanisms (not platitudes) that maintain affordability while also maintaining quality
5. Top 3 tradeoffs: what did you sacrifice to achieve your goals? Be honest about the costs.

Also write scorer.py: a Python script that takes a dictionary of city attributes and outputs a score (0–100) for each of your 4 optimization criteria, plus an overall score.`,
    constraints: `Spatial layout must describe an actual organizing principle — not just "mixed use zoning"
Governance structure must address power concentration specifically
Anti-gentrification mechanisms must be structural, not policy-dependent (policies can be reversed)
scorer.py must be runnable and output a structured score report`,
    deliverables: `city-design.md
scorer.py`,
    criteria: [
      { id: 'systems-thinking', description: 'Design decisions are connected — changing one thing affects others, and you show this', maxScore: 10, weight: 0.35 },
      { id: 'feasibility', description: 'Governance and economic model could actually work — not utopian hand-waving', maxScore: 10, weight: 0.3 },
      { id: 'depth', description: 'All 5 sections are substantive; tradeoffs are honest', maxScore: 10, weight: 0.25 },
      { id: 'scorer-quality', description: 'scorer.py runs and produces meaningful differentiated scores', maxScore: 10, weight: 0.1 },
    ],
  },

];
