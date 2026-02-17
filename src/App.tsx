import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { getBlob, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import "./App.css";
import {
  BRAINSTORMING_ROOM,
  BRAINSTORMING_SPOTS,
  CEO_REPORT_POINT,
  COLLABORATION_ROOM,
  COLLABORATION_SPOTS,
  COUNCIL_MEMBERS,
  DEFAULT_COLLABORATION_TEAM,
  DEFAULT_OPENAI_DEV_MODEL,
  DEFAULT_OPENAI_MODEL,
  MEMBER_BY_ID,
  OFFICE_DECOR_ITEMS,
  OFFICE_BACKGROUND_GRID,
  getDefaultModelForProvider,
} from "./data/council";
import type {
  LlmProvider,
  OfficeZone,
  RoleRuntimeConfig,
} from "./data/council";
import { auth, db, googleProvider, storage } from "./lib/firebase";
import { requestLlmText, tryParseJson } from "./lib/llm";
import { fileToBase64, generateGeminiImage } from "./lib/gemini";

type WorkflowPhase =
  | "idle"
  | "brainstorming"
  | "collaboration"
  | "execution"
  | "reporting";

type AgentState = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  zone: OfficeZone;
  status: string;
  active: boolean;
};

type RoleConfigMap = Record<string, RoleRuntimeConfig>;

type FileAsset = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  source: "cloud" | "local";
  path?: string;
};

type ReportItem = {
  id: string;
  threadId: string;
  title: string;
  body: string;
  participants: string[];
  createdAt: string;
  assets: FileAsset[];
  source: "cloud" | "local";
};

type ActivityLog = {
  id: string;
  threadId: string;
  createdAt: string;
  phase: WorkflowPhase;
  message: string;
};

type BrainstormPlan = {
  strategy: string;
  participants: string[];
  handoff: string;
};

type CollaborationNote = {
  memberId: string;
  note: string;
};

type CollaborationSessionResult = {
  sessionId: string;
  notes: CollaborationNote[];
  transcript: MeetingTurn[];
};

type ActionPlanItem = {
  id: string;
  threadId: string;
  memberId: string;
  memberName: string;
  plan: string;
  source: "workflow" | "management" | "manual";
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
  lastExecutionSummary?: string;
};

type OfficeMessageKind = "chat" | "report" | "image" | "system";

type OfficeMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  kind: OfficeMessageKind;
  text: string;
  targetIds: string[];
  attachments: FileAsset[];
  createdAt: string;
  source: "cloud" | "local";
};

type MeetingTurn = {
  id: string;
  threadId: string;
  sessionId: string;
  room: "brainstorming" | "collaboration";
  speakerId: string;
  speakerName: string;
  text: string;
  createdAt: string;
  source: "workflow" | "chat";
};

type ThreadGoal = {
  id: string;
  title: string;
  description: string;
};

type ThreadItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  vision: string;
  goals: ThreadGoal[];
};

type GovernanceAlert = {
  id: string;
  threadId: string;
  source: "LEGAL-TAN" | "HR-TAN";
  status: "ok" | "warning";
  message: string;
  createdAt: string;
};

type PreviewState = {
  open: boolean;
  asset: FileAsset | null;
  assetUrl: string;
  loading: boolean;
  textContent: string;
  error: string;
};

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
  gemini: "Gemini",
};

const LOCAL_KEY_ROLE_CONFIG = "hobbytan.role_config";
const LOCAL_KEY_TASK_DRAFT = "hobbytan.task_draft";
const LOCAL_KEY_THREADS = "hobbytan.threads";
const LOCAL_KEY_ACTIVE_THREAD = "hobbytan.active_thread";
const LOCAL_KEY_LEFT_TAB = "hobbytan.left_tab";
const LOCAL_KEY_RIGHT_TAB = "hobbytan.right_tab";
const LOCAL_KEY_LEFT_PANEL_OPEN = "hobbytan.left_panel_open";
const LOCAL_KEY_RIGHT_PANEL_OPEN = "hobbytan.right_panel_open";
const LOCAL_KEY_AMBIENT_MOTION = "hobbytan.ambient_motion";

const DEFAULT_CHAT_RECIPIENTS = ["ATTENDANT-TAN", "PM-TAN", "DEV-TAN", "UX-TAN"];

const UX_IMAGE_MODEL = "gemini-3-pro-image-preview";
const DEPLOYED_APP_URL = "https://automagent-8d64c.web.app";

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));

const isDevMockEnabled = () =>
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("devMock") === "1";

const createMockUser = () =>
  ({
    uid: "dev-mock-ceo",
    displayName: "CEO DEV MOCK",
    email: "ceo@local.test",
    photoURL: "/assets/profiles/ceo.png",
  }) as User;

const formatTime = (isoText: string) =>
  new Date(isoText).toLocaleString("ko-KR", {
    hour12: false,
  });

const isTextLikeMime = (mimeType: string) => {
  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("csv") ||
    normalized.includes("yaml") ||
    normalized.includes("markdown")
  );
};

const extensionFromMime = (mimeType: string) => {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("pdf")) return "pdf";
  return "bin";
};

const base64ToBlob = (base64Data: string, mimeType: string) => {
  const binary = atob(base64Data);
  const buffer = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    buffer[index] = binary.charCodeAt(index);
  }
  return new Blob([buffer], { type: mimeType });
};

const createDefaultRoleConfig = (): RoleConfigMap =>
  Object.fromEntries(
    COUNCIL_MEMBERS.map((member) => [
      member.id,
      {
        provider: member.defaultProvider,
        model: member.defaultModel,
        apiKey: "",
        baseUrl: "",
      },
    ]),
  );

const createInitialAgents = (): Record<string, AgentState> =>
  Object.fromEntries(
    COUNCIL_MEMBERS.map((member) => [
      member.id,
      {
        x: member.seat.x,
        y: member.seat.y,
        targetX: member.seat.x,
        targetY: member.seat.y,
        zone: member.id === "CEO-HOBBY" ? "ceo" : "desk",
        status: member.id === "CEO-HOBBY" ? "최종 승인 대기" : "좌석 대기",
        active: false,
      },
    ]),
  );

const loadRoleConfig = () => {
  const defaults = createDefaultRoleConfig();
  const raw = localStorage.getItem(LOCAL_KEY_ROLE_CONFIG);

  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as RoleConfigMap;
    for (const member of COUNCIL_MEMBERS) {
      const existing = parsed[member.id];
      const provider = existing?.provider || member.defaultProvider;
      defaults[member.id] = {
        provider,
        model: existing?.model || getRoleDefaultModel(member.id, provider),
        apiKey: "",
        baseUrl: existing?.baseUrl || "",
      };
    }
    return defaults;
  } catch {
    return defaults;
  }
};

const parseTimestamp = (value: unknown) => {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return new Date().toISOString();
};

const getMember = (memberId: string) => MEMBER_BY_ID.get(memberId);

const getRoleDefaultModel = (
  memberId: string,
  provider: LlmProvider,
) => {
  const member = getMember(memberId);
  if (!member) {
    return getDefaultModelForProvider(provider);
  }
  if (provider === member.defaultProvider) {
    return member.defaultModel;
  }
  return getDefaultModelForProvider(provider);
};

const createDefaultThread = (): ThreadItem => ({
  id: "thread-main",
  title: "Create virtual HOBBYTAN office",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  vision:
    "HOBBYTAN AI Digital Office는 역할 분담형 에이전트 조직으로, CEO 지시를 실행 가능한 산출물로 빠르게 전환한다.",
  goals: [
    {
      id: "goal-1",
      title: "워크플로우 자동화 품질 향상",
      description: "브레인스토밍-협업-보고 파이프라인 정확도와 속도를 개선한다.",
    },
    {
      id: "goal-2",
      title: "문서/파일 전달 신뢰성 강화",
      description: "미리보기, 다운로드, 버전 히스토리 관리를 안정화한다.",
    },
    {
      id: "goal-3",
      title: "거버넌스 준수 자동 점검",
      description: "LEGAL/HR 감시 규칙으로 위반 가능성을 실시간 감지한다.",
    },
  ],
});

const loadThreads = (): ThreadItem[] => {
  const raw = localStorage.getItem(LOCAL_KEY_THREADS);
  if (!raw) {
    return [createDefaultThread()];
  }

  try {
    const parsed = JSON.parse(raw) as ThreadItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createDefaultThread()];
    }
    return parsed.map((thread, index) => ({
      ...thread,
      id: thread.id || `thread-${index + 1}`,
      title: thread.title || `Thread ${index + 1}`,
      createdAt: thread.createdAt || new Date().toISOString(),
      updatedAt: thread.updatedAt || thread.createdAt || new Date().toISOString(),
      vision: thread.vision || createDefaultThread().vision,
      goals: Array.isArray(thread.goals) && thread.goals.length > 0
        ? thread.goals
        : createDefaultThread().goals,
    }));
  } catch {
    return [createDefaultThread()];
  }
};

const randomStatusByDepartment = (department: string) => {
  switch (department) {
    case "Product":
      return "우선순위 정렬";
    case "Engineering":
      return "코드/테스트 수행";
    case "Design":
      return "UI 명세 검증";
    case "Governance":
      return "정책 리스크 점검";
    case "Growth":
      return "확산 시나리오 점검";
    case "Strategy":
      return "시장 데이터 분석";
    default:
      return "업무 처리";
  }
};

const parseAsset = (raw: unknown): FileAsset | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item = raw as Partial<FileAsset> & Record<string, unknown>;
  const url = typeof item.url === "string" ? item.url : "";
  if (!url) {
    return null;
  }

  return {
    id: typeof item.id === "string" ? item.id : makeId(),
    name: typeof item.name === "string" && item.name ? item.name : "file",
    url,
    mimeType:
      typeof item.mimeType === "string"
        ? item.mimeType
        : typeof item.mime_type === "string"
          ? String(item.mime_type)
          : "application/octet-stream",
    size: typeof item.size === "number" ? item.size : 0,
    uploadedAt:
      typeof item.uploadedAt === "string"
        ? item.uploadedAt
        : typeof item.uploaded_at === "string"
          ? String(item.uploaded_at)
          : new Date().toISOString(),
    source: item.source === "local" ? "local" : "cloud",
    path: typeof item.path === "string" ? item.path : undefined,
  };
};

const parseAssetList = (raw: unknown): FileAsset[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(parseAsset).filter((item): item is FileAsset => !!item);
};

const avatarForMember = (memberId: string, user: User | null) => {
  if (memberId === "CEO-HOBBY" && user?.photoURL) {
    return user.photoURL;
  }

  return getMember(memberId)?.image || "/assets/profiles/ceo.png";
};

function App() {
  const [devMockEnabled] = useState(() => isDevMockEnabled());
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const [roleConfig, setRoleConfig] = useState<RoleConfigMap>(() => loadRoleConfig());
  const [taskInput, setTaskInput] = useState(
    localStorage.getItem(LOCAL_KEY_TASK_DRAFT) || "",
  );

  const [phase, setPhase] = useState<WorkflowPhase>("idle");
  const [running, setRunning] = useState(false);
  const [workflowError, setWorkflowError] = useState("");

  const [agents, setAgents] = useState<Record<string, AgentState>>(() => createInitialAgents());
  const [activeMembers, setActiveMembers] = useState<string[]>([]);

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [cloudReports, setCloudReports] = useState<ReportItem[]>([]);
  const [localReports, setLocalReports] = useState<ReportItem[]>([]);

  const [cloudMessages, setCloudMessages] = useState<OfficeMessage[]>([]);
  const [localMessages, setLocalMessages] = useState<OfficeMessage[]>([]);
  const [meetingTurns, setMeetingTurns] = useState<MeetingTurn[]>([]);
  const [actionPlans, setActionPlans] = useState<ActionPlanItem[]>([]);
  const [governanceAlerts, setGovernanceAlerts] = useState<GovernanceAlert[]>([]);
  const [threads, setThreads] = useState<ThreadItem[]>(() => loadThreads());
  const [activeThreadId, setActiveThreadId] = useState(
    localStorage.getItem(LOCAL_KEY_ACTIVE_THREAD) || "thread-main",
  );
  const [leftTab, setLeftTab] = useState(
    localStorage.getItem(LOCAL_KEY_LEFT_TAB) || "threads",
  );
  const [rightTab, setRightTab] = useState(
    localStorage.getItem(LOCAL_KEY_RIGHT_TAB) || "chat",
  );
  const [leftPanelOpen, setLeftPanelOpen] = useState(
    localStorage.getItem(LOCAL_KEY_LEFT_PANEL_OPEN) === "1",
  );
  const [rightPanelOpen, setRightPanelOpen] = useState(
    localStorage.getItem(LOCAL_KEY_RIGHT_PANEL_OPEN) === "1",
  );
  const [ambientMotionEnabled, setAmbientMotionEnabled] = useState(
    localStorage.getItem(LOCAL_KEY_AMBIENT_MOTION) === "1",
  );

  const [workflowAttachmentFile, setWorkflowAttachmentFile] = useState<File | null>(null);

  const [currentClock, setCurrentClock] = useState(new Date());

  const [messageDraft, setMessageDraft] = useState("");
  const [messageTarget, setMessageTarget] = useState("ATTENDANT-TAN");
  const [messageFiles, setMessageFiles] = useState<File[]>([]);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [executingPlanId, setExecutingPlanId] = useState("");

  const [uxPrompt, setUxPrompt] = useState("");
  const [uxReferenceFiles, setUxReferenceFiles] = useState<File[]>([]);
  const [uxAspectRatio, setUxAspectRatio] = useState("16:9");
  const [uxImageSize, setUxImageSize] = useState<"1K" | "2K" | "4K">("2K");
  const [uxUseSearch, setUxUseSearch] = useState(false);
  const [uxGenerating, setUxGenerating] = useState(false);
  const [uxError, setUxError] = useState("");

  const [previewState, setPreviewState] = useState<PreviewState>({
    open: false,
    asset: null,
    assetUrl: "",
    loading: false,
    textContent: "",
    error: "",
  });
  const governancePollingRef = useRef(false);
  const governanceLastRunRef = useRef(0);
  const governanceSignatureRef = useRef("");

  const currentClockLabel = useMemo(
    () =>
      currentClock.toLocaleString("ko-KR", {
        hour12: false,
      }),
    [currentClock],
  );

  const mergedReports = useMemo(() => {
    const all = [...localReports, ...cloudReports];
    return all.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [cloudReports, localReports]);

  const mergedMessages = useMemo(() => {
    const all = [...localMessages, ...cloudMessages];
    return all.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [cloudMessages, localMessages]);

  const activeThread = useMemo(() => {
    return threads.find((item) => item.id === activeThreadId) || threads[0] || createDefaultThread();
  }, [threads, activeThreadId]);

  const visibleReports = useMemo(
    () => mergedReports.filter((report) => report.threadId === activeThread.id),
    [mergedReports, activeThread.id],
  );

  const visibleMessages = useMemo(
    () => mergedMessages.filter((message) => message.threadId === activeThread.id),
    [mergedMessages, activeThread.id],
  );

  const visibleMeetingTurns = useMemo(
    () => meetingTurns.filter((turn) => turn.threadId === activeThread.id),
    [meetingTurns, activeThread.id],
  );

  const visibleActivityLogs = useMemo(
    () => activityLogs.filter((log) => log.threadId === activeThread.id),
    [activityLogs, activeThread.id],
  );

  const visibleGovernanceAlerts = useMemo(
    () => governanceAlerts.filter((item) => item.threadId === activeThread.id),
    [governanceAlerts, activeThread.id],
  );

  const visibleActionPlans = useMemo(
    () =>
      actionPlans
        .filter((item) => item.threadId === activeThread.id)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [actionPlans, activeThread.id],
  );

  const visibleFileCount = useMemo(() => {
    const fromMessages = visibleMessages.reduce(
      (count, message) => count + message.attachments.length,
      0,
    );
    const fromReports = visibleReports.reduce(
      (count, report) => count + report.assets.length,
      0,
    );
    return fromMessages + fromReports;
  }, [visibleMessages, visibleReports]);

  const resolveRuntime = useCallback((memberId: string) => {
    const member = getMember(memberId);
    const saved = roleConfig[memberId];
    const provider = saved?.provider || member?.defaultProvider || "openai";
    return {
      provider,
      model:
        saved?.model?.trim() ||
        getRoleDefaultModel(memberId, provider) ||
        DEFAULT_OPENAI_MODEL,
      apiKey: saved?.apiKey?.trim() || "",
      baseUrl: saved?.baseUrl?.trim() || "",
    };
  }, [roleConfig]);

  const appendLog = useCallback((currentPhase: WorkflowPhase, message: string, threadId = activeThreadId) => {
    setActivityLogs((previous) => {
      const next: ActivityLog = {
        id: makeId(),
        threadId,
        createdAt: new Date().toISOString(),
        phase: currentPhase,
        message,
      };
      return [next, ...previous].slice(0, 140);
    });
  }, [activeThreadId]);

  const appendMeetingTurn = (
    payload: Omit<MeetingTurn, "id" | "createdAt" | "threadId"> & {
      threadId?: string;
    },
  ) => {
    setMeetingTurns((previous) => [
      {
        ...payload,
        id: makeId(),
        threadId: payload.threadId || activeThreadId,
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ].slice(0, 320));
  };

  const upsertActionPlan = useCallback(
    (
      memberId: string,
      plan: string,
      source: ActionPlanItem["source"],
      threadId = activeThreadId,
    ) => {
      const member = getMember(memberId);
      if (!member || !plan.trim()) {
        return;
      }

      setActionPlans((previous) => {
        const existingIndex = previous.findIndex(
          (item) => item.threadId === threadId && item.memberId === memberId,
        );
        const now = new Date().toISOString();

        if (existingIndex === -1) {
          const next: ActionPlanItem = {
            id: makeId(),
            threadId,
            memberId,
            memberName: member.displayName,
            plan: plan.trim(),
            source,
            createdAt: now,
            updatedAt: now,
          };
          return [next, ...previous].slice(0, 220);
        }

        const clone = [...previous];
        clone[existingIndex] = {
          ...clone[existingIndex],
          plan: plan.trim(),
          source,
          updatedAt: now,
        };
        return clone;
      });
    },
    [activeThreadId],
  );

  const getProxyAuthToken = useCallback(async () => {
    if (!user || devMockEnabled) {
      return "";
    }

    try {
      return await user.getIdToken();
    } catch {
      return "";
    }
  }, [devMockEnabled, user]);

  const createThread = () => {
    const next: ThreadItem = {
      ...createDefaultThread(),
      id: `thread-${Date.now()}`,
      title: `Thread ${threads.length + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setThreads((previous) => [next, ...previous]);
    setActiveThreadId(next.id);
  };

  const updateThread = (threadId: string, patch: Partial<ThreadItem>) => {
    setThreads((previous) =>
      previous.map((item) =>
        item.id === threadId
          ? {
              ...item,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  };

  const moveGoal = (threadId: string, goalId: string, direction: -1 | 1) => {
    setThreads((previous) =>
      previous.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }

        const index = thread.goals.findIndex((goal) => goal.id === goalId);
        if (index === -1) {
          return thread;
        }

        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= thread.goals.length) {
          return thread;
        }

        const reordered = [...thread.goals];
        const [target] = reordered.splice(index, 1);
        reordered.splice(nextIndex, 0, target);

        return {
          ...thread,
          goals: reordered,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const setMembersToDesk = (
    memberIds: string[],
    active = false,
    statusFactory?: (memberId: string) => string,
  ) => {
    setAgents((previous) => {
      const next = { ...previous };
      for (const memberId of memberIds) {
        const member = getMember(memberId);
        if (!member) {
          continue;
        }

        const current = previous[memberId];
        next[memberId] = {
          ...current,
          targetX: member.seat.x,
          targetY: member.seat.y,
          zone: memberId === "CEO-HOBBY" ? "ceo" : "desk",
          active,
          status: statusFactory ? statusFactory(memberId) : current.status,
        };
      }
      return next;
    });
  };

  const moveMembersToRoom = (
    memberIds: string[],
    room: "brainstorming" | "collaboration",
    status: string,
  ) => {
    const spots = room === "brainstorming" ? BRAINSTORMING_SPOTS : COLLABORATION_SPOTS;

    setAgents((previous) => {
      const next = { ...previous };

      memberIds.forEach((memberId, index) => {
        const spot = spots[index % spots.length];
        const current = previous[memberId];
        if (!current) {
          return;
        }

        next[memberId] = {
          ...current,
          targetX: spot.x,
          targetY: spot.y,
          zone: room,
          status,
          active: true,
        };
      });

      return next;
    });
  };

  const moveReportersToCEO = (memberIds: string[]) => {
    setAgents((previous) => {
      const next = { ...previous };
      memberIds.forEach((memberId, index) => {
        const current = previous[memberId];
        if (!current) {
          return;
        }

        next[memberId] = {
          ...current,
          targetX: CEO_REPORT_POINT.x + (index - memberIds.length / 2) * 2,
          targetY: CEO_REPORT_POINT.y + 2,
          zone: "ceo",
          status: "CEO 보고 전달",
          active: true,
        };
      });
      return next;
    });
  };

  const addLocalMessage = (message: Omit<OfficeMessage, "id" | "source">) => {
    setLocalMessages((previous) => [
      ...previous,
      {
        ...message,
        id: `local-${makeId()}`,
        source: "local",
      },
    ]);
  };

  const addLocalReport = (report: Omit<ReportItem, "id" | "source">) => {
    setLocalReports((previous) => [
      {
        ...report,
        id: `local-${makeId()}`,
        source: "local",
      },
      ...previous,
    ]);
  };

  const uploadFileAsset = async (
    file: File,
    category: string,
  ): Promise<FileAsset> => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

    if (!user) {
      return {
        id: makeId(),
        name: file.name,
        url: URL.createObjectURL(file),
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        uploadedAt: new Date().toISOString(),
        source: "local",
      };
    }

    const storagePath = `hobbytan-office/${user.uid}/${category}/${Date.now()}-${safeName}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
    });

    const url = await getDownloadURL(storageRef);

    return {
      id: makeId(),
      name: file.name,
      url,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      uploadedAt: new Date().toISOString(),
      source: "cloud",
      path: storagePath,
    };
  };

  const uploadTextAsset = async (
    content: string,
    filename: string,
    category: string,
    mimeType = "text/markdown; charset=utf-8",
  ) => {
    const normalizedMimeType =
      mimeType.startsWith("text/") && !mimeType.toLowerCase().includes("charset=")
        ? `${mimeType}; charset=utf-8`
        : mimeType;
    const file = new File([`\uFEFF${content}`], filename, { type: normalizedMimeType });
    return uploadFileAsset(file, category);
  };

  const persistOfficeMessage = async (
    payload: Omit<OfficeMessage, "id" | "createdAt" | "source">,
  ) => {
    const createdAt = new Date().toISOString();

    if (!user) {
      addLocalMessage({
        ...payload,
        createdAt,
      });
      return;
    }

    try {
      await addDoc(collection(db, "users", user.uid, "officeMessages"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } catch {
      addLocalMessage({
        ...payload,
        createdAt,
      });
    }
  };

  const persistReport = async (payload: Omit<ReportItem, "id" | "source">) => {
    if (!user) {
      addLocalReport(payload);
      return;
    }

    try {
      await addDoc(collection(db, "users", user.uid, "ceoReports"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } catch {
      addLocalReport(payload);
    }
  };

  const runBrainstorm = async (task: string): Promise<BrainstormPlan> => {
    const roster = COUNCIL_MEMBERS.filter((member) => member.id !== "CEO-HOBBY")
      .map((member) => `${member.id}: ${member.identityPrompt}`)
      .join("\n");

    const runtime = resolveRuntime("ATTENDANT-TAN");
    const authToken = await getProxyAuthToken();

    if (!authToken) {
      return {
        strategy:
          "오프라인 전략: ATTENDANT-TAN이 PM/PO/DEV/UX/QA/LEGAL 중심으로 3단계 실행안을 구성하고 CEO에 단계별 보고한다.",
        participants: DEFAULT_COLLABORATION_TEAM,
        handoff: "협업실에서 세부 실행안 작성 후 담당자별 산출물을 CEO 좌석으로 전달",
      };
    }

    const text = await requestLlmText({
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      authToken,
      instructions:
        "당신은 HOBBYTAN Council 조정자다. 반드시 JSON 객체만 응답하라. 코드블록 금지.",
      input: [
        `CEO 지시: ${task}`,
        "\n참여 가능한 구성원/정체성:",
        roster,
        "\n반환 형식:",
        '{"strategy":"문장","participants":["PO-TAN"],"handoff":"문장"}',
      ].join("\n"),
      temperature: 0.35,
      maxOutputTokens: 700,
    });

    const parsed = tryParseJson<BrainstormPlan>(text);

    if (!parsed) {
      return {
        strategy: text,
        participants: DEFAULT_COLLABORATION_TEAM,
        handoff: "협업실 세션 후 담당자가 CEO에게 보고",
      };
    }

    return {
      strategy:
        typeof parsed.strategy === "string" && parsed.strategy.trim()
          ? parsed.strategy.trim()
          : "전략 초안이 생성되었지만 요약이 비어 있어 기본 플랜을 사용합니다.",
      participants: Array.isArray(parsed.participants)
        ? parsed.participants.map((item) => String(item).trim()).filter(Boolean)
        : DEFAULT_COLLABORATION_TEAM,
      handoff:
        typeof parsed.handoff === "string" && parsed.handoff.trim()
          ? parsed.handoff.trim()
          : "협업실 논의 종료 후 CEO에게 최종 리포트 전달",
    };
  };

  const runPoPmManagementPlan = async (
    task: string,
    strategy: string,
    participants: string[],
  ) => {
    const authToken = await getProxyAuthToken();
    const participantText = participants.join(", ");

    if (!authToken) {
      return {
        poPlan: `PO-TAN 배정안(오프라인): ${participantText} 기준으로 고객가치/리스크 기반 우선순위를 지정`,
        pmPlan: `PM-TAN 일정안(오프라인): 담당자별 D1~D5 마일스톤과 의존성 관리`,
      };
    }

    const poRuntime = resolveRuntime("PO-TAN");
    const pmRuntime = resolveRuntime("PM-TAN");
    const poMember = getMember("PO-TAN");
    const pmMember = getMember("PM-TAN");

    const poPlan = await requestLlmText({
      provider: poRuntime.provider,
      model: poRuntime.model,
      baseUrl: poRuntime.baseUrl,
      authToken,
      instructions:
        poMember?.identityPrompt ||
        "당신은 PO-TAN이다. 우선순위 기준으로 업무를 배정한다.",
      input: [
        `CEO 지시: ${task}`,
        `브레인스토밍 전략: ${strategy}`,
        `협업 참여자: ${participantText}`,
        "역할: 참여자별 업무 배정 + 우선순위 + 승인기준을 제시하라.",
        "형식: 담당자별 항목을 포함한 간결한 실행 지시문",
      ].join("\n\n"),
      maxOutputTokens: 700,
      temperature: 0.35,
    });

    const pmPlan = await requestLlmText({
      provider: pmRuntime.provider,
      model: pmRuntime.model,
      baseUrl: pmRuntime.baseUrl,
      authToken,
      instructions:
        pmMember?.identityPrompt ||
        "당신은 PM-TAN이다. 일정과 병목을 관리한다.",
      input: [
        `CEO 지시: ${task}`,
        `브레인스토밍 전략: ${strategy}`,
        `PO 배정안: ${poPlan}`,
        "역할: 담당자별 일정/WBS, 의존성, 완료 조건, 리스크 완화 순서를 명시하라.",
      ].join("\n\n"),
      maxOutputTokens: 700,
      temperature: 0.35,
    });

    return { poPlan, pmPlan };
  };

  const runCollaboration = async (
    task: string,
    strategy: string,
    participants: string[],
    managementContext: string,
  ): Promise<CollaborationSessionResult> => {
    const selected = participants.slice(0, 8);
    const sessionId = `collab-${Date.now()}`;
    const transcript: MeetingTurn[] = [];
    const notes: CollaborationNote[] = [];
    const authToken = await getProxyAuthToken();

    let priorDialogue = managementContext
      ? `PO/PM 관리 배정안:\n${managementContext}\n\n`
      : "";

    for (const memberId of selected) {
      const member = getMember(memberId);
      if (!member) {
        continue;
      }

      await sleep(320);

      const runtime = resolveRuntime(memberId);
      let note = "";

      if (!authToken) {
        note = `오프라인 제안: ${member.role} 관점에서 '${task}' 실행을 위한 핵심 2단계 액션, 리스크 1개, CEO 확인 포인트 1개를 제안합니다.`;
      } else {
        try {
          note = await requestLlmText({
            provider: runtime.provider,
            model: runtime.model,
            baseUrl: runtime.baseUrl,
            authToken,
            instructions: member.identityPrompt,
            input: [
              `CEO 지시: ${task}`,
              `브레인스토밍 전략: ${strategy}`,
              `PO/PM 관리 배정안: ${managementContext || "없음"}`,
              "이전 발언 기록(먼저 말한 에이전트의 발언을 반드시 반영할 것):",
              priorDialogue || "아직 발언 없음",
              "당신 차례: 앞선 발언을 이어받아 액션 2개 + 리스크/대응 1개 + 다음 담당자에게 넘길 한 줄을 제시하라.",
            ].join("\n\n"),
            temperature: 0.45,
            maxOutputTokens: 700,
            useWebSearch: memberId === "RESEARCHER-TAN",
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "협업 노트 생성 중 알 수 없는 오류";
          note = `호출 실패로 기본 제안 사용: ${message}`;
        }
      }

      notes.push({
        memberId,
        note,
      });

      const turn: MeetingTurn = {
        id: makeId(),
        threadId: activeThreadId,
        sessionId,
        room: "collaboration",
        speakerId: member.id,
        speakerName: member.displayName,
        text: note,
        createdAt: new Date().toISOString(),
        source: "workflow",
      };

      transcript.push(turn);
      appendMeetingTurn({
        sessionId,
        room: "collaboration",
        speakerId: member.id,
        speakerName: member.displayName,
        text: note,
        source: "workflow",
      });
      appendLog("collaboration", `${member.id} 발언 공유 완료`);

      priorDialogue += `${member.id}: ${note}\n\n`;
    }

    return {
      sessionId,
      notes,
      transcript,
    };
  };

  const runFinalReport = async (
    task: string,
    strategy: string,
    notes: CollaborationNote[],
    detailedActionPlans: ActionPlanItem[],
  ) => {
    const runtime = resolveRuntime("ATTENDANT-TAN");
    const authToken = await getProxyAuthToken();
    const joinedNotes = notes
      .map((item) => `${item.memberId}: ${item.note}`)
      .join("\n\n");
    const joinedPlans = detailedActionPlans
      .map(
        (plan, index) =>
          `${index + 1}. ${plan.memberId} (${plan.memberName})\n${plan.plan}`,
      )
      .join("\n\n");

    if (!authToken) {
      return [
        "[CEO 최종 보고서 - 오프라인 모드]",
        `지시 사항: ${task}`,
        `전략: ${strategy}`,
        "실행 핵심:",
        ...notes.map((item) => `- ${item.memberId}: ${item.note}`),
        "",
        "TAN별 액션플랜:",
        joinedPlans || "- 없음",
      ].join("\n");
    }

    return requestLlmText({
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      authToken,
      instructions:
        "당신은 ATTENDANT-TAN이다. 대표에게 올리는 상세 경영 실행보고서를 작성한다. 절대 요약형으로 끝내지 말고, 실제 실행/개발/배포까지 이어질 수준으로 상세하게 작성한다.",
      input: [
        `CEO 지시: ${task}`,
        `브레인스토밍 전략: ${strategy}`,
        "협업실 산출물:",
        joinedNotes,
        "TAN별 액션플랜:",
        joinedPlans || "없음",
        "응답 형식:",
        "1) 경영 요약(2~3문단)",
        "2) TAN별 상세 액션플랜(담당/산출물/완료조건/예상소요/선행의존성)",
        "3) 개발 실행안(기능 구현 범위, 테스트 계획, 품질 게이트)",
        "4) 배포 실행안(환경/체크리스트/롤백/모니터링)",
        "5) 리스크/법무/HR 감시 포인트",
        "6) CEO 승인 필요 항목",
        "7) 승인 직후 다음 플로우(오늘/내일/이번주 액션)",
      ].join("\n\n"),
      temperature: 0.3,
      maxOutputTokens: 2400,
    });
  };

  const runOfficerSingleReply = useCallback(async (
    memberId: string,
    prompt: string,
    attachments: FileAsset[],
    targetLabel: string,
    priorDialogue = "",
  ) => {
    const member = getMember(memberId);
    if (!member) {
      return "역할 정보를 찾지 못했습니다.";
    }

    const runtime = resolveRuntime(memberId);
    const authToken = await getProxyAuthToken();

    const attachmentSummary =
      attachments.length > 0
        ? attachments
            .map((asset) => `${asset.name} (${asset.mimeType}, ${asset.size} bytes)`)
            .join("\n")
        : "없음";
    const devSyncInstruction =
      memberId === "DEV-TAN"
        ? [
            "DEV-TAN 추가 의무:",
            `- GitHub 소스와 현재 배포 버전(${DEPLOYED_APP_URL}) 정합성 점검`,
            "- 불일치 발견 시 재배포 체크리스트와 즉시 조치안 보고",
          ].join("\n")
        : "";

    if (!authToken) {
      return `${member.role} 오프라인 응답: '${prompt}'에 대한 3단계 실행안, 리스크 1개, CEO 확인 포인트 1개를 제시합니다.`;
    }

    return requestLlmText({
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      authToken,
      instructions: member.identityPrompt,
      input: [
        `CEO 메시지: ${prompt}`,
        `대상: ${targetLabel}`,
        `첨부 파일: ${attachmentSummary}`,
        `이전 대화 요약: ${priorDialogue || "없음"}`,
        devSyncInstruction,
        "형식: 핵심 요약 1문단 + 액션 3개 + 리스크/대응 1개 + 보고 문장 1개",
      ].join("\n\n"),
      temperature: 0.4,
      maxOutputTokens: 750,
      useWebSearch: memberId === "RESEARCHER-TAN",
    });
  }, [getProxyAuthToken, resolveRuntime]);

  const addGovernanceAlert = useCallback((
    source: "LEGAL-TAN" | "HR-TAN",
    message: string,
    status: "ok" | "warning",
  ) => {
    setGovernanceAlerts((previous) => [
      {
        id: makeId(),
        threadId: activeThreadId,
        source,
        status,
        message,
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ].slice(0, 140));
  }, [activeThreadId]);

  const runGovernanceWatch = useCallback(async (context: string) => {
    const checks: Array<"LEGAL-TAN" | "HR-TAN"> = ["LEGAL-TAN", "HR-TAN"];

    for (const checker of checks) {
      try {
        const reply = await runOfficerSingleReply(
          checker,
          `다음 실행 맥락이 HOBBYTAN 헌법(법/규정 준수, 역할 충돌 금지, 개인정보/보안 보호)을 위반하는지 감사: ${context}`,
          [],
          "CEO-HOBBY",
        );
        const status = /위반|리스크|warning|금지|불가/i.test(reply)
          ? "warning"
          : "ok";

        addGovernanceAlert(checker, reply, status);
        appendLog("execution", `${checker} 감시 보고 (${status})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "감시 실패";
        addGovernanceAlert(checker, message, "warning");
        appendLog("execution", `${checker} 감시 실패: ${message}`);
      }
    }
  }, [addGovernanceAlert, appendLog, runOfficerSingleReply]);

  const runUxImageGeneration = async (
    prompt: string,
    referenceFiles: File[],
    config?: {
      useSearch?: boolean;
      aspectRatio?: string;
      imageSize?: "1K" | "2K" | "4K";
    },
  ) => {
    const authToken = await getProxyAuthToken();
    if (!authToken) {
      throw new Error("이미지 생성은 실제 로그인 상태에서만 가능합니다.");
    }

    const references = await Promise.all(
      referenceFiles.slice(0, 14).map(async (file) => ({
        mimeType: file.type || "image/png",
        data: await fileToBase64(file),
      })),
    );

    const result = await generateGeminiImage({
      model: UX_IMAGE_MODEL,
      prompt,
      references,
      useSearch: config?.useSearch ?? uxUseSearch,
      aspectRatio: config?.aspectRatio || uxAspectRatio,
      imageSize: config?.imageSize || uxImageSize,
      authToken,
    });

    const imageBlob = base64ToBlob(result.imageBase64, result.mimeType);
    const extension = extensionFromMime(result.mimeType);
    const imageFile = new File([imageBlob], `ux-generated-${Date.now()}.${extension}`, {
      type: result.mimeType,
    });

    const imageAsset = await uploadFileAsset(imageFile, "ux-images");
    const promptAsset = await uploadTextAsset(
      [
        `# UX-TAN 이미지 생성 로그`,
        `- Model: ${UX_IMAGE_MODEL}`,
        `- Prompt: ${prompt}`,
        `- Aspect Ratio: ${config?.aspectRatio || uxAspectRatio}`,
        `- Image Size: ${config?.imageSize || uxImageSize}`,
        `- Search Grounding: ${(config?.useSearch ?? uxUseSearch) ? "enabled" : "disabled"}`,
        result.text ? `\n## 모델 코멘트\n${result.text}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      `ux-image-request-${Date.now()}.md`,
      "ux-images",
      "text/markdown",
    );

    return {
      text: result.text,
      assets: [imageAsset, promptAsset],
    };
  };

  const assetsToReferenceFiles = async (assets: FileAsset[]) => {
    const imageAssets = assets.filter((asset) => asset.mimeType.startsWith("image/"));
    const files = await Promise.all(
      imageAssets.slice(0, 14).map(async (asset) => {
        try {
          const response = await fetch(asset.url);
          const blob = await response.blob();
          return new File([blob], asset.name, { type: asset.mimeType });
        } catch {
          return null;
        }
      }),
    );

    return files.filter((item): item is File => !!item);
  };

  const startWorkflow = async (task: string) => {
    if (!task.trim()) {
      setWorkflowError("CEO 지시 문장을 입력하세요.");
      return;
    }

    if (running) {
      setWorkflowError("이미 워크플로우가 실행 중입니다.");
      return;
    }

    const trimmedTask = task.trim();
    setWorkflowError("");
    setRunning(true);
    updateThread(activeThreadId, {
      title:
        trimmedTask.length > 36
          ? `${trimmedTask.slice(0, 36).trim()}...`
          : trimmedTask,
    });

    try {
      const nonCeoMembers = COUNCIL_MEMBERS.filter(
        (member) => member.id !== "CEO-HOBBY",
      ).map((member) => member.id);

      appendLog("brainstorming", `CEO 지시 접수: ${trimmedTask}`);
      setPhase("brainstorming");
      setActiveMembers(nonCeoMembers);

      moveMembersToRoom(nonCeoMembers, "brainstorming", "브레인스토밍 회의 진행");
      setMembersToDesk(["CEO-HOBBY"], false, () => "지시/승인 대기");

      await sleep(900);
      const brainstorm = await runBrainstorm(trimmedTask);
      appendLog("brainstorming", `전략 수립 완료: ${brainstorm.strategy}`);
      appendMeetingTurn({
        sessionId: `brain-${Date.now()}`,
        room: "brainstorming",
        speakerId: "ATTENDANT-TAN",
        speakerName: "ATTENDANT-TAN",
        text: brainstorm.strategy,
        source: "workflow",
      });

      const participants = Array.from(
        new Set(
          brainstorm.participants
            .map((item) => item.toUpperCase())
            .filter((memberId) => memberId !== "CEO-HOBBY")
            .filter((memberId) => MEMBER_BY_ID.has(memberId)),
        ),
      );

      const collaborationMembers =
        participants.length > 0
          ? participants
          : DEFAULT_COLLABORATION_TEAM.filter((memberId) => MEMBER_BY_ID.has(memberId));

      setPhase("collaboration");
      setActiveMembers(collaborationMembers);

      moveMembersToRoom(collaborationMembers, "collaboration", "협업회의실 실행 플랜 조율");

      const deskMembers = nonCeoMembers.filter(
        (memberId) => !collaborationMembers.includes(memberId),
      );
      setMembersToDesk(deskMembers, false, (memberId) => {
        const member = getMember(memberId);
        return member ? randomStatusByDepartment(member.department) : "백로그 정리";
      });

      appendLog(
        "collaboration",
        `${collaborationMembers.length}명이 협업회의실로 이동해 실행안을 구체화합니다.`,
      );

      const managementPlan = await runPoPmManagementPlan(
        trimmedTask,
        brainstorm.strategy,
        collaborationMembers,
      );
      const managementContext = [
        `[PO-TAN 업무 배정]`,
        managementPlan.poPlan,
        "",
        `[PM-TAN 일정 관리]`,
        managementPlan.pmPlan,
      ].join("\n");

      appendMeetingTurn({
        sessionId: `manage-${Date.now()}`,
        room: "collaboration",
        speakerId: "PO-TAN",
        speakerName: "PO-TAN",
        text: managementPlan.poPlan,
        source: "workflow",
      });
      upsertActionPlan("PO-TAN", managementPlan.poPlan, "management", activeThreadId);
      appendMeetingTurn({
        sessionId: `manage-${Date.now()}-pm`,
        room: "collaboration",
        speakerId: "PM-TAN",
        speakerName: "PM-TAN",
        text: managementPlan.pmPlan,
        source: "workflow",
      });
      upsertActionPlan("PM-TAN", managementPlan.pmPlan, "management", activeThreadId);
      appendLog("collaboration", "PO-TAN/PM-TAN 업무 배정 및 일정 관리안 확정");

      await sleep(1000);

      const collaborationSession = await runCollaboration(
        trimmedTask,
        brainstorm.strategy,
        collaborationMembers,
        managementContext,
      );
      const notes = collaborationSession.notes;
      notes.forEach((item) => {
        upsertActionPlan(item.memberId, item.note, "workflow", activeThreadId);
      });
      appendLog(
        "collaboration",
        `회의 로그 기록 완료: 세션 ${collaborationSession.sessionId}, 발언 ${collaborationSession.transcript.length}건`,
      );

      setPhase("execution");
      setMembersToDesk(collaborationMembers, true, () => "개별 산출물 작성 중");
      appendLog("execution", "협업 결과를 기반으로 각 부서가 실제 결과물을 작성합니다.");

      await sleep(900);

      let inboundAsset: FileAsset | undefined;
      if (workflowAttachmentFile) {
        appendLog("execution", `첨부 파일 업로드 시작: ${workflowAttachmentFile.name}`);
        try {
          inboundAsset = await uploadFileAsset(workflowAttachmentFile, "workflow-inputs");
          appendLog("execution", "첨부 파일 업로드 완료");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "스토리지 업로드 실패";
          appendLog("execution", `첨부 업로드 실패(계속 진행): ${message}`);
        }
      }

      setPhase("reporting");
      moveReportersToCEO(["ATTENDANT-TAN", "PM-TAN", "HOST-TAN"]);
      setMembersToDesk(["CEO-HOBBY"], true, () => "최종 보고 수신 중");

      const reportPlans: ActionPlanItem[] = [
        {
          id: makeId(),
          threadId: activeThreadId,
          memberId: "PO-TAN",
          memberName: getMember("PO-TAN")?.displayName || "PO-TAN",
          plan: managementPlan.poPlan,
          source: "management",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: makeId(),
          threadId: activeThreadId,
          memberId: "PM-TAN",
          memberName: getMember("PM-TAN")?.displayName || "PM-TAN",
          plan: managementPlan.pmPlan,
          source: "management",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...notes.map((item) => ({
          id: makeId(),
          threadId: activeThreadId,
          memberId: item.memberId,
          memberName: getMember(item.memberId)?.displayName || item.memberId,
          plan: item.note,
          source: "workflow" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      ];

      const finalReportText = await runFinalReport(
        trimmedTask,
        brainstorm.strategy,
        notes,
        reportPlans,
      );

      let reportDocumentAsset: FileAsset | undefined;
      let meetingLogAsset: FileAsset | undefined;
      try {
        reportDocumentAsset = await uploadTextAsset(
          finalReportText,
          `ceo-report-${Date.now()}.md`,
          "reports",
          "text/markdown",
        );
      } catch {
        reportDocumentAsset = undefined;
      }

      if (collaborationSession.transcript.length > 0) {
        try {
          const transcriptBody = collaborationSession.transcript
            .map(
              (turn) =>
                `- [${formatTime(turn.createdAt)}] ${turn.speakerId}: ${turn.text}`,
            )
            .join("\n\n");

          meetingLogAsset = await uploadTextAsset(
            [
              `# 회의 로그`,
              `- Session: ${collaborationSession.sessionId}`,
              `- Task: ${trimmedTask}`,
              `- Strategy: ${brainstorm.strategy}`,
              "",
              transcriptBody,
            ].join("\n"),
            `meeting-log-${collaborationSession.sessionId}.md`,
            "reports",
            "text/markdown",
          );
        } catch {
          meetingLogAsset = undefined;
        }
      }

      const reportAssets = [reportDocumentAsset, meetingLogAsset, inboundAsset].filter(
        (item): item is FileAsset => !!item,
      );

      const reportTitle =
        trimmedTask.length > 42 ? `${trimmedTask.slice(0, 42).trim()}...` : trimmedTask;

      const reportData: Omit<ReportItem, "id" | "source"> = {
        threadId: activeThreadId,
        title: `[${new Date().toLocaleTimeString("ko-KR", {
          hour12: false,
        })}] ${reportTitle}`,
        body: finalReportText,
        participants: collaborationMembers,
        assets: reportAssets,
        createdAt: new Date().toISOString(),
      };

      await persistReport(reportData);

      await persistOfficeMessage({
        threadId: activeThreadId,
        senderId: "ATTENDANT-TAN",
        senderName: "ATTENDANT-TAN",
        senderRole: "DEO / Executive Attendant",
        kind: "report",
        text: finalReportText,
        targetIds: ["CEO-HOBBY"],
        attachments: reportAssets,
      });

      await runGovernanceWatch(
        `워크플로우 최종 보고: ${trimmedTask}\n전략: ${brainstorm.strategy}\n참여자: ${collaborationMembers.join(", ")}`,
      );

      appendLog(
        "reporting",
        `CEO 좌석으로 보고 전달 완료. 참여자: ${collaborationMembers.join(", ")}`,
      );

      setWorkflowAttachmentFile(null);
      setPhase("idle");
      setRunning(false);
      setActiveMembers([]);
      setMembersToDesk(nonCeoMembers, false, (memberId) => {
        const member = getMember(memberId);
        return member ? randomStatusByDepartment(member.department) : "대기";
      });
      setMembersToDesk(["CEO-HOBBY"], false, () => "다음 지시 대기");
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      setWorkflowError(message);
      appendLog("reporting", `워크플로우 실패: ${message}`);
      setPhase("idle");
      setRunning(false);
      setActiveMembers([]);
      setMembersToDesk(COUNCIL_MEMBERS.map((member) => member.id), false, (memberId) =>
        memberId === "CEO-HOBBY" ? "다음 지시 대기" : "오류 복구 대기",
      );
    }
  };

  const triggerOfficerReplies = async (
    ceoPrompt: string,
    targetId: string,
    attachments: FileAsset[],
  ) => {
    const resolvedTargets =
      targetId === "ALL" ? DEFAULT_CHAT_RECIPIENTS : [targetId];
    const sessionId = `chat-${Date.now()}`;
    let priorDialogue = `CEO-HOBBY: ${ceoPrompt}\n`;

    if (!running) {
      moveMembersToRoom(resolvedTargets, "collaboration", "CEO 지시 협업 논의");
    }

    for (const memberId of resolvedTargets) {
      const member = getMember(memberId);
      if (!member) {
        continue;
      }

      await sleep(420);

      try {
        if (memberId === "UX-TAN" && ceoPrompt.trim().startsWith("/ux-image")) {
          const prompt = ceoPrompt.replace(/^\/ux-image\s*/i, "").trim();
          if (!prompt) {
            await persistOfficeMessage({
              threadId: activeThreadId,
              senderId: member.id,
              senderName: member.displayName,
              senderRole: member.role,
              kind: "system",
              text: "UX 이미지 생성 명령 형식: /ux-image [프롬프트]",
              targetIds: ["CEO-HOBBY"],
              attachments: [],
            });
            continue;
          }

          appendLog("execution", `UX-TAN 이미지 생성 요청 처리: ${prompt}`);
          const referenceFiles = await assetsToReferenceFiles(attachments);
          const generated = await runUxImageGeneration(prompt, referenceFiles, {
            useSearch: uxUseSearch,
            aspectRatio: uxAspectRatio,
            imageSize: uxImageSize,
          });

          await persistOfficeMessage({
            threadId: activeThreadId,
            senderId: member.id,
            senderName: member.displayName,
            senderRole: member.role,
            kind: "image",
            text:
              generated.text ||
              `UX-TAN이 이미지 산출물을 생성해 CEO에게 전달했습니다.\n프롬프트: ${prompt}`,
            targetIds: ["CEO-HOBBY"],
            attachments: generated.assets,
          });

          appendMeetingTurn({
            sessionId,
            room: "collaboration",
            speakerId: member.id,
            speakerName: member.displayName,
            text:
              generated.text ||
              `이미지 산출물 전달 완료. 프롬프트: ${prompt}`,
            source: "chat",
          });
          appendLog("execution", "UX-TAN 이미지 산출물 전달 완료");
          continue;
        }

        const targetLabel = targetId === "ALL" ? "전체" : targetId;
        const reply = await runOfficerSingleReply(
          memberId,
          ceoPrompt,
          attachments,
          targetLabel,
          priorDialogue,
        );

        let deliverableAsset: FileAsset | undefined;
        try {
          deliverableAsset = await uploadTextAsset(
            [
              `# ${member.displayName} Deliverable`,
              `- Role: ${member.role}`,
              `- CreatedAt: ${new Date().toISOString()}`,
              `- CEO Prompt: ${ceoPrompt}`,
              "",
              reply,
            ].join("\n"),
            `${member.id.toLowerCase()}-deliverable-${Date.now()}.md`,
            "deliverables",
            "text/markdown",
          );
        } catch {
          deliverableAsset = undefined;
        }

        await persistOfficeMessage({
          threadId: activeThreadId,
          senderId: member.id,
          senderName: member.displayName,
          senderRole: member.role,
          kind: "chat",
          text: reply,
          targetIds: ["CEO-HOBBY"],
          attachments: deliverableAsset ? [deliverableAsset] : [],
        });

        appendMeetingTurn({
          sessionId,
          room: "collaboration",
          speakerId: member.id,
          speakerName: member.displayName,
          text: reply,
          source: "chat",
        });
        upsertActionPlan(member.id, reply, "manual", activeThreadId);
        priorDialogue += `${member.id}: ${reply}\n\n`;
        appendLog("execution", `${member.id} 응답 및 문서 전달 완료`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "오피서 응답 생성 실패";
        appendLog("execution", `${member.id} 응답 실패: ${message}`);

        await persistOfficeMessage({
          threadId: activeThreadId,
          senderId: member.id,
          senderName: member.displayName,
          senderRole: member.role,
          kind: "system",
          text: `응답 실패: ${message}`,
          targetIds: ["CEO-HOBBY"],
          attachments: [],
        });
      }
    }

    if (!running) {
      setMembersToDesk(resolvedTargets, false, (memberId) => {
        const member = getMember(memberId);
        return member ? randomStatusByDepartment(member.department) : "대기";
      });
    }

    await runGovernanceWatch(`CEO 채팅 세션 점검:\n${priorDialogue}`);
  };

  const handleSendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const text = messageDraft.trim();

    if (!text && messageFiles.length === 0) {
      setMessageError("메시지 또는 파일을 입력하세요.");
      return;
    }

    setSendingMessage(true);
    setMessageError("");

    try {
      const uploadedAssets: FileAsset[] = [];

      for (const file of messageFiles) {
        try {
          const asset = await uploadFileAsset(file, "chat-attachments");
          uploadedAssets.push(asset);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "첨부 업로드 실패";
          appendLog("execution", `채팅 첨부 업로드 실패(스킵): ${message}`);
        }
      }

      await persistOfficeMessage({
        threadId: activeThreadId,
        senderId: "CEO-HOBBY",
        senderName: "CEO HOBBY",
        senderRole: "Final Decision Maker",
        kind: "chat",
        text: text || "[파일 전달]",
        targetIds: [messageTarget],
        attachments: uploadedAssets,
      });

      appendLog(
        "execution",
        `CEO 채팅 전송: 대상 ${messageTarget}, 첨부 ${uploadedAssets.length}건`,
      );

      setMessageDraft("");
      setMessageFiles([]);

      if (text.startsWith("/run ")) {
        const workflowTask = text.replace(/^\/run\s+/i, "").trim();
        if (workflowTask) {
          setTaskInput(workflowTask);
          await startWorkflow(workflowTask);
        }
      } else {
        void triggerOfficerReplies(text || "파일 전달", messageTarget, uploadedAssets);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "메시지 전송 실패";
      setMessageError(message);
    } finally {
      setSendingMessage(false);
    }
  };

  const executeActionPlan = async (plan: ActionPlanItem) => {
    if (executingPlanId) {
      return;
    }

    const member = getMember(plan.memberId);
    if (!member) {
      return;
    }

    setExecutingPlanId(plan.id);

    try {
      appendLog("execution", `${plan.memberId} 액션플랜 실행 시작`);
      const authToken = await getProxyAuthToken();
      const openaiRuntime = roleConfig[plan.memberId];
      const preferredModel =
        plan.memberId === "DEV-TAN" ? DEFAULT_OPENAI_DEV_MODEL : DEFAULT_OPENAI_MODEL;

      const reply = authToken
        ? await requestLlmText({
            provider: "openai",
            model: preferredModel,
            baseUrl:
              openaiRuntime?.provider === "openai" ? openaiRuntime.baseUrl : "",
            authToken,
            instructions: member.identityPrompt,
            input: [
              "다음 액션플랜을 즉시 실행 가능한 수준으로 구체화하고 진행하라.",
              `액션플랜:\n${plan.plan}`,
              "실행 결과는 1) 지금 수행한 일 2) 산출물 3) 다음 실행 단계 4) 차단 이슈로 보고하라.",
            ].join("\n\n"),
            maxOutputTokens: 900,
            temperature: 0.35,
          })
        : await runOfficerSingleReply(
            plan.memberId,
            [
              "다음 액션플랜을 즉시 실행 가능한 수준으로 구체화하고 진행하라.",
              `액션플랜:\n${plan.plan}`,
              "실행 결과는 1) 지금 수행한 일 2) 산출물 3) 다음 실행 단계 4) 차단 이슈로 보고하라.",
            ].join("\n\n"),
            [],
            "CEO-HOBBY",
          );

      const deliverableAsset = await uploadTextAsset(
        [
          `# ${member.displayName} Action Plan Execution`,
          `- Thread: ${activeThread.title}`,
          `- Member: ${plan.memberId}`,
          `- ExecutedAt: ${new Date().toISOString()}`,
          "",
          "## Original Plan",
          plan.plan,
          "",
          "## Execution Result",
          reply,
        ].join("\n"),
        `${plan.memberId.toLowerCase()}-action-execution-${Date.now()}.md`,
        "deliverables",
        "text/markdown",
      );

      await persistOfficeMessage({
        threadId: plan.threadId,
        senderId: member.id,
        senderName: member.displayName,
        senderRole: member.role,
        kind: "chat",
        text: reply,
        targetIds: ["CEO-HOBBY"],
        attachments: [deliverableAsset],
      });

      appendMeetingTurn({
        threadId: plan.threadId,
        sessionId: `plan-exec-${Date.now()}`,
        room: "collaboration",
        speakerId: member.id,
        speakerName: member.displayName,
        text: `[Action Plan Execute]\n${reply}`,
        source: "workflow",
      });

      setActionPlans((previous) =>
        previous.map((item) =>
          item.id === plan.id
            ? {
                ...item,
                lastExecutedAt: new Date().toISOString(),
                lastExecutionSummary: reply.slice(0, 360),
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );

      appendLog("execution", `${plan.memberId} 액션플랜 실행 완료`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "액션플랜 실행 실패";
      appendLog("execution", `${plan.memberId} 액션플랜 실행 실패: ${message}`);
    } finally {
      setExecutingPlanId("");
    }
  };

  const handleGenerateUxImage = async () => {
    const prompt = uxPrompt.trim();

    if (!prompt) {
      setUxError("UX 이미지 프롬프트를 입력하세요.");
      return;
    }

    setUxGenerating(true);
    setUxError("");

    try {
      appendLog("execution", `UX 이미지 생성 시작: ${prompt}`);
      const generated = await runUxImageGeneration(prompt, uxReferenceFiles, {
        useSearch: uxUseSearch,
        aspectRatio: uxAspectRatio,
        imageSize: uxImageSize,
      });

      await persistOfficeMessage({
        threadId: activeThreadId,
        senderId: "UX-TAN",
        senderName: "UX-TAN",
        senderRole: "Design Lead",
        kind: "image",
        text:
          generated.text ||
          `UX-TAN이 이미지 생성 결과를 전달했습니다.\nPrompt: ${prompt}`,
        targetIds: ["CEO-HOBBY"],
        attachments: generated.assets,
      });

      appendLog("execution", "UX 이미지 생성 완료 및 전달");

      const imageAsset = generated.assets.find((asset) =>
        asset.mimeType.startsWith("image/"),
      );

      if (imageAsset) {
        setPreview({
          open: true,
          asset: imageAsset,
          assetUrl: imageAsset.url,
          loading: false,
          textContent: "",
          error: "",
        });
      }

      setUxPrompt("");
      setUxReferenceFiles([]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "UX 이미지 생성 실패";
      setUxError(message);
      appendLog("execution", `UX 이미지 생성 실패: ${message}`);
    } finally {
      setUxGenerating(false);
    }
  };

  const revokePreviewAssetUrl = (url: string) => {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  };

  const setPreview = (next: PreviewState) => {
    setPreviewState((previous) => {
      if (previous.assetUrl && previous.assetUrl !== next.assetUrl) {
        revokePreviewAssetUrl(previous.assetUrl);
      }
      return next;
    });
  };

  const fetchWithTimeout = useCallback(async (url: string, timeoutMs = 12000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const fetchAssetBlob = useCallback(async (asset: FileAsset) => {
    try {
      const response = await fetchWithTimeout(asset.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.blob();
    } catch (primaryError) {
      if (asset.path && user) {
        const storageRef = ref(storage, asset.path);
        try {
          return await getBlob(storageRef);
        } catch {
          const refreshedUrl = await getDownloadURL(storageRef);
          const refreshedResponse = await fetchWithTimeout(refreshedUrl);
          if (!refreshedResponse.ok) {
            throw new Error(`HTTP ${refreshedResponse.status}`);
          }
          return await refreshedResponse.blob();
        }
      }
      throw primaryError;
    }
  }, [fetchWithTimeout, user]);

  const handleDownloadAsset = useCallback(async (asset: FileAsset) => {
    try {
      const rawBlob = await fetchAssetBlob(asset);
      let downloadBlob = rawBlob;

      if (isTextLikeMime(asset.mimeType)) {
        const decoded = new TextDecoder("utf-8").decode(await rawBlob.arrayBuffer());
        const normalizedMimeType = asset.mimeType.toLowerCase().includes("charset=")
          ? asset.mimeType
          : `${asset.mimeType}; charset=utf-8`;
        downloadBlob = new Blob([`\uFEFF${decoded}`], { type: normalizedMimeType });
      }

      const objectUrl = URL.createObjectURL(downloadBlob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = asset.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "다운로드 실패";
      appendLog("execution", `파일 다운로드 실패: ${asset.name} (${message})`);
      window.open(asset.url, "_blank", "noopener,noreferrer");
    }
  }, [appendLog, fetchAssetBlob]);

  const openAttachmentPreview = async (asset: FileAsset) => {
    setPreview({
      open: true,
      asset,
      assetUrl: asset.url,
      loading: true,
      textContent: "",
      error: "",
    });

    try {
      const blob = await fetchAssetBlob(asset);

      if (isTextLikeMime(asset.mimeType)) {
        const bytes = await blob.arrayBuffer();
        const text = new TextDecoder("utf-8").decode(bytes);
        setPreview({
          open: true,
          asset,
          assetUrl: "",
          loading: false,
          textContent: text,
          error: "",
        });
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      setPreview({
        open: true,
        asset,
        assetUrl: objectUrl,
        loading: false,
        textContent: "",
        error: "",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "파일 프리뷰 로딩 실패";
      setPreview({
        open: true,
        asset,
        assetUrl: asset.url,
        loading: false,
        textContent: "",
        error: message,
      });
    }
  };

  useEffect(() => {
    return () => {
      if (previewState.assetUrl) {
        revokePreviewAssetUrl(previewState.assetUrl);
      }
    };
  }, [previewState.assetUrl]);

  const closePreview = () => {
    setPreview({
      open: false,
      asset: null,
      assetUrl: "",
      loading: false,
      textContent: "",
      error: "",
    });
  };

  const executeWorkflow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await startWorkflow(taskInput);
  };

  useEffect(() => {
    if (devMockEnabled) {
      setUser(createMockUser());
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);

      if (!nextUser) {
        setCloudReports([]);
        setCloudMessages([]);
      }

      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [devMockEnabled]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentClock(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const safeToStore = Object.fromEntries(
      Object.entries(roleConfig).map(([memberId, config]) => [
        memberId,
        {
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: "",
        },
      ]),
    );
    localStorage.setItem(LOCAL_KEY_ROLE_CONFIG, JSON.stringify(safeToStore));
  }, [roleConfig]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_TASK_DRAFT, taskInput);
  }, [taskInput]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_THREADS, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (!threads.some((item) => item.id === activeThreadId) && threads[0]) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_ACTIVE_THREAD, activeThreadId);
  }, [activeThreadId]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_LEFT_TAB, leftTab);
  }, [leftTab]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_RIGHT_TAB, rightTab);
  }, [rightTab]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_LEFT_PANEL_OPEN, leftPanelOpen ? "1" : "0");
  }, [leftPanelOpen]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_RIGHT_PANEL_OPEN, rightPanelOpen ? "1" : "0");
  }, [rightPanelOpen]);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_AMBIENT_MOTION, ambientMotionEnabled ? "1" : "0");
  }, [ambientMotionEnabled]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const reportQuery = query(
      collection(db, "users", user.uid, "ceoReports"),
      orderBy("createdAt", "desc"),
    );

    return onSnapshot(reportQuery, (snapshot) => {
      const nextReports: ReportItem[] = snapshot.docs.map((documentSnapshot) => {
        const data = documentSnapshot.data() as Record<string, unknown>;

        const legacyAttachment =
          typeof data.attachmentUrl === "string"
            ? [
                {
                  id: makeId(),
                  name: "legacy-attachment",
                  url: String(data.attachmentUrl),
                  mimeType: "application/octet-stream",
                  size: 0,
                  uploadedAt: new Date().toISOString(),
                  source: "cloud" as const,
                },
              ]
            : [];

        const assets = [
          ...parseAssetList(data.assets),
          ...parseAssetList(data.attachments),
          ...legacyAttachment,
        ];

        return {
          id: documentSnapshot.id,
          threadId:
            typeof data.threadId === "string" && data.threadId
              ? data.threadId
              : "thread-main",
          title:
            typeof data.title === "string" && data.title
              ? data.title
              : "제목 없음",
          body:
            typeof data.body === "string" && data.body
              ? data.body
              : "본문 없음",
          participants: Array.isArray(data.participants)
            ? data.participants.map((item) => String(item))
            : [],
          assets,
          createdAt: parseTimestamp(data.createdAt),
          source: "cloud",
        };
      });

      setCloudReports(nextReports);
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const messageQuery = query(
      collection(db, "users", user.uid, "officeMessages"),
      orderBy("createdAt", "asc"),
    );

    return onSnapshot(messageQuery, (snapshot) => {
      const messages: OfficeMessage[] = snapshot.docs.map((documentSnapshot) => {
        const data = documentSnapshot.data() as Record<string, unknown>;

        return {
          id: documentSnapshot.id,
          threadId:
            typeof data.threadId === "string" && data.threadId
              ? data.threadId
              : "thread-main",
          senderId:
            typeof data.senderId === "string" ? data.senderId : "ATTENDANT-TAN",
          senderName:
            typeof data.senderName === "string" ? data.senderName : "Unknown",
          senderRole:
            typeof data.senderRole === "string" ? data.senderRole : "Unknown",
          kind:
            data.kind === "report" ||
            data.kind === "image" ||
            data.kind === "system" ||
            data.kind === "chat"
              ? (data.kind as OfficeMessageKind)
              : "chat",
          text: typeof data.text === "string" ? data.text : "",
          targetIds: Array.isArray(data.targetIds)
            ? data.targetIds.map((item) => String(item))
            : [],
          attachments: [
            ...parseAssetList(data.attachments),
            ...parseAssetList(data.assets),
          ],
          createdAt: parseTimestamp(data.createdAt),
          source: "cloud",
        };
      });

      setCloudMessages(messages);
    });
  }, [user]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAgents((previous) => {
        let changed = false;
        const next: Record<string, AgentState> = {};

        for (const member of COUNCIL_MEMBERS) {
          const current = previous[member.id];
          const deltaX = current.targetX - current.x;
          const deltaY = current.targetY - current.y;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

          if (distance <= 0.08) {
            next[member.id] = {
              ...current,
              x: current.targetX,
              y: current.targetY,
            };
            continue;
          }

          changed = true;
          const step = Math.min(distance, 0.7);

          next[member.id] = {
            ...current,
            x: current.x + (deltaX / distance) * step,
            y: current.y + (deltaY / distance) * step,
          };
        }

        return changed ? next : previous;
      });
    }, 50);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user || running || !ambientMotionEnabled) {
      return;
    }

    const timer = window.setInterval(() => {
      const nonCeo = COUNCIL_MEMBERS.filter((member) => member.id !== "CEO-HOBBY");
      const shuffled = [...nonCeo].sort(() => Math.random() - 0.5);

      const brainstormingCount = 3 + Math.floor(Math.random() * 3);
      const collaborationCount = 3 + Math.floor(Math.random() * 3);

      const brainstormingMembers = shuffled
        .slice(0, brainstormingCount)
        .map((member) => member.id);

      const collaborationMembers = shuffled
        .slice(brainstormingCount, brainstormingCount + collaborationCount)
        .map((member) => member.id);

      moveMembersToRoom(
        brainstormingMembers,
        "brainstorming",
        "즉시 브레인스토밍 세션",
      );
      moveMembersToRoom(
        collaborationMembers,
        "collaboration",
        "실행 협업 조정",
      );

      const deskMembers = nonCeo
        .map((member) => member.id)
        .filter(
          (memberId) =>
            !brainstormingMembers.includes(memberId) &&
            !collaborationMembers.includes(memberId),
        );

      setMembersToDesk(deskMembers, false, (memberId) => {
        const member = getMember(memberId);
        return member ? randomStatusByDepartment(member.department) : "좌석 대기";
      });

      setMembersToDesk(["CEO-HOBBY"], false, () => "보고 대기");
      setActiveMembers([...brainstormingMembers, ...collaborationMembers]);

      appendLog(
        "idle",
        `자동 운영: 브레인스토밍 ${brainstormingMembers.length}명 / 협업 ${collaborationMembers.length}명 이동`,
      );
    }, 10000);

    return () => window.clearInterval(timer);
  }, [ambientMotionEnabled, running, user, appendLog]);

  useEffect(() => {
    if (!user || devMockEnabled) {
      return;
    }

    const messageSlice = visibleMessages.slice(-4);
    const meetingSlice = visibleMeetingTurns.slice(-6);
    if (messageSlice.length === 0 && meetingSlice.length === 0) {
      return;
    }

    const signature = JSON.stringify({
      threadId: activeThread.id,
      messages: messageSlice.map((item) => ({
        id: item.id,
        senderId: item.senderId,
        createdAt: item.createdAt,
      })),
      meetings: meetingSlice.map((item) => ({
        id: item.id,
        speakerId: item.speakerId,
        createdAt: item.createdAt,
      })),
    });

    if (signature === governanceSignatureRef.current) {
      return;
    }

    const now = Date.now();
    if (governancePollingRef.current || now - governanceLastRunRef.current < 45000) {
      return;
    }

    governancePollingRef.current = true;
    governanceSignatureRef.current = signature;

    const timer = window.setTimeout(() => {
      const context = [
        `Thread: ${activeThread.title}`,
        "최근 CEO/오피서 채팅:",
        ...messageSlice.map(
          (item) => `- ${item.senderId} -> ${item.targetIds.join(",") || "N/A"}: ${item.text}`,
        ),
        "최근 회의 발언:",
        ...meetingSlice.map((item) => `- ${item.speakerId}: ${item.text}`),
      ].join("\n");

      void runGovernanceWatch(context)
        .finally(() => {
          governanceLastRunRef.current = Date.now();
          governancePollingRef.current = false;
        });
    }, running ? 2500 : 7000);

    return () => {
      window.clearTimeout(timer);
      governancePollingRef.current = false;
    };
  }, [
    user,
    devMockEnabled,
    running,
    activeThread.id,
    activeThread.title,
    visibleMessages,
    visibleMeetingTurns,
    runGovernanceWatch,
  ]);

  const handleSignIn = async () => {
    setAuthError("");

    if (devMockEnabled) {
      setUser(createMockUser());
      return;
    }

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google 로그인에 실패했습니다.";
      setAuthError(message);
    }
  };

  const handleLogout = async () => {
    if (devMockEnabled) {
      window.location.href = window.location.pathname;
      return;
    }
    await signOut(auth);
  };

  if (authLoading) {
    return (
      <div className="splash-screen">
        <div className="splash-card">
          <h1>HOBBYTAN OFFICE</h1>
          <p>Firebase 인증과 오피스 시뮬레이터를 초기화하는 중입니다.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="splash-screen">
        <div className="login-card">
          <div className="login-badge">CCTV MODE</div>
          <h1>HOBBYTAN AI DIGITAL OFFICE</h1>
          <p>
            Google 로그인 후, 14명의 에이전트가 브레인스토밍 회의실과 협업 회의실을
            오가며 CEO 자리로 결과를 보고합니다.
          </p>
          <button type="button" onClick={handleSignIn} className="primary-button">
            Google 로그인
          </button>
          {authError && <p className="error-text">{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-header">
        <div>
          <h1>HOBBYTAN AI / AUTOMAGENT OFFICE</h1>
          <p>
            {currentClockLabel} / CAM-01 LIVE / Firebase: automagent-8d64c / Thread:{" "}
            {activeThread.title}
          </p>
        </div>

        <div className="user-box">
          <img
            src={user.photoURL || "/assets/profiles/ceo.png"}
            alt="user avatar"
            referrerPolicy="no-referrer"
          />
          <div>
            <strong>{user.displayName || "CEO HOBBY"}</strong>
            <span>{user.email}</span>
          </div>
          <button type="button" onClick={() => void handleLogout()}>
            로그아웃
          </button>
        </div>
      </header>

      <div className="workspace-toolbar">
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-button ${leftPanelOpen ? "active" : ""}`}
            onClick={() => setLeftPanelOpen((previous) => !previous)}
          >
            {leftPanelOpen ? "좌측 패널 숨기기" : "좌측 패널 열기"}
          </button>
          <button
            type="button"
            className={`toolbar-button ${rightPanelOpen ? "active" : ""}`}
            onClick={() => setRightPanelOpen((previous) => !previous)}
          >
            {rightPanelOpen ? "우측 패널 숨기기" : "우측 패널 열기"}
          </button>
        </div>
        <div className="toolbar-metrics">
          <span>Thread: {activeThread.title}</span>
          <span>대화 {visibleMessages.length}</span>
          <span>회의 {visibleMeetingTurns.length}</span>
          <span>플랜 {visibleActionPlans.length}</span>
          <span>보고 {visibleReports.length}</span>
          <span>감시 {visibleGovernanceAlerts.length}</span>
        </div>
      </div>

      <main
        className={`workspace-grid ${leftPanelOpen ? "left-open" : "left-closed"} ${
          rightPanelOpen ? "right-open" : "right-closed"
        }`}
      >
        {leftPanelOpen && (
          <section className="panel control-panel">
          <div className="panel-tabs">
            <button
              type="button"
              className={leftTab === "threads" ? "active" : ""}
              onClick={() => setLeftTab("threads")}
            >
              Threads
            </button>
            <button
              type="button"
              className={leftTab === "command" ? "active" : ""}
              onClick={() => setLeftTab("command")}
            >
              Command
            </button>
            <button
              type="button"
              className={leftTab === "mission" ? "active" : ""}
              onClick={() => setLeftTab("mission")}
            >
              Mission
            </button>
            <button
              type="button"
              className={leftTab === "settings" ? "active" : ""}
              onClick={() => setLeftTab("settings")}
            >
              Settings
            </button>
          </div>

          {leftTab === "threads" && (
            <div className="thread-panel">
              <h2>Threads</h2>
              <button type="button" className="secondary-button" onClick={createThread}>
                New Thread
              </button>
              <div className="thread-list">
                {[...threads]
                  .sort(
                    (a, b) =>
                      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
                  )
                  .map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      className={`thread-item ${thread.id === activeThread.id ? "active" : ""}`}
                      onClick={() => setActiveThreadId(thread.id)}
                    >
                      <strong>{thread.title}</strong>
                      <span>{formatTime(thread.updatedAt)}</span>
                    </button>
                  ))}
              </div>
              <div className="status-line">
                <span>메시지: {visibleMessages.length}</span>
                <span>회의로그: {visibleMeetingTurns.length}</span>
              </div>
              <div className="status-line">
                <span>보고서: {visibleReports.length}</span>
                <span>파일교환: {visibleFileCount}</span>
              </div>
              <div className="status-line">
                <span>감시알림: {visibleGovernanceAlerts.length}</span>
                <span>이벤트: {visibleActivityLogs.length}</span>
              </div>
            </div>
          )}

          {leftTab === "command" && (
            <>
              <h2>CEO 지시 콘솔</h2>
              <form onSubmit={executeWorkflow}>
                <p className="dimmed">
                  입력 UI는 탭으로 분리되어 있으며, 실행 기록은 현재 스레드에 저장됩니다.
                </p>

                <label htmlFor="task-input">대표 지시</label>
                <textarea
                  id="task-input"
                  value={taskInput}
                  onChange={(event) => setTaskInput(event.target.value)}
                  placeholder="예) 신규 기능 런칭 전략을 수립하고 결과를 CEO 좌석으로 보고"
                  rows={4}
                />

                <label htmlFor="workflow-attachment">워크플로우 첨부 파일</label>
                <input
                  id="workflow-attachment"
                  type="file"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null;
                    setWorkflowAttachmentFile(nextFile);
                  }}
                />

                <div className="status-line">
                  <span>
                    현재 단계: <strong>{phase}</strong>
                  </span>
                  <span>
                    활성 인원: <strong>{activeMembers.length}</strong>
                  </span>
                </div>

                <button type="submit" className="primary-button" disabled={running}>
                  {running ? "회의/실행 진행 중..." : "지시 실행"}
                </button>
              </form>
              {workflowError && <p className="error-text">{workflowError}</p>}

              <div className="ux-studio">
                <h3>UX-TAN Image Studio</h3>
                <p className="dimmed">
                  Gemini 모델 호출은 서버 프록시를 통해 실행됩니다.
                </p>
                <label htmlFor="ux-prompt">이미지 프롬프트</label>
                <textarea
                  id="ux-prompt"
                  value={uxPrompt}
                  onChange={(event) => setUxPrompt(event.target.value)}
                  rows={3}
                  placeholder="예) 런던 isometric 미니어처 3D 씬 + 날씨 정보"
                />

                <label htmlFor="ux-refs">레퍼런스 이미지 (최대 14개)</label>
                <input
                  id="ux-refs"
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(event) => {
                    setUxReferenceFiles(Array.from(event.target.files || []));
                  }}
                />

                <div className="ux-config-grid">
                  <label>
                    비율
                    <select
                      value={uxAspectRatio}
                      onChange={(event) => setUxAspectRatio(event.target.value)}
                    >
                      {[
                        "1:1",
                        "2:3",
                        "3:2",
                        "3:4",
                        "4:3",
                        "4:5",
                        "5:4",
                        "9:16",
                        "16:9",
                        "21:9",
                      ].map((ratio) => (
                        <option key={ratio} value={ratio}>
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    해상도
                    <select
                      value={uxImageSize}
                      onChange={(event) =>
                        setUxImageSize(event.target.value as "1K" | "2K" | "4K")
                      }
                    >
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                  </label>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={uxUseSearch}
                    onChange={(event) => setUxUseSearch(event.target.checked)}
                  />
                  Google Search Grounding 사용
                </label>

                <button
                  type="button"
                  className="primary-button"
                  disabled={uxGenerating}
                  onClick={handleGenerateUxImage}
                >
                  {uxGenerating ? "UX 이미지 생성 중..." : "UX 이미지 생성"}
                </button>

                {uxError && <p className="error-text">{uxError}</p>}
              </div>
            </>
          )}

          {leftTab === "mission" && (
            <div className="mission-panel">
              <h2>회사 비전 / 우선순위</h2>
              <label>비전</label>
              <textarea
                value={activeThread.vision}
                onChange={(event) =>
                  updateThread(activeThread.id, { vision: event.target.value })
                }
                rows={4}
              />
              <div className="goal-list">
                {activeThread.goals.map((goal, index) => (
                  <article key={goal.id} className="goal-item">
                    <header>
                      <strong>P{index + 1}. {goal.title}</strong>
                    </header>
                    <p>{goal.description}</p>
                    <div className="goal-actions">
                      <button
                        type="button"
                        onClick={() => moveGoal(activeThread.id, goal.id, -1)}
                      >
                        위로
                      </button>
                      <button
                        type="button"
                        onClick={() => moveGoal(activeThread.id, goal.id, 1)}
                      >
                        아래로
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {leftTab === "settings" && (
            <div className="role-grid">
              <article className="role-card global-key-card">
                <div className="role-head">
                  <strong>서버 프록시 실행 정책</strong>
                  <span>API 키는 Firebase Functions Secret Manager에서 관리됩니다.</span>
                </div>
              </article>
              <article className="role-card global-key-card">
                <div className="role-head">
                  <strong>실시간 연출 / GitHub 운영</strong>
                  <span>실업무가 없을 때는 자동 이동을 끌 수 있습니다.</span>
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={ambientMotionEnabled}
                    onChange={(event) => setAmbientMotionEnabled(event.target.checked)}
                  />
                  유휴 시간 자동 이동(ambient motion) 사용
                </label>
                <p className="dimmed">
                  DEV-TAN 의무: GitHub 소스와 배포 버전({DEPLOYED_APP_URL}) 정합성 상시 점검
                </p>
              </article>
              {COUNCIL_MEMBERS.filter((item) => item.id !== "CEO-HOBBY").map((member) => {
                const current = roleConfig[member.id] || {
                  provider: member.defaultProvider,
                  model: member.defaultModel,
                  apiKey: "",
                  baseUrl: "",
                };

                return (
                  <article key={member.id} className="role-card">
                    <div className="role-head">
                      <strong>{member.id}</strong>
                      <span>{member.role}</span>
                    </div>
                    <select
                      value={current.provider}
                      onChange={(event) => {
                        const nextProvider = event.target.value as LlmProvider;
                        setRoleConfig((previous) => ({
                          ...previous,
                          [member.id]: {
                            ...previous[member.id],
                            provider: nextProvider,
                            model: getRoleDefaultModel(member.id, nextProvider),
                          },
                        }));
                      }}
                    >
                      {(
                        ["openai", "anthropic", "xai", "gemini"] as LlmProvider[]
                      ).map((provider) => (
                        <option key={provider} value={provider}>
                          {PROVIDER_LABEL[provider]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={current.model}
                      onChange={(event) => {
                        const nextModel = event.target.value;
                        setRoleConfig((previous) => ({
                          ...previous,
                          [member.id]: {
                            ...previous[member.id],
                            model: nextModel,
                          },
                        }));
                      }}
                      placeholder={getRoleDefaultModel(member.id, current.provider)}
                    />
                    <input
                      type="text"
                      value={current.baseUrl}
                      onChange={(event) => {
                        const nextBaseUrl = event.target.value;
                        setRoleConfig((previous) => ({
                          ...previous,
                          [member.id]: {
                            ...previous[member.id],
                            baseUrl: nextBaseUrl,
                          },
                        }));
                      }}
                      placeholder="Custom Base URL (선택)"
                    />
                  </article>
                );
              })}
            </div>
          )}
          </section>
        )}

        <section className="panel office-panel">
          <div className="camera-overlay">CAM-01 / OFFICE FLOOR</div>
          <div className="office-stage">
            {OFFICE_BACKGROUND_GRID.map((zone) => (
              <div
                key={zone.label}
                className="department-zone"
                style={{
                  left: `${zone.x}%`,
                  top: `${zone.y}%`,
                  width: `${zone.w}%`,
                  height: `${zone.h}%`,
                }}
              >
                {zone.label}
              </div>
            ))}

            {OFFICE_DECOR_ITEMS.map((item) => (
              <div
                key={item.id}
                className={`decor-item ${item.kind}`}
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  width: `${item.w}%`,
                  height: `${item.h}%`,
                }}
              >
                {item.label ? <span>{item.label}</span> : null}
              </div>
            ))}

            <div
              className={`meeting-room ${
                phase === "brainstorming" ? "active" : ""
              }`}
              style={{
                left: `${BRAINSTORMING_ROOM.x - BRAINSTORMING_ROOM.width / 2}%`,
                top: `${BRAINSTORMING_ROOM.y - BRAINSTORMING_ROOM.height / 2}%`,
                width: `${BRAINSTORMING_ROOM.width}%`,
                height: `${BRAINSTORMING_ROOM.height}%`,
              }}
            >
              <span>{BRAINSTORMING_ROOM.label}</span>
              <div className="room-table" />
            </div>

            <div
              className={`meeting-room ${
                phase === "collaboration" ? "active" : ""
              }`}
              style={{
                left: `${COLLABORATION_ROOM.x - COLLABORATION_ROOM.width / 2}%`,
                top: `${COLLABORATION_ROOM.y - COLLABORATION_ROOM.height / 2}%`,
                width: `${COLLABORATION_ROOM.width}%`,
                height: `${COLLABORATION_ROOM.height}%`,
              }}
            >
              <span>{COLLABORATION_ROOM.label}</span>
              <div className="room-table" />
            </div>

            {COUNCIL_MEMBERS.map((member) => (
              <div
                key={`${member.id}-desk`}
                className={`workstation ${
                  member.department.toLowerCase().replace(/\s+/g, "-")
                }`}
                style={{
                  left: `${member.seat.x}%`,
                  top: `${member.seat.y}%`,
                  borderColor: member.color,
                }}
              >
                <span className="workstation-call">{member.callSign}</span>
                <small>{member.department}</small>
              </div>
            ))}

            {COUNCIL_MEMBERS.map((member) => {
              const runtime = agents[member.id];
              const avatar = avatarForMember(member.id, user);

              return (
                <div
                  key={member.id}
                  className={`agent ${runtime.active ? "active" : ""}`}
                  style={
                    {
                      left: `${runtime.x}%`,
                      top: `${runtime.y}%`,
                      "--agent-color": member.color,
                    } as CSSProperties
                  }
                >
                  <img src={avatar} alt={member.displayName} referrerPolicy="no-referrer" />
                  <div className="agent-meta">
                    <strong>{member.callSign}</strong>
                    <span>{runtime.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {rightPanelOpen && (
          <section className="panel side-panel">
          <div className="panel-tabs">
            <button
              type="button"
              className={rightTab === "chat" ? "active" : ""}
              onClick={() => setRightTab("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              className={rightTab === "meeting" ? "active" : ""}
              onClick={() => setRightTab("meeting")}
            >
              Meetings
            </button>
            <button
              type="button"
              className={rightTab === "plans" ? "active" : ""}
              onClick={() => setRightTab("plans")}
            >
              Plans
            </button>
            <button
              type="button"
              className={rightTab === "report" ? "active" : ""}
              onClick={() => setRightTab("report")}
            >
              Reports
            </button>
            <button
              type="button"
              className={rightTab === "log" ? "active" : ""}
              onClick={() => setRightTab("log")}
            >
              Logs
            </button>
            <button
              type="button"
              className={rightTab === "gov" ? "active" : ""}
              onClick={() => setRightTab("gov")}
            >
              Governance
            </button>
          </div>

          {rightTab === "chat" && (
            <div className="side-block chat-block">
              <h2>CEO 채팅 / 파일 전달</h2>
              <div className="chat-stream">
                {visibleMessages.length === 0 && (
                  <p className="dimmed">아직 채팅이 없습니다.</p>
                )}

                {visibleMessages.map((message) => {
                  const mine = message.senderId === "CEO-HOBBY";
                  const avatar = avatarForMember(message.senderId, user);

                  return (
                    <article
                      key={message.id}
                      className={`chat-message ${mine ? "mine" : ""}`}
                    >
                      <img src={avatar} alt={message.senderName} referrerPolicy="no-referrer" />
                      <div className="chat-bubble">
                        <header>
                          <strong>{message.senderName}</strong>
                          <span>{formatTime(message.createdAt)}</span>
                        </header>
                        <small>
                          {message.senderRole}
                          {message.targetIds.length > 0
                            ? ` · 대상: ${message.targetIds.join(", ")}`
                            : ""}
                        </small>
                        <p>{message.text}</p>

                        {message.attachments.length > 0 && (
                          <div className="attachment-list">
                            {message.attachments.map((asset) => (
                              <div key={asset.id} className="attachment-item">
                                <div>
                                  <strong>{asset.name}</strong>
                                  <span>
                                    {asset.mimeType} · {asset.source}
                                  </span>
                                </div>
                                <div className="attachment-actions">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void openAttachmentPreview(asset);
                                    }}
                                  >
                                    프리뷰
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleDownloadAsset(asset);
                                    }}
                                  >
                                    다운로드
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <form className="chat-form" onSubmit={handleSendChat}>
                <label htmlFor="chat-target">수신 대상</label>
                <select
                  id="chat-target"
                  value={messageTarget}
                  onChange={(event) => setMessageTarget(event.target.value)}
                >
                  <option value="ATTENDANT-TAN">ATTENDANT-TAN</option>
                  <option value="PO-TAN">PO-TAN</option>
                  <option value="PM-TAN">PM-TAN</option>
                  <option value="DEV-TAN">DEV-TAN</option>
                  <option value="UX-TAN">UX-TAN</option>
                  <option value="ALL">ALL (핵심 오피서)</option>
                </select>

                <textarea
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  rows={3}
                  placeholder="메시지 입력 (명령 예: /run [지시], /ux-image [프롬프트])"
                />

                <input
                  type="file"
                  multiple
                  onChange={(event) => {
                    setMessageFiles(Array.from(event.target.files || []));
                  }}
                />

                <button type="submit" className="primary-button" disabled={sendingMessage}>
                  {sendingMessage ? "전송 중..." : "메시지 전송"}
                </button>

                {messageError && <p className="error-text">{messageError}</p>}
              </form>
            </div>
          )}

          {rightTab === "meeting" && (
            <div className="side-block">
              <h2>회의 로그</h2>
              <div className="meeting-list">
                {visibleMeetingTurns.length === 0 && (
                  <p className="dimmed">회의 로그가 아직 없습니다.</p>
                )}

                {visibleMeetingTurns.map((turn) => (
                  <article key={turn.id} className="meeting-item">
                    <header>
                      <strong>
                        {turn.room === "brainstorming"
                          ? "브레인스토밍"
                          : "협업"}
                      </strong>
                      <span>{formatTime(turn.createdAt)}</span>
                    </header>
                    <small>
                      {turn.speakerName} ({turn.speakerId})
                    </small>
                    <p>{turn.text}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {rightTab === "plans" && (
            <div className="side-block">
              <h2>TAN 액션플랜</h2>
              <div className="meeting-list">
                {visibleActionPlans.length === 0 && (
                  <p className="dimmed">아직 생성된 액션플랜이 없습니다.</p>
                )}
                {visibleActionPlans.map((plan) => (
                  <article key={plan.id} className="meeting-item">
                    <header>
                      <strong>{plan.memberName}</strong>
                      <span>{formatTime(plan.updatedAt)}</span>
                    </header>
                    <small>
                      {plan.memberId} · {plan.source}
                      {plan.lastExecutedAt ? ` · 실행: ${formatTime(plan.lastExecutedAt)}` : ""}
                    </small>
                    <p>{plan.plan}</p>
                    {plan.lastExecutionSummary && (
                      <p>
                        <strong>최근 실행 요약:</strong>{" "}
                        {plan.lastExecutionSummary}
                      </p>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      disabled={executingPlanId === plan.id}
                      onClick={() => {
                        void executeActionPlan(plan);
                      }}
                    >
                      {executingPlanId === plan.id ? "실행 중..." : `${plan.memberName} 실행`}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {rightTab === "report" && (
            <div className="side-block">
              <h2>CEO 보고함</h2>
              <div className="report-list">
                {visibleReports.length === 0 && (
                  <p className="dimmed">보고서가 아직 없습니다.</p>
                )}

                {visibleReports.map((report) => (
                  <article key={report.id} className="report-item">
                    <header>
                      <strong>{report.title}</strong>
                      <span>{formatTime(report.createdAt)}</span>
                    </header>
                    <p>{report.body}</p>

                    {report.participants.length > 0 && (
                      <div className="participants">참여: {report.participants.join(", ")}</div>
                    )}

                    {report.assets.length > 0 && (
                      <div className="attachment-list">
                        {report.assets.map((asset) => (
                          <div key={asset.id} className="attachment-item">
                            <div>
                              <strong>{asset.name}</strong>
                              <span>{asset.mimeType}</span>
                            </div>
                            <div className="attachment-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  void openAttachmentPreview(asset);
                                }}
                              >
                                프리뷰
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDownloadAsset(asset);
                                }}
                              >
                                다운로드
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <small>
                      저장 위치: {report.source === "cloud" ? "Firestore" : "Local fallback"}
                    </small>
                  </article>
                ))}
              </div>
            </div>
          )}

          {rightTab === "log" && (
            <div className="side-block">
              <h2>실시간 로그</h2>
              <div className="log-list">
                {visibleActivityLogs.length === 0 && (
                  <p className="dimmed">아직 이벤트가 없습니다.</p>
                )}

                {visibleActivityLogs.map((log) => (
                  <article key={log.id} className="log-item">
                    <header>
                      <strong>{log.phase}</strong>
                      <span>{formatTime(log.createdAt)}</span>
                    </header>
                    <p>{log.message}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {rightTab === "gov" && (
            <div className="side-block">
              <h2>LEGAL / HR 감시 로그</h2>
              <div className="log-list">
                {visibleGovernanceAlerts.length === 0 && (
                  <p className="dimmed">아직 감시 이벤트가 없습니다.</p>
                )}
                {visibleGovernanceAlerts.map((item) => (
                  <article key={item.id} className="log-item">
                    <header>
                      <strong>
                        {item.source} · {item.status}
                      </strong>
                      <span>{formatTime(item.createdAt)}</span>
                    </header>
                    <p>{item.message}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
          </section>
        )}
      </main>

      {previewState.open && previewState.asset && (
        <div
          className="preview-overlay"
          onClick={closePreview}
          role="presentation"
        >
          <div
            className="preview-modal"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <header>
              <div>
                <strong>{previewState.asset.name}</strong>
                <span>{previewState.asset.mimeType}</span>
              </div>
              <button type="button" onClick={closePreview}>
                닫기
              </button>
            </header>

            {previewState.loading && <p>프리뷰 로딩 중...</p>}
            {!previewState.loading && previewState.error && (
              <p className="error-text">{previewState.error}</p>
            )}

            {!previewState.loading && !previewState.error && (
              <div className="preview-content">
                {previewState.asset.mimeType.startsWith("image/") && (
                  <img
                    src={previewState.assetUrl || previewState.asset.url}
                    alt={previewState.asset.name}
                  />
                )}

                {previewState.asset.mimeType === "application/pdf" && (
                  <iframe
                    src={previewState.assetUrl || previewState.asset.url}
                    title={previewState.asset.name}
                  />
                )}

                {isTextLikeMime(previewState.asset.mimeType) && (
                  <pre>{previewState.textContent}</pre>
                )}

                {!previewState.asset.mimeType.startsWith("image/") &&
                  previewState.asset.mimeType !== "application/pdf" &&
                  !isTextLikeMime(previewState.asset.mimeType) && (
                    <div className="unsupported-preview">
                      <p>이 파일 형식은 브라우저 내 프리뷰를 지원하지 않습니다.</p>
                      <button
                        type="button"
                        onClick={() => {
                          void handleDownloadAsset(previewState.asset as FileAsset);
                        }}
                      >
                        다운로드
                      </button>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
