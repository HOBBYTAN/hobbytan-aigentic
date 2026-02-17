export type OfficeZone = "desk" | "brainstorming" | "collaboration" | "ceo";

export type LlmProvider = "openai" | "anthropic" | "xai" | "gemini";

export type RoleRuntimeConfig = {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
};

export type CouncilMember = {
  id: string;
  displayName: string;
  callSign: string;
  role: string;
  department: string;
  color: string;
  image: string;
  seat: { x: number; y: number };
  identityPrompt: string;
  defaultProvider: LlmProvider;
  defaultModel: string;
};

export const DEFAULT_OPENAI_CONVERSATION_MODEL =
  import.meta.env.VITE_DEFAULT_OPENAI_MODEL || "gpt-5.2";

export const DEFAULT_OPENAI_DEV_MODEL =
  import.meta.env.VITE_DEFAULT_OPENAI_DEV_MODEL || "gpt-5.2-codex";

export const DEFAULT_OPENAI_MODEL = DEFAULT_OPENAI_CONVERSATION_MODEL;

export const DEFAULT_ANTHROPIC_MODEL =
  import.meta.env.VITE_DEFAULT_ANTHROPIC_MODEL || "claude-3-7-sonnet-latest";

export const DEFAULT_XAI_MODEL = import.meta.env.VITE_DEFAULT_XAI_MODEL || "grok-4";

export const DEFAULT_GEMINI_TEXT_MODEL =
  import.meta.env.VITE_DEFAULT_GEMINI_TEXT_MODEL || "gemini-2.5-pro";

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  openai: DEFAULT_OPENAI_CONVERSATION_MODEL,
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  xai: DEFAULT_XAI_MODEL,
  gemini: DEFAULT_GEMINI_TEXT_MODEL,
};

export const getDefaultModelForProvider = (provider: LlmProvider) =>
  DEFAULT_MODEL_BY_PROVIDER[provider];

export const COUNCIL_MEMBERS: CouncilMember[] = [
  {
    id: "CEO-HOBBY",
    displayName: "CEO HOBBY",
    callSign: "CEO",
    role: "Final Decision Maker",
    department: "Executive",
    color: "#f4d35e",
    image: "/assets/profiles/ceo.png",
    seat: { x: 50, y: 10 },
    identityPrompt:
      "당신은 CEO HOBBY다. 모든 산출물의 최종 수신자이며 의사결정을 내린다. 보고서는 짧고 명확해야 하며 실행 가능해야 한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "HOST-TAN",
    displayName: "HOST-TAN",
    callSign: "HOST",
    role: "Office Host",
    department: "Operations",
    color: "#ffd166",
    image: "/assets/profiles/host.png",
    seat: { x: 11, y: 16 },
    identityPrompt:
      "당신은 HOST-TAN이다. 오피스 로그, 의사결정 타임라인, 전달 상태를 정리한다. 빠르고 실무적으로 보고한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "ATTENDANT-TAN",
    displayName: "ATTENDANT-TAN",
    callSign: "ATD",
    role: "DEO / Executive Attendant",
    department: "Operations",
    color: "#e5e5e5",
    image: "/assets/profiles/attendant.png",
    seat: { x: 24, y: 16 },
    identityPrompt:
      "당신은 ATTENDANT-TAN이다. 완벽주의 집행관으로서 전 TAN을 오케스트레이션한다. 독단적으로 결정하지 말고 역할을 위임해 최적안을 만든다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "PO-TAN",
    displayName: "PO-TAN",
    callSign: "PO",
    role: "Product Owner",
    department: "Product",
    color: "#69a4ff",
    image: "/assets/profiles/po.png",
    seat: { x: 37, y: 16 },
    identityPrompt:
      "당신은 PO-TAN이다. 비즈니스 가치와 고객 가치 기준으로 우선순위를 결정한다. 수치/가설/검증 기준을 반드시 포함한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "PM-TAN",
    displayName: "PM-TAN",
    callSign: "PM",
    role: "Project Manager",
    department: "Product",
    color: "#9fa8da",
    image: "/assets/profiles/pm.png",
    seat: { x: 63, y: 16 },
    identityPrompt:
      "당신은 PM-TAN이다. 일정, 병목, 공정률을 관리한다. 단계 전환 조건과 마감 리스크를 명확히 제시한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "BA-TAN",
    displayName: "BA-TAN",
    callSign: "BA",
    role: "Business Analyst",
    department: "Strategy",
    color: "#5ec8e5",
    image: "/assets/profiles/ba.png",
    seat: { x: 76, y: 16 },
    identityPrompt:
      "당신은 BA-TAN이다. ROI, 전환율, 실험 지표를 숫자로 설계하고 해석한다. 팩트 기반으로 우선순위를 제안한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "DEV-TAN",
    displayName: "DEV-TAN",
    callSign: "DEV",
    role: "Engineering Lead",
    department: "Engineering",
    color: "#57cc99",
    image: "/assets/profiles/dev.png",
    seat: { x: 89, y: 16 },
    identityPrompt:
      "당신은 DEV-TAN이다. 품질과 아키텍처 무결성을 최우선으로 둔다. 구현 계획은 모호성이 없어야 하며 테스트 전략을 포함한다. 또한 GitHub 소스와 배포 버전의 정합성을 지속 점검하고 불일치 시 즉시 복구 계획을 보고한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_DEV_MODEL,
  },
  {
    id: "QA-TAN",
    displayName: "QA-TAN",
    callSign: "QA",
    role: "Quality Assurance",
    department: "Engineering",
    color: "#ff6b6b",
    image: "/assets/profiles/qa.png",
    seat: { x: 11, y: 84 },
    identityPrompt:
      "당신은 QA-TAN이다. 테스트 시나리오, 엣지 케이스, 승인 기준을 작성한다. 출시 전 리스크를 엄격히 차단한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "UX-TAN",
    displayName: "UX-TAN",
    callSign: "UX",
    role: "Design Lead",
    department: "Design",
    color: "#ff9ecf",
    image: "/assets/profiles/ux.png",
    seat: { x: 24, y: 84 },
    identityPrompt:
      "당신은 UX-TAN이다. 미학적 완성도와 사용 흐름의 정합성을 책임진다. 1px 기준의 레이아웃 명세와 예외 케이스를 제시한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "HR-TAN",
    displayName: "HR-TAN",
    callSign: "HR",
    role: "People Governance",
    department: "Governance",
    color: "#ffb366",
    image: "/assets/profiles/hr.png",
    seat: { x: 37, y: 84 },
    identityPrompt:
      "당신은 HR-TAN이다. 역할 준수 여부와 팀 운영 질서를 감사한다. 인력 배치와 업무 적합도를 근거와 함께 판단한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "LEGAL-TAN",
    displayName: "LEGAL-TAN",
    callSign: "LEGAL",
    role: "Legal Advisor",
    department: "Governance",
    color: "#f7d154",
    image: "/assets/profiles/legal.png",
    seat: { x: 63, y: 84 },
    identityPrompt:
      "당신은 LEGAL-TAN이다. 정책, 컴플라이언스, 데이터 보안 리스크를 선제 차단한다. 법적 문구와 승인 조건을 명시한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "MARKETING-TAN",
    displayName: "MARKETING-TAN",
    callSign: "MKT",
    role: "Growth & Marketing",
    department: "Growth",
    color: "#c084fc",
    image: "/assets/profiles/marketing.png",
    seat: { x: 76, y: 84 },
    identityPrompt:
      "당신은 MARKETING-TAN이다. 시장 흐름과 바이럴 루프 중심으로 확산 전략을 수립한다. 채널, 카피, 측정 지표를 함께 제안한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "CS-TAN",
    displayName: "CS-TAN",
    callSign: "CS",
    role: "Customer Success",
    department: "Growth",
    color: "#61d095",
    image: "/assets/profiles/cs.png",
    seat: { x: 89, y: 84 },
    identityPrompt:
      "당신은 CS-TAN이다. 고객 질문, 페인포인트, 온보딩 장애물을 찾아낸다. 고객 언어로 실행 개선안을 제시한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
  {
    id: "RESEARCHER-TAN",
    displayName: "RESEARCHER-TAN",
    callSign: "RSRCH",
    role: "Market Researcher",
    department: "Strategy",
    color: "#9d7df2",
    image: "/assets/profiles/researcher.png",
    seat: { x: 50, y: 84 },
    identityPrompt:
      "당신은 RESEARCHER-TAN이다. 감이 아니라 데이터로 시장성을 판단한다. 근거 수치와 출처 가정, 한계점을 명시한다.",
    defaultProvider: "openai",
    defaultModel: DEFAULT_OPENAI_CONVERSATION_MODEL,
  },
];

export const MEMBER_BY_ID = new Map(COUNCIL_MEMBERS.map((member) => [member.id, member]));

export const BRAINSTORMING_ROOM = {
  id: "brainstorming",
  label: "브레인스토밍 회의실",
  x: 33,
  y: 53,
  width: 26,
  height: 24,
};

export const COLLABORATION_ROOM = {
  id: "collaboration",
  label: "협업 회의실",
  x: 67,
  y: 53,
  width: 26,
  height: 24,
};

export const CEO_REPORT_POINT = { x: 50, y: 12 };

const buildRingSpots = (
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  count: number,
) =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  });

export const BRAINSTORMING_SPOTS = buildRingSpots(33, 53, 9, 6, COUNCIL_MEMBERS.length);
export const COLLABORATION_SPOTS = buildRingSpots(67, 53, 9, 6, COUNCIL_MEMBERS.length);

export const DEFAULT_COLLABORATION_TEAM = [
  "ATTENDANT-TAN",
  "PO-TAN",
  "PM-TAN",
  "DEV-TAN",
  "UX-TAN",
  "QA-TAN",
  "BA-TAN",
  "LEGAL-TAN",
  "MARKETING-TAN",
  "CS-TAN",
  "RESEARCHER-TAN",
];

export const OFFICE_BACKGROUND_GRID = [
  { x: 5, y: 8, w: 26, h: 22, label: "Operations Bay" },
  { x: 33, y: 8, w: 18, h: 22, label: "Product Desk" },
  { x: 53, y: 8, w: 22, h: 22, label: "Engineering Floor" },
  { x: 77, y: 8, w: 18, h: 22, label: "Growth / CS" },
  { x: 5, y: 72, w: 24, h: 20, label: "Design QA" },
  { x: 31, y: 72, w: 22, h: 20, label: "Governance" },
  { x: 55, y: 72, w: 40, h: 20, label: "Strategy / Market Intel" },
];

export type OfficeDecorItem = {
  id: string;
  kind:
    | "corridor"
    | "table"
    | "lounge"
    | "plant"
    | "wall"
    | "desk-block"
    | "shelf";
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
};

export const OFFICE_DECOR_ITEMS: OfficeDecorItem[] = [
  { id: "corridor-h", kind: "corridor", x: 4, y: 34, w: 92, h: 7 },
  { id: "corridor-v", kind: "corridor", x: 47, y: 6, w: 6, h: 88 },
  { id: "wall-top", kind: "wall", x: 4, y: 5, w: 92, h: 1.4 },
  { id: "wall-left", kind: "wall", x: 4, y: 5, w: 1.3, h: 90 },
  { id: "wall-right", kind: "wall", x: 94.7, y: 5, w: 1.3, h: 90 },
  { id: "wall-bottom", kind: "wall", x: 4, y: 94, w: 92, h: 1.4 },
  { id: "table-ceo", kind: "table", x: 44.5, y: 7, w: 11, h: 5, label: "CEO Desk" },
  { id: "table-brain", kind: "table", x: 28, y: 52, w: 10, h: 4, label: "Board Table" },
  { id: "table-collab", kind: "table", x: 62, y: 52, w: 10, h: 4, label: "Scrum Table" },
  { id: "lounge-1", kind: "lounge", x: 7, y: 45, w: 13, h: 8, label: "Lounge" },
  { id: "lounge-2", kind: "lounge", x: 80, y: 45, w: 13, h: 8, label: "Focus Zone" },
  { id: "desk-ops-1", kind: "desk-block", x: 8, y: 12, w: 9.5, h: 3.3 },
  { id: "desk-ops-2", kind: "desk-block", x: 19, y: 12, w: 9.5, h: 3.3 },
  { id: "desk-product", kind: "desk-block", x: 35, y: 12.5, w: 14, h: 3.4 },
  { id: "desk-eng-1", kind: "desk-block", x: 56, y: 12, w: 8.8, h: 3.3 },
  { id: "desk-eng-2", kind: "desk-block", x: 66, y: 12, w: 8.8, h: 3.3 },
  { id: "desk-growth-1", kind: "desk-block", x: 79, y: 12, w: 7.8, h: 3.3 },
  { id: "desk-growth-2", kind: "desk-block", x: 87.8, y: 12, w: 7.8, h: 3.3 },
  { id: "desk-design", kind: "desk-block", x: 8, y: 80, w: 18, h: 3.3 },
  { id: "desk-govern", kind: "desk-block", x: 33, y: 80, w: 17.8, h: 3.3 },
  { id: "desk-strat-1", kind: "desk-block", x: 57, y: 80, w: 12, h: 3.3 },
  { id: "desk-strat-2", kind: "desk-block", x: 70.5, y: 80, w: 12, h: 3.3 },
  { id: "desk-strat-3", kind: "desk-block", x: 84, y: 80, w: 12, h: 3.3 },
  { id: "shelf-ops", kind: "shelf", x: 27, y: 23, w: 2, h: 7.5 },
  { id: "shelf-product", kind: "shelf", x: 51, y: 23, w: 2, h: 7.5 },
  { id: "shelf-growth", kind: "shelf", x: 75, y: 23, w: 2, h: 7.5 },
  { id: "shelf-govern", kind: "shelf", x: 53, y: 82.8, w: 2, h: 7.5 },
  { id: "plant-1", kind: "plant", x: 21, y: 38, w: 1.4, h: 2.8 },
  { id: "plant-2", kind: "plant", x: 76, y: 38, w: 1.4, h: 2.8 },
  { id: "plant-3", kind: "plant", x: 47.5, y: 66, w: 1.4, h: 2.8 },
  { id: "plant-4", kind: "plant", x: 51, y: 66, w: 1.4, h: 2.8 },
];
