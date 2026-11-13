import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Eye,
  FileQuestion,
  Filter,
  FlaskConical,
  GraduationCap,
  House,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Share2,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Trophy,
  Trash2,
  Upload,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Role = "student" | "admin";
type Page = "home" | "tests" | "results" | "planner" | "questions" | "builder" | "students";
type TestStatus = "Available" | "Upcoming" | "Completed";
type QuestionStatus = "Not visited" | "Not answered" | "Answered" | "Review";
type PlannerTask = {
  id: string;
  title: string;
  subject: string;
  minutes: number;
  completed: boolean;
  completedAt?: string;
};

type Question = {
  id: string;
  text: string;
  imageUrl?: string;
  options: { id: string; text: string; isCorrect?: boolean }[];
  explanation: string;
  subject: string;
  chapter: string;
  difficulty: "Easy" | "Medium" | "Hard";
  status?: "Draft" | "Published";
  tags?: string[];
};

type ReviewStatus = "Correct" | "Incorrect" | "Unanswered";
type ReviewedQuestion = Question & {
  selectedOptionId: string | null;
  reviewStatus: ReviewStatus;
};

type TestItem = {
  id: string;
  name: string;
  category: string;
  subject: string;
  questions: number;
  duration: number;
  marks: number;
  negativeMarking?: number;
  status: TestStatus;
  date?: string;
  color: string;
  icon: "book" | "flask" | "leaf";
  progress?: number;
};
type ScorePoint = { test: string; score: number; target: number };

type ApiQuestion = Omit<Question, "options" | "difficulty"> & {
  image_url?: string | null;
  correctOptionId?: string;
  difficulty: string;
  status?: string;
  tags?: string[];
  options: { id: string; text: string; isCorrect?: boolean; is_correct?: boolean }[];
};

type ApiTest = {
  id: string;
  name: string;
  type: string;
  durationMinutes: number;
  totalMarks: number;
  negativeMarking: number;
  isLocked: boolean;
  startTime?: string | null;
  endTime?: string | null;
  _count?: { questions: number };
};

type ApiResult = {
  id: string;
  test: { id: string; name: string; totalMarks?: number };
  score: number | null;
  totalMarks: number;
  rank: number | null;
  correct: number;
  incorrect: number;
  unanswered: number;
  startedAt: string;
  submittedAt: string | null;
  answers: {
    questionId: string;
    text: string;
    subject?: string;
    chapter?: string;
    explanation?: string | null;
    options: { id: string; text: string }[];
    selectedOption?: string | null;
    correctOptionId?: string;
    isCorrect?: boolean;
    marks?: number;
  }[];
};

function mapReviewAnswer(answer: ApiResult["answers"][number]): ReviewedQuestion {
  const selectedOptionId = answer.selectedOption ?? null;
  return {
    id: answer.questionId,
    text: answer.text,
    subject: answer.subject ?? "General",
    chapter: answer.chapter ?? "Review",
    explanation: answer.explanation ?? "",
    difficulty: "Medium",
    selectedOptionId,
    reviewStatus: selectedOptionId ? (answer.isCorrect ? "Correct" : "Incorrect") : "Unanswered",
    options: answer.options.map((option) => ({
      id: option.id,
      text: option.text,
      isCorrect: option.id === answer.correctOptionId,
    })),
  };
}

type AdminStudent = {
  id: string;
  name: string;
  phone: string;
  score: string;
  active: boolean;
  role: string;
  createdAt: string;
};

function mapQuestion(question: ApiQuestion, includeAnswer = false): Question {
  const difficulty = question.difficulty.toLowerCase() as Question["difficulty"];
  return {
    id: question.id,
    text: question.text,
    imageUrl: question.imageUrl ?? question.image_url ?? undefined,
    explanation: question.explanation ?? "",
    subject: question.subject,
    chapter: question.chapter,
    difficulty,
    status: question.status?.toLowerCase() === "draft" ? "Draft" : "Published",
    tags: question.tags ?? [],
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
      ...(includeAnswer
        ? { isCorrect: option.isCorrect ?? option.is_correct ?? option.id === question.correctOptionId }
        : {}),
    })),
  };
}

function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readStoredJson<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  const stored = localStorage.getItem(key);
  if (!stored) return fallback;
  try {
    const value: unknown = JSON.parse(stored);
    if (isValid(value)) return value;
    console.error(`Ignoring invalid saved data for ${key}.`);
  } catch (error) {
    console.error(`Could not read saved data for ${key}.`, error);
  }
  return fallback;
}

function isPlannerTaskList(value: unknown): value is PlannerTask[] {
  return Array.isArray(value) && value.every((item) =>
    item !== null &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.subject === "string" &&
    typeof item.minutes === "number" &&
    typeof item.completed === "boolean" &&
    (item.completedAt === undefined || typeof item.completedAt === "string"),
  );
}

function isDateList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item));
}

function mapTest(test: ApiTest, completedIds: Set<string> = new Set()): TestItem {
  const startsAt = test.startTime ? new Date(test.startTime).getTime() : 0;
  const endsAt = test.endTime ? new Date(test.endTime).getTime() : 0;
  const status: TestStatus = completedIds.has(test.id)
    ? "Completed"
    : test.isLocked || (startsAt > Date.now() && startsAt !== 0) || (endsAt !== 0 && endsAt < Date.now())
      ? "Upcoming"
      : "Available";
  const type = test.type.toUpperCase();
  return {
    id: test.id,
    name: test.name,
    category: type === "FULL_MOCK" ? "Full mock" : type === "CHAPTER" ? "Chapter test" : type === "SUBJECT" ? "Subject test" : "Previous Year Questions",
    subject: type === "FULL_MOCK" || type === "PREVIOUS_YEAR" ? "Physics · Chemistry · Biology" : type === "CHAPTER" ? "Chapter practice" : "Subject practice",
    questions: test._count?.questions ?? 0,
    duration: test.durationMinutes,
    marks: test.totalMarks,
    negativeMarking: test.negativeMarking,
    status,
    date: startsAt > Date.now() ? new Date(startsAt).toLocaleString() : undefined,
    color: type === "CHAPTER" ? "violet" : type === "SUBJECT" ? "green" : type === "PREVIOUS_YEAR" ? "amber" : "blue",
    icon: type === "CHAPTER" ? "flask" : type === "SUBJECT" ? "leaf" : "book",
  };
}

const initialTests: TestItem[] = [
  {
    id: "full-mock-1",
    name: "Full Mock Test 01",
    category: "Full syllabus",
    subject: "Physics · Chemistry · Biology",
    questions: 180,
    duration: 180,
    marks: 720,
    status: "Available",
    color: "blue",
    icon: "book",
  },
  {
    id: "physics-motion",
    name: "Motion in a Straight Line",
    category: "Chapter test",
    subject: "Physics",
    questions: 30,
    duration: 30,
    marks: 120,
    status: "Available",
    color: "violet",
    icon: "flask",
  },
  {
    id: "previous-year-preview",
    name: "PYQ Pattern Practice (Sample)",
    category: "Practice sample",
    subject: "Physics · Chemistry · Biology",
    questions: 5,
    duration: 15,
    marks: 20,
    status: "Available",
    color: "amber",
    icon: "book",
  },
  {
    id: "biology-cell",
    name: "Cell: The Unit of Life",
    category: "Chapter test",
    subject: "Biology",
    questions: 25,
    duration: 25,
    marks: 100,
    status: "Upcoming",
    date: "Today, 6:00 PM",
    color: "green",
    icon: "leaf",
  },
  {
    id: "chemistry-bonding",
    name: "Chemical Bonding",
    category: "Chapter test",
    subject: "Chemistry",
    questions: 30,
    duration: 30,
    marks: 120,
    status: "Completed",
    color: "amber",
    icon: "flask",
    progress: 82,
  },
];

const demoQuestions: Question[] = [
  {
    id: "q1",
    text: "A particle moves along a straight line with a constant acceleration. If it covers 24 m in the first 4 s and 64 m in the next 4 s, its initial velocity is:",
    options: [
      { id: "a", text: "1 m/s", isCorrect: true },
      { id: "b", text: "2 m/s" },
      { id: "c", text: "4 m/s" },
      { id: "d", text: "8 m/s" },
    ],
    explanation:
      "For the first 4 s, 4u + 8a = 24. For the next 4 s, the displacement is 4u + 24a = 64. Subtracting gives a = 2.5 m/s², then u = 1 m/s.",
    subject: "Physics",
    chapter: "Motion in a Straight Line",
    difficulty: "Medium",
  },
  {
    id: "q2",
    text: "The dimensional formula of Planck's constant is the same as that of:",
    options: [
      { id: "a", text: "Energy" },
      { id: "b", text: "Angular momentum", isCorrect: true },
      { id: "c", text: "Power" },
      { id: "d", text: "Force" },
    ],
    explanation:
      "Planck's constant h = E/f. Its dimensions are ML²T⁻¹, the same as angular momentum.",
    subject: "Physics",
    chapter: "Units and Measurements",
    difficulty: "Easy",
  },
  {
    id: "q3",
    text: "Which of the following is the correct SI unit of electric potential?",
    options: [
      { id: "a", text: "Coulomb" },
      { id: "b", text: "Joule" },
      { id: "c", text: "Volt", isCorrect: true },
      { id: "d", text: "Ampere" },
    ],
    explanation:
      "Electric potential is work done per unit charge. Its SI unit is joule per coulomb, called the volt.",
    subject: "Physics",
    chapter: "Electrostatics",
    difficulty: "Easy",
  },
];

const subjectScores = [
  { subject: "Physics", score: 142, maximum: 180, color: "#4263eb" },
  { subject: "Chemistry", score: 158, maximum: 180, color: "#8b5cf6" },
  { subject: "Biology", score: 320, maximum: 360, color: "#10b981" },
];
const chapterStrength = [
  { chapter: "Mechanics", score: 76 },
  { chapter: "Physical chem.", score: 84 },
  { chapter: "Organic chem.", score: 68 },
  { chapter: "Botany", score: 91 },
  { chapter: "Zoology", score: 82 },
  { chapter: "Electricity", score: 60 },
];
const demoScoreHistory: ScorePoint[] = [
  { test: "M1", score: 518, target: 600 },
  { test: "M2", score: 552, target: 600 },
  { test: "M3", score: 534, target: 600 },
  { test: "M4", score: 580, target: 600 },
  { test: "M5", score: 596, target: 600 },
  { test: "M6", score: 620, target: 600 },
];

const initialQuestions: Question[] = [
  ...demoQuestions,
  {
    id: "q4",
    text: "Which organelle is primarily responsible for ATP synthesis in eukaryotic cells?",
    options: [
      { id: "a", text: "Golgi apparatus" },
      { id: "b", text: "Mitochondrion", isCorrect: true },
      { id: "c", text: "Lysosome" },
      { id: "d", text: "Ribosome" },
    ],
    explanation: "Mitochondria produce most cellular ATP through oxidative phosphorylation.",
    subject: "Biology",
    chapter: "Cell: The Unit of Life",
    difficulty: "Easy",
  },
  {
    id: "q5",
    text: "The hybridisation of the central atom in methane is:",
    options: [
      { id: "a", text: "sp" },
      { id: "b", text: "sp²" },
      { id: "c", text: "sp³", isCorrect: true },
      { id: "d", text: "dsp²" },
    ],
    explanation: "The carbon atom forms four equivalent sigma bonds arranged tetrahedrally, so it is sp³ hybridised.",
    subject: "Chemistry",
    chapter: "Chemical Bonding",
    difficulty: "Easy",
  },
];

const chartTooltipStyle = {
  borderRadius: 12,
  border: "1px solid #e8edf5",
  boxShadow: "0 8px 24px rgba(27, 44, 88, .08)",
};

function readToken() {
  return localStorage.getItem("neet-pro-token");
}

async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string | { message?: string };
    message?: string;
  };
  if (!response.ok) {
    const errorMessage = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(errorMessage ?? payload.message ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

async function apiRequestAll<T>(path: string, token: string): Promise<{ items: T[] }> {
  const firstPage = await apiRequest<{ items: T[]; totalPages?: number }>(path, { token });
  const totalPages = firstPage.totalPages ?? 1;
  const items = [...firstPage.items];
  for (let page = 2; page <= totalPages; page += 5) {
    const requests = Array.from({ length: Math.min(5, totalPages - page + 1) }, (_, index) => {
      const pageUrl = new URL(path, window.location.origin);
      pageUrl.searchParams.set("page", String(page + index));
      pageUrl.searchParams.set("limit", "100");
      return apiRequest<{ items: T[] }>(`${pageUrl.pathname}${pageUrl.search}`, { token });
    });
    const batch = await Promise.all(requests);
    items.push(...batch.flatMap(result => result.items));
  }
  return { items };
}

function TestGlyph({ icon }: { icon: TestItem["icon"] }) {
  if (icon === "flask") return <FlaskConical size={20} />;
  if (icon === "leaf") return <Activity size={20} />;
  return <BookOpen size={20} />;
}

function App() {
  const [role, setRole] = useState<Role>(() =>
    localStorage.getItem("neet-pro-role")?.toUpperCase() === "ADMIN" ? "admin" : "student",
  );
  const [page, setPage] = useState<Page>("home");
  const [tests, setTests] = useState(initialTests);
  const [questions, setQuestions] = useState(initialQuestions);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTest, setActiveTest] = useState<TestItem | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [token, setToken] = useState<string | null>(() => readToken());
  const [userRole, setUserRole] = useState(() => localStorage.getItem("neet-pro-role"));
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem("neet-pro-name") ?? "Aarav Sharma",
  );
  const [studyTasks, setStudyTasks] = useState<PlannerTask[]>(() =>
    readStoredJson("neet-pro-study-tasks-v1", [], isPlannerTaskList),
  );
  const [studyGoalMinutes, setStudyGoalMinutes] = useState(() => {
    const stored = Number(localStorage.getItem("neet-pro-study-goal"));
    return Number.isInteger(stored) && stored >= 15 && stored <= 600 ? stored : 120;
  });
  const [studyActivityDates, setStudyActivityDates] = useState<string[]>(() =>
    readStoredJson("neet-pro-study-activity-v1", [], isDateList),
  );
  const [offlineQuestions, setOfflineQuestions] = useState<Question[]>(() =>
    readStoredJson("neet-pro-offline-pack-v1", [], (value): value is Question[] =>
      Array.isArray(value) && value.every((item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.text === "string" &&
        typeof item.subject === "string" &&
        typeof item.chapter === "string" &&
        Array.isArray(item.options) &&
        item.options.length >= 2 &&
        item.options.every((option: unknown) =>
          option !== null &&
          typeof option === "object" &&
          "id" in option &&
          typeof option.id === "string" &&
          "text" in option &&
          typeof option.text === "string" &&
          "isCorrect" in option &&
          typeof option.isCorrect === "boolean",
        ),
      ),
    ),
  );
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [offlinePractice, setOfflinePractice] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [latestResultId, setLatestResultId] = useState<string | null>(null);
  const [resultData, setResultData] = useState<ApiResult | null>(null);
  const [resultAccuracy, setResultAccuracy] = useState(86);
  const [resultTimeTaken, setResultTimeTaken] = useState("2h 48m");
  const [resultTotalMarks, setResultTotalMarks] = useState(720);
  const [resultTestName, setResultTestName] = useState("Full Mock Test 01");
  const [completedTestCount, setCompletedTestCount] = useState(12);
  const [scoreHistory, setScoreHistory] = useState<ScorePoint[]>(demoScoreHistory);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [questionStates, setQuestionStates] = useState<Record<string, QuestionStatus>>({});
  const [sessionQuestions, setSessionQuestions] = useState(initialQuestions);
  const [remainingSeconds, setRemainingSeconds] = useState(3 * 60 * 60);
  const [answerSaveStatus, setAnswerSaveStatus] = useState<"ready" | "saving" | "saved" | "error" | "local">("ready");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultScore, setResultScore] = useState(620);
  const [resultRank, setResultRank] = useState<number | null>(null);
  const [modal, setModal] = useState<"question" | "test" | "import" | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [otpStage, setOtpStage] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [callingCode, setCallingCode] = useState("+91");
  const [otp, setOtp] = useState("");
  const [otpChallengeId, setOtpChallengeId] = useState("");
  const [otpHint, setOtpHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("All subjects");
  const [newQuestionText, setNewQuestionText] = useState("");
  const [questionOptions, setQuestionOptions] = useState(["", "", "", ""]);
  const [correctOption, setCorrectOption] = useState("a");
  const [questionSubject, setQuestionSubject] = useState("Physics");
  const [questionChapter, setQuestionChapter] = useState("");
  const [questionDifficulty, setQuestionDifficulty] = useState<Question["difficulty"]>("Medium");
  const [questionExplanation, setQuestionExplanation] = useState("");
  const [questionTagsInput, setQuestionTagsInput] = useState("");
  const [questionImageUrl, setQuestionImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [newTestName, setNewTestName] = useState("");
  const [newTestType, setNewTestType] = useState("FULL_MOCK");
  const [newTestDuration, setNewTestDuration] = useState("180");
  const [newTestQuestionCount, setNewTestQuestionCount] = useState("180");
  const [newTestSubject, setNewTestSubject] = useState("All subjects");
  const [newTestChapter, setNewTestChapter] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [reviewQuestions, setReviewQuestions] = useState<ReviewedQuestion[]>(demoQuestions.slice(0, 2).map((question) => ({
    ...question,
    selectedOptionId: question.options.find((option) => !option.isCorrect)?.id ?? null,
    reviewStatus: "Incorrect",
  })));
  const [reviewQuestion, setReviewQuestion] = useState<ReviewedQuestion | null>(null);
  const [adminStudents, setAdminStudents] = useState([
    { id: "demo-1", name: "Aarav Sharma", phone: "+91 98765 43210", score: "620 / 720", active: true, role: "STUDENT", createdAt: "Demo account" },
    { id: "demo-2", name: "Ananya Gupta", phone: "+91 98201 23456", score: "684 / 720", active: true, role: "STUDENT", createdAt: "Demo account" },
    { id: "demo-3", name: "Vihaan Patel", phone: "+91 97654 32109", score: "512 / 720", active: true, role: "STUDENT", createdAt: "Demo account" },
    { id: "demo-4", name: "Meera Nair", phone: "+91 98900 12345", score: "—", active: false, role: "STUDENT", createdAt: "Demo account" },
  ]);
  const [totalStudentCount, setTotalStudentCount] = useState(4);
  const [selectedStudent, setSelectedStudent] = useState<AdminStudent | null>(null);
  const answerTimes = useRef<Record<string, number>>({});
  const selectedAnswersRef = useRef(selectedAnswers);
  const questionStatesRef = useRef(questionStates);
  const questionIndexRef = useRef(questionIndex);
  const attemptIdRef = useRef(attemptId);
  const sessionQuestionsRef = useRef(sessionQuestions);
  const activeTestRef = useRef(activeTest);
  const remainingSecondsRef = useRef(remainingSeconds);
  const attemptDeadlineRef = useRef(Date.now() + 3 * 60 * 60 * 1000);
  const answerSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const submissionInProgressRef = useRef(false);
  const attemptStartedAtRef = useRef(new Date().toISOString());
  const questionStartedAtRef = useRef(Date.now());
  selectedAnswersRef.current = selectedAnswers;
  questionStatesRef.current = questionStates;
  questionIndexRef.current = questionIndex;
  attemptIdRef.current = attemptId;
  sessionQuestionsRef.current = sessionQuestions;
  activeTestRef.current = activeTest;
  remainingSecondsRef.current = remainingSeconds;
  const activeQuestion = sessionQuestions[questionIndex % sessionQuestions.length];
  const availablePages: { id: Page; label: string; icon: typeof House }[] =
    role === "student"
      ? [
          { id: "home", label: "Overview", icon: House },
          { id: "tests", label: "Mock tests", icon: FileQuestion },
          { id: "results", label: "My results", icon: BarChart3 },
          { id: "planner", label: "Study plan", icon: CalendarDays },
        ]
      : [
          { id: "home", label: "Overview", icon: LayoutDashboard },
          { id: "questions", label: "Question bank", icon: FileQuestion },
          { id: "builder", label: "Test creator", icon: BookOpen },
          { id: "students", label: "Students", icon: Users },
        ];

  const visibleTests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tests.filter((test) => {
      const matchesSearch =
        !query ||
        `${test.name} ${test.subject} ${test.category}`.toLowerCase().includes(query);
      const matchesSubject = subjectFilter === "All subjects" || test.subject.includes(subjectFilter);
      return matchesSearch && matchesSubject;
    });
  }, [search, subjectFilter, tests]);

  const resultSubjectScores = useMemo(() => {
    if (!resultData?.answers.some((answer) => answer.subject)) return subjectScores;
    const grouped = new Map<string, { score: number; maximum: number }>();
    for (const answer of resultData.answers) {
      const subject = answer.subject ?? "Other";
      const current = grouped.get(subject) ?? { score: 0, maximum: 0 };
      current.score += answer.marks ?? 0;
      current.maximum += 4;
      grouped.set(subject, current);
    }
    return [...grouped.entries()].map(([subject, values]) => ({
      subject,
      ...values,
      color: subject === "Physics" ? "#4263eb" : subject === "Chemistry" ? "#8b5cf6" : "#10b981",
    }));
  }, [resultData]);

  const resultChapterStrength = useMemo(() => {
    if (!resultData?.answers.some((answer) => answer.chapter)) return chapterStrength;
    const grouped = new Map<string, { correct: number; total: number }>();
    for (const answer of resultData.answers) {
      const chapter = answer.chapter ?? "Other";
      const current = grouped.get(chapter) ?? { correct: 0, total: 0 };
      current.correct += answer.isCorrect ? 1 : 0;
      current.total += 1;
      grouped.set(chapter, current);
    }
    return [...grouped.entries()].map(([chapter, values]) => ({
      chapter,
      score: Math.round((values.correct / values.total) * 100),
    }));
  }, [resultData]);

  useEffect(() => {
    if (!activeTest) return;
    const timerId = window.setInterval(() => {
      const secondsRemaining = Math.max(0, Math.ceil((attemptDeadlineRef.current - Date.now()) / 1000));
      setRemainingSeconds(secondsRemaining);
      if (secondsRemaining === 0) {
        window.clearInterval(timerId);
        void submitAttempt();
      }
    }, 1000);
    const autosaveId = window.setInterval(() => {
      void saveAnswer();
    }, 10000);
    return () => {
      window.clearInterval(timerId);
      window.clearInterval(autosaveId);
    };
    // The test session owns these timers; callbacks read the latest selection from state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTest?.id]);

  useEffect(() => {
    if (!activeTest || questionStatesRef.current[activeQuestion.id]) return;
    const nextStatuses = { ...questionStatesRef.current, [activeQuestion.id]: "Not answered" as const };
    questionStatesRef.current = nextStatuses;
    setQuestionStates(nextStatuses);
  }, [activeTest, activeQuestion.id]);

  useEffect(() => {
    if (!modal && !reviewQuestion && !selectedStudent) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModal(null);
        setReviewQuestion(null);
        setSelectedStudent(null);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [modal, reviewQuestion, selectedStudent]);

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3800);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("neet-pro-study-tasks-v1", JSON.stringify(studyTasks));
      localStorage.setItem("neet-pro-study-goal", String(studyGoalMinutes));
      localStorage.setItem("neet-pro-study-activity-v1", JSON.stringify(studyActivityDates));
      localStorage.setItem("neet-pro-offline-pack-v1", JSON.stringify(offlineQuestions));
    } catch (error) {
      console.error("Could not save local study data.", error);
      notify("Your browser could not save study progress. Check available storage and try again.");
    }
  }, [studyTasks, studyGoalMinutes, studyActivityDates, offlineQuestions, notify]);

  useEffect(() => {
    function updateConnection() {
      setIsOnline(navigator.onLine);
    }
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  const studyStreak = useMemo(() => {
    const activeDates = new Set(studyActivityDates);
    const today = new Date();
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!activeDates.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (activeDates.has(dateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [studyActivityDates]);

  const todayStudyMinutes = useMemo(() => {
    const today = dateKey();
    return studyTasks.reduce((total, task) =>
      total + (task.completed && task.completedAt === today ? task.minutes : 0), 0);
  }, [studyTasks]);

  function recordStudyActivity() {
    const today = dateKey();
    setStudyActivityDates((dates) => dates.includes(today) ? dates : [...dates, today].slice(-365));
  }

  function addStudyTask(title: string, subject: string, minutes: number) {
    const cleanTitle = title.trim();
    if (!cleanTitle || !Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
      notify("Enter a study topic and a duration between 5 and 600 minutes.");
      return;
    }
    setStudyTasks((tasks) => [{
      id: crypto.randomUUID(),
      title: cleanTitle,
      subject,
      minutes,
      completed: false,
    }, ...tasks]);
  }

  function toggleStudyTask(taskId: string) {
    const task = studyTasks.find((item) => item.id === taskId);
    if (task && !task.completed) recordStudyActivity();
    setStudyTasks((tasks) => tasks.map((task) => {
      if (task.id !== taskId) return task;
      const completed = !task.completed;
      return {
        ...task,
        completed,
        completedAt: completed ? dateKey() : undefined,
      };
    }));
  }

  function deleteStudyTask(taskId: string) {
    setStudyTasks((tasks) => tasks.filter((task) => task.id !== taskId));
  }

  function cacheOfflineReview(answers: ApiResult["answers"]) {
    const reviewQuestions = answers
      .filter((answer) => answer.correctOptionId && answer.options.length >= 2)
      .map((answer): Question => ({
        id: answer.questionId,
        text: answer.text,
        explanation: answer.explanation ?? "",
        subject: answer.subject ?? "General",
        chapter: answer.chapter ?? "Review",
        difficulty: "Medium",
        status: "Published",
        options: answer.options.map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: option.id === answer.correctOptionId,
        })),
      }));
    if (reviewQuestions.length) {
      setOfflineQuestions((saved) => {
        const byId = new Map(saved.map((question) => [question.id, question]));
        for (const question of reviewQuestions) byId.set(question.id, question);
        return [...byId.values()].slice(-360);
      });
    }
  }

  useEffect(() => {
    if (!token) return;
    const authToken = token;
    let active = true;
    async function loadWorkspace() {
      try {
        const isAdmin = userRole?.toUpperCase() === "ADMIN";
        const [testList, resultList, questionList, studentList] = await Promise.all([
          apiRequest<{ items: ApiTest[] }>("/tests?limit=100", { token }),
          isAdmin
            ? Promise.resolve(null)
            : apiRequest<{ items: { id: string; score: number | null; totalMarks: number; rank: number | null; test: { id: string } }[]; total: number }>("/results?limit=100", { token }),
          isAdmin ? apiRequestAll<ApiQuestion>("/questions?limit=100", authToken) : Promise.resolve(null),
          isAdmin
            ? apiRequest<{ items: { id: string; phone: string; role: string; isBlocked: boolean; createdAt: string; profile?: Record<string, unknown>; attempts?: { totalScore: number | null; test: { totalMarks: number } }[] }[]; total: number }>("/admin/users?role=STUDENT&limit=100", { token })
            : Promise.resolve(null),
        ]);
        if (!active) return;
        const completedIds = new Set((resultList?.items ?? []).map((item) => item.test.id));
        setTests(testList.items.map((test) => mapTest(test, completedIds)));
        if (resultList) setCompletedTestCount(resultList.total);
        if (resultList?.items.length) {
          const mostRecent = resultList.items[0];
          setLatestResultId(mostRecent.id);
          setResultScore(mostRecent.score ?? 0);
          setResultTotalMarks(mostRecent.totalMarks);
          setResultRank(mostRecent.rank);
          void loadLatestResult(mostRecent.id);
        }
        if (resultList) {
          setScoreHistory(resultList.items.slice(0, 6).reverse().map((item, index) => ({
            test: `M${index + 1}`,
            score: item.score ?? 0,
            target: 650,
          })));
        }
        if (questionList) setQuestions(questionList.items.map((question) => mapQuestion(question, true)));
        if (studentList) {
          setTotalStudentCount(studentList.total);
          setAdminStudents(studentList.items.map((user) => {
            const profileName = user.profile?.name ?? user.profile?.displayName;
            return {
              id: user.id,
              name: typeof profileName === "string" ? profileName : user.phone,
              phone: user.phone,
              score: user.attempts?.[0]?.totalScore === null || user.attempts?.[0]?.totalScore === undefined
                ? "—"
                : `${Math.round(user.attempts[0].totalScore)} / ${user.attempts[0].test.totalMarks}`,
              active: !user.isBlocked,
              role: user.role,
              createdAt: user.createdAt,
            };
          }));
        }
      } catch (error) {
        if (active) notify(error instanceof Error ? `Could not load workspace data: ${error.message}` : "Could not load workspace data.");
      }
    }
    void loadWorkspace();
    return () => {
      active = false;
    };
  }, [notify, token, userRole]);

  function navigate(nextPage: Page) {
    setPage(nextPage);
    setMobileNavOpen(false);
    if (nextPage === "results" && token && latestResultId) void loadLatestResult(latestResultId);
  }

  function openTestDialog() {
    setNewTestName("");
    setNewTestChapter("");
    setNewTestType("FULL_MOCK");
    setNewTestQuestionCount("180");
    setNewTestSubject("All subjects");
    setAutoGenerate(true);
    setSelectedQuestionIds([]);
    setModal("test");
  }

  function openQuestionDialog() {
    setNewQuestionText("");
    setQuestionOptions(["", "", "", ""]);
    setCorrectOption("a");
    setQuestionSubject("Physics");
    setQuestionChapter("");
    setQuestionDifficulty("Medium");
    setQuestionExplanation("");
    setQuestionTagsInput("");
    clearQuestionImage();
    setModal("question");
  }

  function clearQuestionImage() {
    if (questionImageUrl.startsWith("blob:")) URL.revokeObjectURL(questionImageUrl);
    setQuestionImageUrl("");
  }

  function showStudent(student: AdminStudent) {
    setSelectedStudent(student);
  }

  async function loadLatestResult(resultId: string) {
    try {
      const { result } = await apiRequest<{ result: ApiResult }>(`/attempts/${resultId}/result`, { token });
      setResultData(result);
      cacheOfflineReview(result.answers);
      setResultScore(result.score ?? 0);
      setResultTotalMarks(result.totalMarks);
      setResultTestName(result.test.name);
      setResultRank(result.rank);
      setCompletedTestCount((count) => count + 1);
      setScoreHistory((history) => [...history, {
        test: `M${history.length + 1}`,
        score: result.score ?? 0,
        target: 650,
      }].slice(-6));
      setResultAccuracy(result.correct + result.incorrect + result.unanswered > 0
        ? Math.round((result.correct / (result.correct + result.incorrect || 1)) * 100)
        : 0);
      const elapsedMs = result.submittedAt ? Date.parse(result.submittedAt) - Date.parse(result.startedAt) : 0;
      const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));
      setResultTimeTaken(`${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`);
      setReviewQuestions(result.answers.map(mapReviewAnswer));
    } catch (error) {
      notify(error instanceof Error ? `Could not load results: ${error.message}` : "Could not load results.");
    }
  }

  async function beginTest(test: TestItem) {
    if (test.status !== "Available") {
      notify(test.status === "Upcoming" ? `This test opens ${test.date}.` : "This test is already completed.");
      return;
    }
    if (!token && test.questions > initialQuestions.length) {
      notify(`Preview mode has ${initialQuestions.length} sample questions. Configure the database and seed the full question bank to start this ${test.questions}-question test.`);
      return;
    }
    attemptDeadlineRef.current = Date.now() + test.duration * 60_000;
    setAnswerSaveStatus(token ? "ready" : "local");
    setActiveTest(test);
    setOfflinePractice(false);
    setPage("tests");
    setQuestionIndex(0);
    setSelectedAnswers({});
    setQuestionStates({});
    setSessionQuestions(initialQuestions);
    questionStartedAtRef.current = Date.now();
    attemptStartedAtRef.current = new Date().toISOString();
    setResultRank(null);
    setRemainingSeconds(test.duration * 60);
    setAttemptId(null);
    answerTimes.current = {};
    if (token) {
      try {
        const started = await apiRequest<{
          attempt: { id: string; startedAt: string; durationMinutes: number; expiresAt: string };
          questions: ApiQuestion[];
          serverTime: string;
        }>("/attempts", {
          method: "POST",
          token,
          body: { testId: test.id },
        });
        attemptStartedAtRef.current = started.attempt.startedAt;
        setAttemptId(started.attempt.id);
        if (started.questions.length) {
          setSessionQuestions(started.questions.map((question) => mapQuestion(question)));
        }
        const secondsRemaining = Math.floor(
          (Date.parse(started.attempt.expiresAt) - Date.parse(started.serverTime)) / 1000,
        );
        if (Number.isFinite(secondsRemaining)) {
          const safeSecondsRemaining = Math.max(0, secondsRemaining);
          attemptDeadlineRef.current = Date.now() + safeSecondsRemaining * 1000;
          setRemainingSeconds(safeSecondsRemaining);
        }
      } catch (error) {
        setActiveTest(null);
        notify(error instanceof Error ? error.message : "Unable to start the test.");
      }
    }
  }

  function beginOfflinePractice() {
    const questionsById = new Map<string, Question>();
    for (const question of [...initialQuestions, ...offlineQuestions]) {
      if (question.options.some((option) => option.isCorrect)) questionsById.set(question.id, question);
    }
    const pack = [...questionsById.values()];
    if (!pack.length) {
      notify("No offline questions are saved yet. Review a completed test while online to prepare a practice pack.");
      return;
    }
    const duration = Math.max(15, pack.length);
    const offlineTest: TestItem = {
      id: "offline-practice",
      name: "Offline review practice",
      category: "Offline practice",
      subject: "Saved questions",
      questions: pack.length,
      duration,
      marks: pack.length * 4,
      status: "Available",
      color: "green",
      icon: "book",
    };
    attemptDeadlineRef.current = Date.now() + duration * 60_000;
    setAnswerSaveStatus("local");
    setActiveTest(offlineTest);
    setOfflinePractice(true);
    setPage("tests");
    setQuestionIndex(0);
    setSelectedAnswers({});
    setQuestionStates({});
    setSessionQuestions(pack);
    setAttemptId(null);
    attemptIdRef.current = null;
    setRemainingSeconds(duration * 60);
    setResultRank(null);
    answerTimes.current = {};
    attemptStartedAtRef.current = new Date().toISOString();
    questionStartedAtRef.current = Date.now();
    notify(`Offline practice ready with ${pack.length} saved questions.`);
  }

  async function saveAnswer() {
    const questions = sessionQuestionsRef.current;
    const question = questions[questionIndexRef.current % questions.length];
    if (!activeTestRef.current || !question) return;
    const now = Date.now();
    answerTimes.current[question.id] =
      (answerTimes.current[question.id] ?? 0) +
      Math.max(0, Math.floor((now - questionStartedAtRef.current) / 1000));
    questionStartedAtRef.current = now;
    if (!attemptIdRef.current || !token) {
      setAnswerSaveStatus("local");
      return;
    }
    const attemptToSave = attemptIdRef.current;
    const selectedOption = selectedAnswersRef.current[question.id] ?? null;
    const timeSpent = answerTimes.current[question.id] ?? 0;
    const isMarkedForReview = questionStatesRef.current[question.id] === "Review";
    setAnswerSaveStatus("saving");
    const save = async () => {
      try {
        await apiRequest(`/attempts/${attemptToSave}/answers/${question.id}`, {
          method: "PUT",
          token,
          body: { selectedOption, timeSpent, isMarkedForReview },
        });
        setAnswerSaveStatus("saved");
      } catch (error) {
        setAnswerSaveStatus("error");
        notify(error instanceof Error ? `Answer not saved: ${error.message}` : "Answer could not be saved.");
      }
    };
    const queuedSave = answerSaveQueueRef.current.then(save, save);
    answerSaveQueueRef.current = queuedSave;
    await queuedSave;
  }

  async function completeAttempt() {
    const currentTest = activeTestRef.current;
    const questions = sessionQuestionsRef.current;
    if (!currentTest) return;
    await saveAnswer();
    await answerSaveQueueRef.current;
    const selections = Object.entries(selectedAnswersRef.current);
    const correctCount = selections.filter(([questionId, optionId]) =>
      questions.find((item) => item.id === questionId)?.options.some(
        (option) => option.id === optionId && option.isCorrect,
      ),
    ).length;
    const incorrectCount = selections.length - correctCount;
    const negativeMarking = currentTest.negativeMarking ?? 1;
    const score = correctCount * 4 - incorrectCount * negativeMarking;
    if (attemptIdRef.current && token) {
      try {
        const submission = await apiRequest<{ result: ApiResult }>(`/attempts/${attemptIdRef.current}/submit`, {
          method: "POST",
          token,
        });
        const result = submission.result;
        cacheOfflineReview(result.answers);
        setResultData(result);
        setLatestResultId(result.id);
        setResultScore(result.score ?? 0);
        setResultTotalMarks(result.totalMarks);
        setResultTestName(result.test.name);
        setResultRank(result.rank);
        setResultAccuracy(result.correct + result.incorrect + result.unanswered > 0
          ? Math.round((result.correct / (result.correct + result.incorrect || 1)) * 100)
          : 0);
        const elapsedMinutes = Math.max(0, Math.floor(
          (Date.parse(result.submittedAt ?? new Date().toISOString()) - Date.parse(result.startedAt)) / 60_000,
        ));
        setResultTimeTaken(`${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`);
        setReviewQuestions(result.answers.map(mapReviewAnswer));
      } catch (error) {
        notify(error instanceof Error ? `Unable to submit: ${error.message}` : "Unable to submit the test.");
        return;
      }
    }
    if (!attemptIdRef.current || !token) {
      const submittedAt = new Date().toISOString();
      const localAnswers = questions.map((question) => {
        const selectedOption = selectedAnswersRef.current[question.id] ?? null;
        const correctOptionId = question.options.find((option) => option.isCorrect)?.id ?? "";
        const isCorrect = selectedOption === correctOptionId;
        return {
          questionId: question.id,
          text: question.text,
          subject: question.subject,
          chapter: question.chapter,
          explanation: question.explanation,
          options: question.options.map(({ id, text }) => ({ id, text })),
          selectedOption,
          correctOptionId,
          isCorrect,
          marks: isCorrect ? 4 : selectedOption ? -negativeMarking : 0,
        };
      });
      setResultData({
        id: "preview-result",
        test: { id: currentTest.id, name: currentTest.name, totalMarks: currentTest.marks },
        score,
        totalMarks: currentTest.marks,
        rank: null,
        correct: localAnswers.filter((answer) => answer.isCorrect).length,
        incorrect: localAnswers.filter((answer) => answer.selectedOption && !answer.isCorrect).length,
        unanswered: localAnswers.filter((answer) => !answer.selectedOption).length,
        startedAt: attemptStartedAtRef.current,
        submittedAt,
        answers: localAnswers,
      });
      cacheOfflineReview(localAnswers);
      setLatestResultId(null);
      setCompletedTestCount((count) => count + 1);
      setResultScore(score);
      setResultTotalMarks(currentTest.marks);
      setResultTestName(currentTest.name);
      setResultAccuracy(selections.length ? Math.round((correctCount / selections.length) * 100) : 0);
      const elapsedMinutes = Math.max(0, Math.floor((currentTest.duration * 60 - remainingSecondsRef.current) / 60));
      setResultTimeTaken(`${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`);
      setReviewQuestions(localAnswers.map(mapReviewAnswer));
    }
    recordStudyActivity();
    setActiveTest(null);
    setOfflinePractice(false);
    setTests((items) => items.map((item) => item.id === currentTest.id ? { ...item, status: "Completed" } : item));
    setPage("results");
    notify("Your test has been submitted.");
  }

  async function submitAttempt() {
    if (submissionInProgressRef.current) return;
    submissionInProgressRef.current = true;
    setIsSubmitting(true);
    try {
      await completeAttempt();
    } finally {
      submissionInProgressRef.current = false;
      setIsSubmitting(false);
    }
  }

  function chooseAnswer(optionId: string) {
    const nextAnswers = { ...selectedAnswersRef.current, [activeQuestion.id]: optionId };
    const nextStatuses: Record<string, QuestionStatus> = {
      ...questionStatesRef.current,
      [activeQuestion.id]: questionStatesRef.current[activeQuestion.id] === "Review" ? "Review" : "Answered",
    };
    selectedAnswersRef.current = nextAnswers;
    questionStatesRef.current = nextStatuses;
    setSelectedAnswers(nextAnswers);
    setQuestionStates(nextStatuses);
    setAnswerSaveStatus(token && attemptIdRef.current ? "saving" : "local");
    window.setTimeout(() => void saveAnswer(), 0);
  }

  function clearAnswer() {
    const nextAnswers = { ...selectedAnswersRef.current };
    delete nextAnswers[activeQuestion.id];
    const nextStatuses = {
      ...questionStatesRef.current,
      [activeQuestion.id]: questionStatesRef.current[activeQuestion.id] === "Review" ? "Review" as const : "Not answered" as const,
    };
    selectedAnswersRef.current = nextAnswers;
    questionStatesRef.current = nextStatuses;
    setSelectedAnswers(nextAnswers);
    setQuestionStates(nextStatuses);
    setAnswerSaveStatus(token && attemptIdRef.current ? "saving" : "local");
    window.setTimeout(() => void saveAnswer(), 0);
  }

  function moveQuestion(offset: number) {
    const nextStatuses = { ...questionStatesRef.current };
    if (!nextStatuses[activeQuestion.id]) nextStatuses[activeQuestion.id] = "Not answered";
    questionStatesRef.current = nextStatuses;
    setQuestionStates(nextStatuses);
    void saveAnswer();
    setQuestionIndex((index) => Math.min(sessionQuestions.length - 1, Math.max(0, index + offset)));
    questionStartedAtRef.current = Date.now();
  }

  function jumpToQuestion(index: number) {
    if (index === questionIndex) return;
    const nextStatuses = { ...questionStatesRef.current };
    if (!nextStatuses[activeQuestion.id]) nextStatuses[activeQuestion.id] = "Not answered";
    questionStatesRef.current = nextStatuses;
    setQuestionStates(nextStatuses);
    void saveAnswer();
    setQuestionIndex(index);
    questionStartedAtRef.current = Date.now();
  }

  function markForReview() {
    const wasMarked = questionStatesRef.current[activeQuestion.id] === "Review";
    const nextStatuses = {
      ...questionStatesRef.current,
      [activeQuestion.id]: wasMarked
        ? selectedAnswersRef.current[activeQuestion.id] ? "Answered" as const : "Not answered" as const
        : "Review" as const,
    };
    questionStatesRef.current = nextStatuses;
    setQuestionStates(nextStatuses);
    if (wasMarked) {
      void saveAnswer();
    } else {
      moveQuestion(1);
    }
  }

  async function requestOtp(event: React.FormEvent) {
    event.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const challenge = await apiRequest<{
        challengeId: string;
        demoOtp?: string;
        demoOnly?: boolean;
        warning?: string;
      }>("/auth/otp/request", { method: "POST", body: { phone: `${callingCode}${phone}` } });
      setOtpChallengeId(challenge.challengeId);
      setOtpHint(challenge.demoOnly && challenge.demoOtp ? `Demo code: ${challenge.demoOtp}` : "");
      setOtpStage("otp");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not send verification code.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const session = await apiRequest<{
        token: string;
        user?: { profile?: { name?: string; displayName?: string }; name?: string; role?: string };
      }>("/auth/otp/verify", {
        method: "POST",
        body: { phone: `${callingCode}${phone}`, code: otp, challengeId: otpChallengeId },
      });
      localStorage.setItem("neet-pro-token", session.token);
      setToken(session.token);
      const assignedRole = (session.user?.role ?? "STUDENT").toUpperCase();
      localStorage.setItem("neet-pro-role", assignedRole);
      setUserRole(assignedRole);
      setRole(assignedRole === "ADMIN" ? "admin" : "student");
      const name = session.user?.profile?.name ?? session.user?.profile?.displayName ?? session.user?.name ?? "Student";
      localStorage.setItem("neet-pro-name", name);
      setDisplayName(name);
      setShowAuth(false);
      setOtpStage("phone");
      notify("You're signed in.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "That code could not be verified.");
    } finally {
      setLoading(false);
    }
  }

  async function createQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (questionOptions.some((option) => !option.trim())) {
      notify("Add text for all four answer options.");
      return;
    }
    const question: Question = {
      ...initialQuestions[0],
      id: `local-${Date.now()}`,
      text: newQuestionText,
      imageUrl: questionImageUrl || undefined,
      explanation: questionExplanation,
      tags: questionTagsInput.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      subject: questionSubject,
      chapter: questionChapter,
      difficulty: questionDifficulty,
      options: questionOptions.map((text, index) => ({
        id: String.fromCharCode(97 + index),
        text,
        isCorrect: String.fromCharCode(97 + index) === correctOption,
      })),
    };
    let savedQuestion = question;
    if (token) {
      try {
        const created = await apiRequest<{ question: ApiQuestion }>("/questions", {
          method: "POST",
          token,
          body: {
            text: question.text,
            imageUrl: question.imageUrl,
            options: question.options.map(({ id, text }) => ({ id: id.toUpperCase(), text })),
            correctOptionId: correctOption.toUpperCase(),
            explanation: question.explanation,
            tags: question.tags,
            difficulty: question.difficulty.toUpperCase(),
            subject: question.subject,
            chapter: question.chapter,
            status: "PUBLISHED",
          },
        });
        savedQuestion = mapQuestion(created.question, true);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not save this question.");
        return;
      }
    }
    setQuestions((items) => [savedQuestion, ...items]);
    setNewQuestionText("");
    setQuestionOptions(["", "", "", ""]);
    setCorrectOption("a");
    setQuestionChapter("");
    setQuestionExplanation("");
    setQuestionTagsInput("");
    clearQuestionImage();
    setModal(null);
    notify("Question added to the bank.");
  }

  async function uploadQuestionImage(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      notify("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify("Question images must be 5 MB or smaller.");
      return;
    }
    setImageUploading(true);
    try {
      if (questionImageUrl.startsWith("blob:")) URL.revokeObjectURL(questionImageUrl);
      if (!token) {
        setQuestionImageUrl(URL.createObjectURL(file));
        notify("Image added for this preview session.");
        return;
      }
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/uploads/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const payload = await response.json() as { imageUrl?: string; error?: { message?: string } };
      if (!response.ok || !payload.imageUrl) {
        throw new Error(payload.error?.message ?? "Could not upload the image.");
      }
      setQuestionImageUrl(payload.imageUrl);
      notify("Question image uploaded.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not upload the image.");
    } finally {
      setImageUploading(false);
    }
  }

  async function createTest(event: React.FormEvent) {
    event.preventDefault();
    if (!autoGenerate && selectedQuestionIds.length === 0) {
      notify("Select at least one question or enable automatic selection.");
      return;
    }
    if (newTestType === "FULL_MOCK" && (
      (autoGenerate && Number(newTestQuestionCount) !== 180) ||
      (!autoGenerate && selectedQuestionIds.length !== 180)
    )) {
      notify("A full mock test must contain exactly 180 questions.");
      return;
    }
    if (newTestType === "SUBJECT" && newTestSubject === "All subjects") {
      notify("Choose a subject for a subject test.");
      return;
    }
    if (newTestType === "PREVIOUS_YEAR") {
      const verifiedQuestions = questions.filter((question) =>
        (question.status ?? "Published") === "Published" &&
        question.tags?.includes("pyq") === true &&
        (question.tags?.some((tag) => /^year:(19|20)\d{2}$/.test(tag)) ?? false),
      );
      if (autoGenerate && verifiedQuestions.length < Number(newTestQuestionCount)) {
        notify(`Previous Year Questions tests need ${Number(newTestQuestionCount)} published questions tagged pyq and year:YYYY. ${verifiedQuestions.length} are available.`);
        return;
      }
      if (!autoGenerate && selectedQuestionIds.some((id) => !verifiedQuestions.some((question) => question.id === id))) {
        notify("Previous Year Questions tests can only include published questions tagged pyq and year:YYYY.");
        return;
      }
    }
    const test: TestItem = {
      id: `custom-${Date.now()}`,
      name: newTestName || "New practice test",
      category: newTestType === "FULL_MOCK" ? "Full mock" : newTestType === "SUBJECT" ? "Subject test" : newTestType === "PREVIOUS_YEAR" ? "Previous Year Questions" : "Chapter test",
      subject: newTestSubject,
      questions: autoGenerate ? Number(newTestQuestionCount) : selectedQuestionIds.length,
      duration: Number(newTestDuration),
      marks: (autoGenerate ? Number(newTestQuestionCount) : selectedQuestionIds.length) * 4,
      status: "Available",
      color: "blue",
      icon: "book",
    };
    let createdTest = test;
    if (token) {
      try {
        const created = await apiRequest<{ test: ApiTest }>("/tests", {
          method: "POST",
          token,
          body: {
            name: test.name,
            type: newTestType,
            durationMinutes: test.duration,
            totalMarks: test.marks,
            negativeMarking: 1,
            ...(autoGenerate ? {} : { questionIds: selectedQuestionIds }),
          },
        });
        createdTest = mapTest(created.test);
        if (autoGenerate) {
          try {
            const generated = await apiRequest<{ generated?: number }>(`/tests/${created.test.id}/generate`, {
              method: "POST",
              token,
              body: {
                questionCount: test.questions,
                subject: newTestSubject === "All subjects" ? undefined : newTestSubject,
                chapter: newTestChapter || undefined,
              },
            });
            createdTest.questions = generated.generated ?? test.questions;
            createdTest.marks = createdTest.questions * 4;
          } catch (error) {
            setTests((items) => [createdTest, ...items]);
            setModal(null);
            notify(error instanceof Error ? `Test created, but question generation failed: ${error.message}` : "Test created, but question generation failed.");
            return;
          }
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not create this test.");
        return;
      }
    }
    setTests((items) => [createdTest, ...items]);
    setNewTestName("");
    setNewTestChapter("");
    setSelectedQuestionIds([]);
    setAutoGenerate(true);
    setModal(null);
    notify("Your test is ready.");
  }

  async function importCsv(file: File | undefined) {
    if (!file) return;
    if (token) {
      try {
        const csv = await file.text();
        const response = await fetch("/api/questions/import", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/csv" },
          body: csv,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
          throw new Error(payload.error?.message ?? "CSV import failed. Check the file format and try again.");
        }
        const imported = await response.json() as { imported?: number };
        const questionList = await apiRequestAll<ApiQuestion>("/questions?limit=100", token);
        setQuestions(questionList.items.map((question) => mapQuestion(question, true)));
        notify(`${imported.imported ?? "CSV"} questions imported.`);
      } catch (error) {
        notify(error instanceof Error ? error.message : "CSV import failed.");
        return;
      }
    } else {
      notify("Preview mode: sign in as an admin to import questions.");
    }
    setModal(null);
  }

  function downloadCsvTemplate() {
    const csv = [
      "text,optionA,optionB,optionC,optionD,correctOptionId,subject,chapter,explanation,difficulty,status,tags",
      '"Sample question?","Option A","Option B","Option C","Option D","A","Physics","Mechanics","Add an explanation","MEDIUM","PUBLISHED","sample|mechanics"',
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "neet-pro-question-template.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function downloadReport() {
    try {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.setFillColor(30, 58, 138);
    pdf.rect(0, 0, 210, 40, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(19);
    pdf.text("NEET Pro", 17, 19);
    pdf.setFontSize(10);
    pdf.text("MOCK TEST PERFORMANCE REPORT", 17, 29);
    pdf.setTextColor(38, 49, 72);
    pdf.setFontSize(14);
    pdf.text("Student performance", 17, 56);
    pdf.setFontSize(11);
    pdf.text(`Student: ${displayName}`, 17, 68);
    pdf.text(`Total score: ${resultScore} / 720`, 17, 78);
    pdf.text("Accuracy: 86%", 17, 88);
    pdf.text("Time taken: 2h 48m", 17, 98);
    pdf.setFontSize(13);
    pdf.text("Subject breakdown", 17, 119);
    pdf.setFontSize(10);
    resultSubjectScores.forEach((subject, index) => {
      pdf.text(`${subject.subject}: ${subject.score} / ${subject.maximum}`, 20, 132 + index * 10);
    });
    pdf.setFontSize(8);
    pdf.setTextColor(120, 130, 148);
    pdf.text("Generated by NEET Pro", 17, 278);
    pdf.save("neet-pro-result-report.pdf");
    } catch (error) {
      notify(error instanceof Error ? `Could not create the PDF: ${error.message}` : "Could not create the PDF report.");
    }
  }

  async function shareScore() {
    const text = `I scored ${resultScore}/720 on my NEET mock test. Keep learning with NEET Pro!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "My NEET Pro score", text });
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          notify("Unable to share your score.");
        }
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify("Score copied to clipboard.");
    } catch {
      notify("Sharing is unavailable in this browser.");
    }
  }

  async function toggleStudent(studentId: string) {
    const student = adminStudents.find((item) => item.id === studentId);
    if (!student) {
      notify("That student is no longer in the list. Refresh the page and try again.");
      return;
    }
    if (token) {
      try {
        await apiRequest(`/admin/users/${student.id}/block`, {
          method: "PATCH",
          token,
          body: { isBlocked: student.active },
        });
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not update student.");
        return;
      }
    }
    setAdminStudents((items) =>
      items.map((item) => (item.id === studentId ? { ...item, active: !item.active } : item)),
    );
  }

  const formattedTime = `${String(Math.floor(remainingSeconds / 3600)).padStart(2, "0")}:${String(
    Math.floor((remainingSeconds % 3600) / 60),
  ).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const answeredCount = sessionQuestions.filter((question) => Boolean(selectedAnswers[question.id])).length;
  const unansweredCount = sessionQuestions.length - answeredCount;
  const reviewCount = sessionQuestions.filter((question) => questionStates[question.id] === "Review").length;

  if (showAuth) {
    return (
      <div className="auth-page">
        <div className="auth-brand"><span className="brand-mark"><GraduationCap size={24} /></span> NEET<span>Pro</span></div>
        <form className="auth-card" onSubmit={otpStage === "phone" ? requestOtp : verifyOtp}>
          <div className="auth-icon"><ShieldCheck size={24} /></div>
          <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
          <h1>{otpStage === "phone" ? "Welcome back" : "Verify your number"}</h1>
          <p className="auth-subtitle">
            {otpStage === "phone"
              ? "Sign in to pick up where you left off."
              : `Enter the one-time code sent to ${phone}.`}
          </p>
          {otpStage === "phone" ? (
            <label className="field-label">Phone number
              <span className="phone-input"><select aria-label="Country calling code" value={callingCode} onChange={(event) => setCallingCode(event.target.value)}><option value="+91">🇮🇳 +91</option><option value="+1">🇺🇸 +1</option><option value="+44">🇬🇧 +44</option><option value="+61">🇦🇺 +61</option></select><input autoFocus required inputMode="tel" minLength={8} maxLength={12} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))} placeholder="98765 43210" /></span>
            </label>
          ) : (
            <label className="field-label">6-digit verification code
              <input autoFocus required className="text-input otp-input" inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="· · · · · ·" />
            </label>
          )}
          {otpHint && <p className="otp-hint">{otpHint} <span>Development only</span></p>}
          {authError && <p className="form-error">{authError}</p>}
          <button className="button button-primary auth-submit" disabled={loading}>
            {loading ? "Please wait…" : otpStage === "phone" ? <>Send verification code <ArrowRight size={17} /></> : <>Verify & continue <ArrowRight size={17} /></>}
          </button>
          {otpStage === "otp" && <button className="text-button back-auth" type="button" onClick={() => setOtpStage("phone")}><ArrowLeft size={14} /> Change phone number</button>}
          <div className="auth-privacy"><LockKeyhole size={13} /> Your data is encrypted and secure</div>
        </form>
        <button className="preview-link" onClick={() => setShowAuth(false)}>Continue in preview mode <ArrowRight size={14} /></button>
      </div>
    );
  }

  return (
    <div className={`app-layout ${role === "admin" ? "admin-layout" : ""}`}>
      {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside id="primary-navigation" className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("home"); }}>
          <span className="brand-mark"><GraduationCap size={22} strokeWidth={2.2} /></span>
          <span>NEET<span className="brand-light">Pro</span><small>{role === "admin" ? "ADMIN CONSOLE" : "YOUR STUDY SPACE"}</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav">
          {availablePages.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-current={page === id ? "page" : undefined} className={`nav-link ${page === id ? "nav-link-active" : ""}`} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {id === "tests" && role === "student" && <span className="nav-count">{tests.filter((test) => test.status === "Available").length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon"><Zap size={15} fill="currentColor" /></span>
            <strong>Small steps, big scores.</strong>
            <span>{studyStreak ? `${studyStreak}-day study streak. Keep it going!` : "Finish a study task to start your streak."}</span>
            <div className="streak-dots">{Array.from({ length: 7 }, (_, index) => <i key={index} className={index < Math.min(studyStreak, 7) ? "streak-active" : ""} />)}</div>
          </div>
          <button className="nav-link" onClick={() => notify("Settings are coming soon.")}><Settings size={18} /><span>Settings</span></button>
          <button className="profile-menu" onClick={() => setShowAuth(true)}>
            <span className="avatar">{displayName.slice(0, 1)}</span>
            <span className="profile-details"><strong>{displayName.includes(" ") ? displayName : `${displayName} Sharma`}</strong><small>{role === "admin" ? "Administrator" : "NEET aspirant"}</small></span>
            <MoreHorizontal size={19} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label={mobileNavOpen ? "Close menu" : "Open menu"} aria-controls="primary-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>{role === "admin" ? "Admin" : "Workspace"}</span><ChevronRight size={14} /><strong>{activeTest ? "Test in progress" : availablePages.find((item) => item.id === page)?.label}</strong></div>
          <div className="topbar-actions">
            {!token && <span className="preview-badge"><span /> Preview mode</span>}
            {!isOnline && <span className="offline-badge"><WifiOff size={13} /> Offline</span>}
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify("You're all caught up.")}><Bell size={18} /><i /></button>
            {(!token || userRole === "ADMIN") && <button className="button button-small button-outline admin-switch" onClick={() => { setRole((current) => current === "student" ? "admin" : "student"); setPage("home"); }}>
              {role === "student" ? <><ShieldCheck size={15} /> Admin view</> : <><GraduationCap size={15} /> Student view</>}
            </button>}
            {token && <button className="icon-button signout-button" aria-label="Sign out" onClick={() => { localStorage.removeItem("neet-pro-token"); localStorage.removeItem("neet-pro-role"); setToken(null); setUserRole(null); setRole("student"); notify("Signed out."); }}><LogOut size={17} /></button>}
          </div>
        </header>

        <div className="page-content">
          {activeTest ? (
            <section className="test-session">
              <div className="exam-bar">
                <button className="button button-small button-quiet" onClick={() => { if (confirm(token ? "Exit this test? The attempt will remain incomplete. Only answers already synced are saved." : "Exit this test? Preview answers are not saved and will be lost.")) { void saveAnswer().then(() => setActiveTest(null)); } }}><ArrowLeft size={15} /> Exit test</button>
                <div className="exam-title"><span className={offlinePractice ? "offline-dot" : "live-dot"} />{activeTest.name}{offlinePractice && <span className="offline-session-label"><WifiOff size={12} /> offline practice</span>}</div>
                <div className={`answer-save-status save-${answerSaveStatus}`} role="status" aria-live="polite">
                  {answerSaveStatus === "saving" ? "Saving answers…" : answerSaveStatus === "saved" ? "Answers saved" : answerSaveStatus === "error" ? "Save failed" : answerSaveStatus === "local" ? offlinePractice ? "Offline · not synced" : "Preview · not saved" : "Starting test…"}
                </div>
                <div className={`exam-timer ${remainingSeconds < 300 ? "timer-warning" : ""}`} aria-label={`Time remaining: ${formattedTime}`}><Timer size={16} /><span>{formattedTime}</span></div>
              </div>
              <div className="exam-progress" role="progressbar" aria-label="Question progress" aria-valuemin={1} aria-valuemax={sessionQuestions.length} aria-valuenow={questionIndex + 1}><span style={{ width: `${((questionIndex + 1) / sessionQuestions.length) * 100}%` }} /></div>
              <div className="exam-body">
                <section className="question-panel">
                  <div className="question-heading">
                    <span className="question-number">QUESTION {String(questionIndex + 1).padStart(2, "0")} <i>OF {String(sessionQuestions.length).padStart(2, "0")}</i></span>
                    <span className={`difficulty difficulty-${activeQuestion.difficulty.toLowerCase()}`}>{activeQuestion.difficulty}</span>
                  </div>
                  <div className="question-meta"><span>{activeQuestion.subject}</span><span className="meta-dot" />{activeQuestion.chapter}<span className="marking-hint">+4 correct · −{activeTest.negativeMarking ?? 1} incorrect</span></div>
                  <h1 className="question-text">{activeQuestion.text}</h1>
                  {activeQuestion.imageUrl && <img className="question-image" src={activeQuestion.imageUrl} alt="Question illustration" />}
                  <div className="options-list">
                    {activeQuestion.options.map((option, index) => {
                      const chosen = selectedAnswers[activeQuestion.id] === option.id;
                      return <button key={option.id} type="button" aria-pressed={chosen} className={`answer-option ${chosen ? "answer-selected" : ""}`} onClick={() => chooseAnswer(option.id)}>
                        <span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option.text}</span>{chosen && <Check size={17} className="option-check" />}
                      </button>;
                    })}
                  </div>
                  <div className="question-actions">
                    <div className="question-review-actions">
                      <button className="button button-small button-quiet" aria-pressed={questionStates[activeQuestion.id] === "Review"} onClick={markForReview}><Bookmark size={15} /> {questionStates[activeQuestion.id] === "Review" ? "Remove review" : "Mark for review"}</button>
                      {selectedAnswers[activeQuestion.id] && <button className="button button-small button-quiet clear-answer-button" onClick={clearAnswer}>Clear answer</button>}
                    </div>
                    <div className="question-nav-buttons">
                      <button className="button button-small button-outline" disabled={questionIndex === 0} onClick={() => moveQuestion(-1)}><ChevronLeft size={16} /> Previous</button>
                      <button className="button button-small button-primary" onClick={() => moveQuestion(1)}>Save & next <ChevronRight size={16} /></button>
                    </div>
                  </div>
                </section>
                <aside className="question-palette">
                  <div className="palette-title"><h3>Question palette</h3><span>{questionIndex + 1}/{sessionQuestions.length}</span></div>
                  <div className="palette-legend">
                    <span><i className="legend-answered" /> Answered</span><span><i className="legend-unanswered" /> Not answered</span><span><i className="legend-review" /> Review</span><span><i className="legend-not-visited" /> Not visited</span>
                  </div>
                  <div className="palette-grid">
                    {Array.from({ length: sessionQuestions.length }, (_, index) => {
                      const qid = sessionQuestions[index].id;
                      const state = questionStates[qid] ?? (selectedAnswers[qid] ? "Answered" : index < questionIndex ? "Not answered" : "Not visited");
                      return <button key={index} type="button" aria-label={`Question ${index + 1}, ${state}${questionIndex === index ? ", current" : ""}`} aria-current={questionIndex === index ? "step" : undefined} className={`palette-number palette-${state.toLowerCase().replace(" ", "-")} ${questionIndex === index ? "palette-current" : ""}`} onClick={() => jumpToQuestion(index)}>{index + 1}</button>;
                    })}
                  </div>
                  <div className="palette-summary">
                    <span><CheckCircle2 size={15} /> {answeredCount} answered</span>
                    <span><Clock3 size={15} /> {unansweredCount} unanswered</span>
                    <span><Bookmark size={15} /> {reviewCount} marked for review</span>
                  </div>
                  <button className="button button-primary submit-button" disabled={isSubmitting} onClick={() => { const warning = unansweredCount ? ` You still have ${unansweredCount} unanswered ${unansweredCount === 1 ? "question" : "questions"}.` : ""; if (confirm(`Submit your test now?${warning}`)) void submitAttempt(); }}>{isSubmitting ? "Submitting…" : "Submit test"} {!isSubmitting && <ArrowRight size={16} />}</button>
                </aside>
              </div>
            </section>
          ) : role === "student" ? (
            <>
              {page === "home" && <StudentHome name={displayName} tests={tests} lastScore={resultScore} totalMarks={resultTotalMarks} accuracy={resultAccuracy} completedCount={completedTestCount} scoreHistory={scoreHistory} studyStreak={studyStreak} todayStudyMinutes={todayStudyMinutes} studyGoalMinutes={studyGoalMinutes} offlineQuestionCount={new Set([...initialQuestions, ...offlineQuestions].map((question) => question.id)).size} onStart={beginTest} onStartOffline={beginOfflinePractice} onNavigate={navigate} onShowAuth={() => setShowAuth(true)} />}
              {page === "tests" && <StudentTests tests={visibleTests} search={search} setSearch={setSearch} subjectFilter={subjectFilter} setSubjectFilter={setSubjectFilter} onStart={beginTest} />}
              {page === "results" && <Results name={displayName.split(" ")[0]} testName={resultTestName} score={resultScore} maximum={resultTotalMarks} accuracy={resultAccuracy} timeTaken={resultTimeTaken} rank={resultRank} subjectScores={resultSubjectScores} chapterStrength={resultChapterStrength} questions={reviewQuestions} onDownload={downloadReport} onShare={() => void shareScore()} onReview={setReviewQuestion} />}
              {page === "planner" && <StudyPlanner tasks={studyTasks} goalMinutes={studyGoalMinutes} todayMinutes={todayStudyMinutes} streak={studyStreak} onAddTask={addStudyTask} onToggleTask={toggleStudyTask} onDeleteTask={deleteStudyTask} onGoalChange={setStudyGoalMinutes} />}
            </>
          ) : (
            <>
              {page === "home" && <AdminHome tests={tests} questions={questions} students={totalStudentCount} onNavigate={navigate} />}
              {page === "questions" && <QuestionBank questions={questions} search={search} setSearch={setSearch} onAdd={openQuestionDialog} onImport={() => setModal("import")} />}
              {page === "builder" && <TestBuilder tests={tests} onCreate={openTestDialog} />}
              {page === "students" && <Students students={adminStudents} total={totalStudentCount} onToggle={toggleStudent} onView={showStudent} />}
            </>
          )}
        </div>
      </main>

      {notice && <div className="toast"><CheckCircle2 size={17} /><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice("")}><X size={15} /></button></div>}
      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-heading" onSubmit={modal === "question" ? createQuestion : modal === "test" ? createTest : (event) => { event.preventDefault(); }}>
          <div className="modal-head"><div><p className="eyebrow">ADMIN WORKSPACE</p><h2 id="modal-heading">{modal === "question" ? "Add a question" : modal === "test" ? "Create a test" : "Import questions"}</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)}><X size={19} /></button></div>
          {modal === "question" && <>
            <label className="field-label">Question text<textarea className="text-input textarea" required value={newQuestionText} onChange={(event) => setNewQuestionText(event.target.value)} placeholder="Write the question here…" /></label>
            <div className="form-grid">
              <label className="field-label">Subject<select className="text-input" value={questionSubject} onChange={(event) => setQuestionSubject(event.target.value)}><option>Physics</option><option>Chemistry</option><option>Biology</option></select></label>
              <label className="field-label">Difficulty<select className="text-input" value={questionDifficulty} onChange={(event) => setQuestionDifficulty(event.target.value as Question["difficulty"])}><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
            </div>
            <label className="field-label">Chapter<input className="text-input" required value={questionChapter} onChange={(event) => setQuestionChapter(event.target.value)} placeholder="e.g. Motion in a Straight Line" /></label>
            <label className="field-label">Question tags (optional)<input className="text-input" value={questionTagsInput} onChange={(event) => setQuestionTagsInput(event.target.value)} placeholder="e.g. pyq, year:2024" /><span className="field-help">For verified past questions, add both <strong>pyq</strong> and <strong>year:YYYY</strong>.</span></label>
            <div className="field-label">Question image (optional)
              <label className="image-upload-control"><span className="image-upload-icon"><Upload size={15} /></span><span>{imageUploading ? "Uploading image…" : "Upload JPEG, PNG, or WebP"}</span><small>Max 5 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" disabled={imageUploading} onChange={(event) => { void uploadQuestionImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
              <label className="field-label image-url-field">Or paste an image URL<input className="text-input" type="url" value={questionImageUrl.startsWith("blob:") ? "" : questionImageUrl} onChange={(event) => { if (questionImageUrl.startsWith("blob:")) URL.revokeObjectURL(questionImageUrl); setQuestionImageUrl(event.target.value); }} placeholder="https://…" /></label>
              {questionImageUrl && <div className="image-preview-row"><img src={questionImageUrl} alt="Question preview" /><span>Image attached</span><button type="button" className="text-button" onClick={clearQuestionImage}>Remove</button></div>}
            </div>
            <fieldset className="answer-fieldset"><legend>Answer options <span>Choose the correct answer</span></legend>
              <div className="option-inputs">{questionOptions.map((option, index) => {
                const id = String.fromCharCode(97 + index);
                return <label className={`option-editor ${correctOption === id ? "option-editor-correct" : ""}`} key={id}><input type="radio" name="correct-option" value={id} checked={correctOption === id} onChange={() => setCorrectOption(id)} aria-label={`Set option ${id.toUpperCase()} as correct`} /><span>{id.toUpperCase()}</span><input className="text-input" required value={option} onChange={(event) => setQuestionOptions((items) => items.map((item, current) => current === index ? event.target.value : item))} placeholder={`Option ${id.toUpperCase()}`} /></label>;
              })}</div>
            </fieldset>
            <label className="field-label">Explanation (optional)<textarea className="text-input textarea" value={questionExplanation} onChange={(event) => setQuestionExplanation(event.target.value)} placeholder="Explain why the correct answer is right…" /></label>
          </>}
          {modal === "test" && <>
            <label className="field-label">Test name<input className="text-input" required value={newTestName} onChange={(event) => setNewTestName(event.target.value)} placeholder="e.g. Full Mock Test 02" /></label>
            <div className="form-grid">
              <label className="field-label">Test type<select className="text-input" value={newTestType} onChange={(event) => { const type = event.target.value; setNewTestType(type); setNewTestQuestionCount(type === "FULL_MOCK" ? "180" : "45"); if (type === "PREVIOUS_YEAR") setNewTestDuration("45"); if (type === "FULL_MOCK") { setNewTestSubject("All subjects"); setAutoGenerate(true); setSelectedQuestionIds([]); } }}><option value="FULL_MOCK">Full mock</option><option value="SUBJECT">Subject test</option><option value="CHAPTER">Chapter test</option><option value="PREVIOUS_YEAR">Previous Year Questions</option></select></label>
              <label className="field-label">Subject<select className="text-input" value={newTestSubject} disabled={newTestType === "FULL_MOCK"} onChange={(event) => setNewTestSubject(event.target.value)}><option>All subjects</option><option>Physics</option><option>Chemistry</option><option>Biology</option></select></label>
            </div>
            {newTestType === "CHAPTER" && <label className="field-label">Chapter<input className="text-input" required value={newTestChapter} onChange={(event) => setNewTestChapter(event.target.value)} placeholder="Select chapter" /></label>}
            <div className="form-grid">
              <label className="field-label">Duration<select className="text-input" value={newTestDuration} onChange={(event) => setNewTestDuration(event.target.value)}><option value="180">180 minutes</option><option value="90">90 minutes</option><option value="45">45 minutes</option><option value="30">30 minutes</option></select></label>
              <label className="field-label">Question count<select className="text-input" value={newTestQuestionCount} disabled={newTestType === "FULL_MOCK"} onChange={(event) => setNewTestQuestionCount(event.target.value)}>{newTestType === "FULL_MOCK" ? <option value="180">180 questions</option> : <><option value="90">90 questions</option><option value="45">45 questions</option><option value="30">30 questions</option><option value="25">25 questions</option></>}</select></label>
            </div>
            {newTestType === "PREVIOUS_YEAR" && <p className="builder-capacity-note"><CircleHelp size={13} /> This category only uses questions tagged <strong>pyq</strong> and <strong>year:YYYY</strong>. Import verified past-paper content before creating a test.</p>}
            <label className="auto-generate"><Sparkles size={17} /><span><strong>Auto-generate with smart selection</strong><small>{newTestType === "FULL_MOCK" ? "Full mocks use the balanced 45 Physics / 45 Chemistry / 90 Biology split" : newTestType === "PREVIOUS_YEAR" ? "Selects only published, year-tagged PYQ questions" : "Pick published questions matching the chosen subjects"}</small></span><input type="checkbox" checked={autoGenerate} disabled={newTestType === "FULL_MOCK"} onChange={(event) => setAutoGenerate(event.target.checked)} /></label>
            <p className="builder-capacity-note"><CircleHelp size={13} /> Full mocks need 180 published questions across all subjects. {questions.filter((question) => (question.status ?? "Published") === "Published").length} questions are currently loaded.</p>
            {!autoGenerate && <div className="manual-question-list"><strong>Select questions ({selectedQuestionIds.length} selected)</strong>{questions.filter((question) => (question.status ?? "Published") === "Published").map((question) => <label key={question.id}><input type="checkbox" checked={selectedQuestionIds.includes(question.id)} onChange={(event) => setSelectedQuestionIds((ids) => event.target.checked ? [...ids, question.id] : ids.filter((id) => id !== question.id))} /><span><b>{question.subject}</b> · {question.chapter}<small>{question.text}</small></span></label>)}</div>}
          </>}
          {modal === "import" && <><label className="upload-zone"><Upload size={23} /><strong>Choose a CSV file to upload</strong><span>Question, options, correct answer, subject & chapter</span><input type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event.target.files?.[0])} /></label><button type="button" className="text-button csv-template-link" onClick={downloadCsvTemplate}><Download size={14} /> Download CSV template</button></>}
          <div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModal(null)}>Cancel</button>{modal !== "import" && <button className="button button-primary" disabled={imageUploading}>{modal === "question" ? <><Plus size={16} /> Add question</> : <><Sparkles size={16} /> Create test</>}</button>}</div>
        </form>
      </div>}
      {reviewQuestion && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewQuestion(null); }}><section className="modal-card explanation-card" role="dialog" aria-modal="true" aria-labelledby="explanation-heading"><div className="modal-head"><div><p className="eyebrow">{reviewQuestion.subject} · {reviewQuestion.chapter}</p><h2 id="explanation-heading">Question explanation</h2></div><button className="icon-button" aria-label="Close explanation" onClick={() => setReviewQuestion(null)}><X size={19} /></button></div><p className="explanation-question">{reviewQuestion.text}</p><div className={`your-answer your-answer-${reviewQuestion.reviewStatus.toLowerCase()}`}><strong>{reviewQuestion.reviewStatus}</strong><span>Your answer: {reviewQuestion.options.find((item) => item.id === reviewQuestion.selectedOptionId)?.text ?? "Not answered"}</span></div><div className="correct-answer"><CheckCircle2 size={17} /><span>Correct answer: {reviewQuestion.options.find((item) => item.isCorrect)?.text ?? "Not available"}</span></div><p className="explanation-copy">{reviewQuestion.explanation || "No explanation has been added for this question yet."}</p><button className="button button-primary explanation-done" onClick={() => setReviewQuestion(null)}>Got it</button></section></div>}
      {selectedStudent && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedStudent(null); }}><section className="modal-card student-details" role="dialog" aria-modal="true" aria-labelledby="student-details-title"><div className="modal-head"><div><p className="eyebrow">STUDENT PROFILE</p><h2 id="student-details-title">{selectedStudent.name}</h2></div><button className="icon-button" aria-label="Close details" onClick={() => setSelectedStudent(null)}><X size={19} /></button></div><div className="student-detail-list"><span>Phone number<strong>{selectedStudent.phone}</strong></span><span>Account role<strong>{selectedStudent.role}</strong></span><span>Account status<strong>{selectedStudent.active ? "Active" : "Blocked"}</strong></span><span>Joined<strong>{selectedStudent.createdAt === "Demo account" ? selectedStudent.createdAt : new Date(selectedStudent.createdAt).toLocaleDateString()}</strong></span><span>Last mock score<strong>      {selectedStudent.score === "—" ? "No score yet" : selectedStudent.score}</strong></span></div><button className="button button-primary explanation-done" onClick={() => setSelectedStudent(null)}>Close</button></section></div>}
    </div>
  );
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

type SubjectScore = { subject: string; score: number; maximum: number; color: string };
type ChapterScore = { chapter: string; score: number };

function StudentHome({ name, tests, lastScore, totalMarks, accuracy, completedCount, scoreHistory, studyStreak, todayStudyMinutes, studyGoalMinutes, offlineQuestionCount, onStart, onStartOffline, onNavigate, onShowAuth }: { name: string; tests: TestItem[]; lastScore: number; totalMarks: number; accuracy: number; completedCount: number; scoreHistory: ScorePoint[]; studyStreak: number; todayStudyMinutes: number; studyGoalMinutes: number; offlineQuestionCount: number; onStart: (test: TestItem) => void; onStartOffline: () => void; onNavigate: (page: Page) => void; onShowAuth: () => void }) {
  const firstName = name.split(" ")[0] || "Student";
  return <div className="student-page">
    <section className="hero-banner">
      <div className="hero-copy"><span className="hero-greeting">{new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()} <span className="hero-live"><i /> EXAM SEASON</span></span><h1>One step closer,<br /><span>{firstName}.</span></h1><p>Consistency is your superpower. Let's make today count.</p><div className="hero-actions"><button className="button button-white" onClick={() => onStart(tests.find((test) => test.status === "Available") ?? tests[0])}><Play size={16} fill="currentColor" /> Start a mock test <ArrowRight size={16} /></button><button className="hero-link" onClick={() => onNavigate("planner")}>View study plan <ArrowRight size={15} /></button></div></div>
      <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><GraduationCap size={45} /></div><div className="orbit-chip chip-top"><Target size={15} /> Goal: 650+</div><div className="orbit-chip chip-bottom"><Zap size={15} fill="currentColor" /> {studyStreak} day streak</div></div>
      <div className="hero-decor hero-decor-one" /><div className="hero-decor hero-decor-two" />
    </section>
    <div className="section-title-row"><div><p className="eyebrow">YOUR MOMENTUM</p><h2>A little progress, every day.</h2></div><button className="text-button" onClick={() => onNavigate("results")}>View analytics <ArrowRight size={15} /></button></div>
    <section className="stats-grid">
      <article className="stat-card"><span className="stat-icon stat-blue"><Trophy size={18} /></span><span className="stat-label">Last mock score</span><strong className="stat-value">{lastScore}<span>/ {totalMarks}</span></strong><span className="stat-trend"><ArrowDown size={13} /> Top 8% this week</span></article>
      <article className="stat-card"><span className="stat-icon stat-orange"><Zap size={18} /></span><span className="stat-label">Study streak</span><strong className="stat-value">{studyStreak} <span>days</span></strong><span className="streak-mini">{Array.from({ length: 7 }, (_, index) => <i key={index} className={index < Math.min(studyStreak, 7) ? "streak-active" : ""} />)}</span></article>
      <article className="stat-card"><span className="stat-icon stat-green"><CheckCircle2 size={18} /></span><span className="stat-label">Tests completed</span><strong className="stat-value">{completedCount} <span>tests</span></strong><span className="stat-note">You're building a great habit</span></article>
      <article className="stat-card"><span className="stat-icon stat-purple"><Target size={18} /></span><span className="stat-label">Accuracy</span><strong className="stat-value">{accuracy}<span>%</span></strong><span className="stat-trend trend-up">Based on your latest result</span></article>
    </section>
    <PlannerOverview todayMinutes={todayStudyMinutes} goalMinutes={studyGoalMinutes} onOpen={() => onNavigate("planner")} />
    <div className="dashboard-columns">
      <section className="panel tests-panel">
        <div className="panel-heading"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Ready when you are</h2></div><button className="text-button" onClick={() => onNavigate("tests")}>All tests <ArrowRight size={14} /></button></div>
        <div className="mini-test-list">{tests.slice(0, 3).map((test) => <TestCard key={test.id} test={test} onStart={onStart} compact />)}</div>
      </section>
      <section className="panel chart-panel"><div className="panel-heading"><div><p className="eyebrow">LAST 6 MOCKS</p><h2>Your score trend</h2></div><span className="chart-target-label">Goal: 650</span></div><div className="score-chart-legend"><span><i /> Your score</span><span><i /> Target score</span></div><div className="score-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={scoreHistory} margin={{ top: 8, right: 2, left: -24, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef1f6" strokeDasharray="3 4" /><XAxis dataKey="test" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#98a2b3" }} /><YAxis domain={[0, 720]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#98a2b3" }} /><Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "#f5f7fb" }} /><Bar dataKey="target" fill="#e9edf5" radius={[4, 4, 0, 0]} barSize={13} /><Bar dataKey="score" fill="#4263eb" radius={[4, 4, 0, 0]} barSize={13} /></BarChart></ResponsiveContainer></div></section>
    </div>
    <div className="bottom-strip"><div className="bottom-strip-icon"><Sparkles size={19} /></div><div><strong>Make your next hour count.</strong><span>A quick 30-minute practice test can sharpen your focus today.</span></div><div className="bottom-strip-actions"><button className="button button-small button-outline" onClick={onStartOffline}><WifiOff size={14} /> Offline practice <span>{offlineQuestionCount}</span></button><button className="button button-small button-outline" onClick={() => onNavigate("tests")}>Find a quick test <ArrowRight size={14} /></button></div></div>
    {!localStorage.getItem("neet-pro-token") && <button className="demo-caption" onClick={onShowAuth}>You're exploring a preview. <strong>Sign in</strong> to sync your progress. <ArrowRight size={13} /></button>}
  </div>;
}

function PlannerOverview({ todayMinutes, goalMinutes, onOpen }: { todayMinutes: number; goalMinutes: number; onOpen: () => void }) {
  const progress = Math.min(100, Math.round((todayMinutes / goalMinutes) * 100));
  return <button className="planner-overview panel" onClick={onOpen}>
    <span className="planner-overview-icon"><CalendarDays size={18} /></span>
    <span className="planner-overview-copy"><strong>Today's study plan</strong><small>{todayMinutes} of {goalMinutes} minutes completed</small></span>
    <span className="planner-overview-track"><i style={{ width: `${progress}%` }} /></span>
    <strong className="planner-overview-progress">{progress}%</strong>
    <ArrowRight size={16} />
  </button>;
}

function StudyPlanner({ tasks, goalMinutes, todayMinutes, streak, onAddTask, onToggleTask, onDeleteTask, onGoalChange }: {
  tasks: PlannerTask[];
  goalMinutes: number;
  todayMinutes: number;
  streak: number;
  onAddTask: (title: string, subject: string, minutes: number) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onGoalChange: (minutes: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("Biology");
  const [minutes, setMinutes] = useState(30);
  const progress = Math.min(100, Math.round((todayMinutes / goalMinutes) * 100));

  function submitTask(event: React.FormEvent) {
    event.preventDefault();
    onAddTask(title, subject, minutes);
    setTitle("");
  }

  return <div className="planner-page">
    <PageTitle eyebrow="DAILY STUDY PLAN" title="Make time for what matters." description="Set a realistic goal, plan focused sessions, and track your consistency." action={<label className="planner-goal-select"><Target size={15} /> Daily goal <select value={goalMinutes} onChange={(event) => onGoalChange(Number(event.target.value))}><option value={30}>30 min</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option><option value={180}>3 hours</option><option value={240}>4 hours</option></select></label>} />
    <section className="planner-summary panel">
      <div className="planner-summary-heading"><span className="planner-summary-icon"><Target size={20} /></span><div><p className="eyebrow">TODAY'S FOCUS</p><h2>{todayMinutes >= goalMinutes ? "Daily goal complete. Great work!" : `${Math.max(0, goalMinutes - todayMinutes)} minutes to your daily goal`}</h2></div></div>
      <div className="planner-progress-track"><span style={{ width: `${progress}%` }} /></div>
      <div className="planner-summary-foot"><span>{todayMinutes} / {goalMinutes} minutes studied</span><strong>{progress}%</strong><span className="planner-streak"><Zap size={14} /> {streak} day streak</span></div>
    </section>
    <div className="planner-columns">
      <section className="panel planner-add-panel">
        <div className="panel-heading"><div><p className="eyebrow">PLAN A SESSION</p><h2>Add a study task</h2></div><CalendarDays size={18} /></div>
        <form className="planner-form" onSubmit={submitTask}>
          <label className="field-label">Topic or task<input className="text-input" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Revise human digestion" /></label>
          <div className="form-grid">
            <label className="field-label">Subject<select className="text-input" value={subject} onChange={(event) => setSubject(event.target.value)}><option>Physics</option><option>Chemistry</option><option>Biology</option><option>Revision</option></select></label>
            <label className="field-label">Duration<select className="text-input" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option></select></label>
          </div>
          <button className="button button-primary"><Plus size={15} /> Add to plan</button>
        </form>
      </section>
      <section className="panel planner-tasks-panel">
        <div className="panel-heading"><div><p className="eyebrow">{new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</p><h2>Study sessions</h2></div><span className="planner-task-count">{tasks.filter((task) => task.completed).length}/{tasks.length} done</span></div>
        {tasks.length ? <div className="planner-task-list">{tasks.map((task) => <article className={`planner-task ${task.completed ? "planner-task-done" : ""}`} key={task.id}>
          <button className="planner-task-check" aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`} aria-pressed={task.completed} onClick={() => onToggleTask(task.id)}>{task.completed && <Check size={14} />}</button>
          <div className="planner-task-copy"><strong>{task.title}</strong><span>{task.subject} · {task.minutes} min{task.completedAt === dateKey() ? " · Completed today" : ""}</span></div>
          <button className="icon-button planner-delete" aria-label={`Delete ${task.title}`} onClick={() => onDeleteTask(task.id)}><Trash2 size={15} /></button>
        </article>)}</div> : <div className="planner-empty"><BookOpen size={22} /><strong>Your plan is ready for a first task</strong><span>Add a focused session to get started.</span></div>}
      </section>
    </div>
    <p className="planner-storage-note"><Wifi size={14} /> Your plan and progress are saved on this device and work offline.</p>
  </div>;
}

function TestCard({ test, onStart, compact = false }: { test: TestItem; onStart: (test: TestItem) => void; compact?: boolean }) {
  return <article className={`test-card ${compact ? "test-card-compact" : ""}`}>
    <div className={`test-icon test-icon-${test.color}`}><TestGlyph icon={test.icon} /></div>
    <div className="test-info"><div className="test-card-top"><span className="test-category">{test.category}</span><span className={`status-pill status-${test.status.toLowerCase()}`}><i />{test.status}</span></div><h3>{test.name}</h3><p className="test-subject">{test.subject}</p><div className="test-details"><span><FileQuestion size={14} /> {test.questions} questions</span><span><Clock3 size={14} /> {test.duration} min</span><span><Award size={14} /> {test.marks} marks</span></div>{test.progress !== undefined && <div className="test-progress"><span style={{ width: `${test.progress}%` }} /></div>}</div>
    <div className="test-card-end">{test.status === "Upcoming" ? <span className="upcoming-date"><CalendarDays size={14} />{test.date}</span> : test.status === "Completed" ? <span className="completed-score">{test.progress}% <small>score</small></span> : <button className={`button button-small ${compact ? "button-icon-only" : ""} button-primary`} aria-label={`Start ${test.name}`} onClick={() => onStart(test)}>{compact ? <Play size={15} fill="currentColor" /> : <>Start test <ArrowRight size={15} /></>}</button>}</div>
  </article>;
}

function StudentTests({ tests, search, setSearch, subjectFilter, setSubjectFilter, onStart }: { tests: TestItem[]; search: string; setSearch: (value: string) => void; subjectFilter: string; setSubjectFilter: (value: string) => void; onStart: (test: TestItem) => void }) {
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const visibleTests = tests.filter((test) => {
    if (categoryFilter === "All categories") return true;
    if (categoryFilter === "Full mock") return test.category === "Full mock" || test.category === "Full syllabus";
    return test.category === categoryFilter;
  });
  return <><PageTitle eyebrow="TEST LIBRARY" title="Practice with purpose." description="Build exam-day confidence, one well-prepared test at a time." action={<span className="library-count"><FileQuestion size={16} /> {tests.length} tests available</span>} />
    <section className="panel library-panel"><div className="library-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Search tests or chapters…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label><label className="filter-select"><Filter size={15} /><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All categories</option><option>Full mock</option><option>Subject test</option><option>Chapter test</option><option>Previous Year Questions</option></select><ChevronDown size={14} /></label><label className="filter-select"><Filter size={15} /><select aria-label="Filter by subject" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option>All subjects</option><option>Physics</option><option>Chemistry</option><option>Biology</option></select><ChevronDown size={14} /></label></div><div className="test-list">{visibleTests.map((test) => <TestCard key={test.id} test={test} onStart={onStart} />)}{visibleTests.length === 0 && <div className="empty-state"><Search size={24} /><strong>{categoryFilter === "Previous Year Questions" ? "No verified PYQ tests yet" : "No tests found"}</strong><span>{categoryFilter === "Previous Year Questions" ? "Previous-year tests appear here after an admin adds questions tagged pyq and year:YYYY." : "Try a different search, category, or subject."}</span></div>}</div></section>
    <div className="library-note"><CircleHelp size={16} /><span>Every test follows NEET marking: <strong>+4 correct, −1 incorrect.</strong> Preview questions are illustrative, not verified past-paper questions; database PYQ tests use curated, year-tagged questions.</span></div>
  </>;
}

function Results({ name, testName, score, maximum, accuracy, timeTaken, rank, subjectScores, chapterStrength, questions, onDownload, onShare, onReview }: { name: string; testName: string; score: number; maximum: number; accuracy: number; timeTaken: string; rank: number | null; subjectScores: SubjectScore[]; chapterStrength: ChapterScore[]; questions: ReviewedQuestion[]; onDownload: () => void; onShare: () => void; onReview: (question: ReviewedQuestion) => void }) {
  const [reviewFilter, setReviewFilter] = useState<"All" | ReviewStatus>("All");
  const weakestChapter = [...chapterStrength].sort((a, b) => a.score - b.score)[0];
  const visibleQuestions = reviewFilter === "All"
    ? questions
    : questions.filter((question) => question.reviewStatus === reviewFilter);
  const missedCount = questions.filter((question) => question.reviewStatus !== "Correct").length;
  const reviewFilters: ("All" | ReviewStatus)[] = ["All", "Incorrect", "Correct", "Unanswered"];
  return <div className="results-page"><PageTitle eyebrow="YOUR PERFORMANCE" title="The work is paying off." description="A clear picture of where you shine—and where to focus next." action={<div className="result-actions"><button className="button button-outline" onClick={onShare}><Share2 size={15} /> Share score</button><button className="button button-outline" onClick={onDownload}><Download size={15} /> Download PDF report</button></div>} />
    <section className="result-hero panel"><div className="result-score-circle"><div><strong>{score}</strong><span>OUT OF {maximum}</span></div></div><div className="result-summary"><span className="status-pill status-completed"><i /> TEST COMPLETED</span><h2>Strong work, {name}.</h2><p>{score >= 650 ? "You've reached your 650-point target. Keep your momentum going." : `You're ${Math.max(0, 650 - score)} points closer to your 650-point target.`}</p><div className="result-metrics"><span><Target size={16} /><strong>{accuracy}%</strong> accuracy</span><span><Clock3 size={16} /><strong>{timeTaken}</strong> time taken</span><span><Trophy size={16} /><strong>{rank ? `Rank #${rank}` : testName}</strong></span></div></div><div className="result-stamp"><span>NEET</span><Award size={29} /><strong>TEST REPORT</strong><small>NEET PRO</small></div></section>
    <div className="results-grid"><section className="panel subject-panel"><div className="panel-heading"><div><p className="eyebrow">SUBJECT BREAKDOWN</p><h2>Where you stand</h2></div><button className="icon-button" aria-label="More options"><MoreHorizontal size={19} /></button></div><div className="subject-bars">{subjectScores.map((item) => <div className="subject-row" key={item.subject}><div className="subject-row-title"><span><i style={{ background: item.color }} />{item.subject}</span><strong>{item.score}<small> / {item.maximum}</small></strong></div><div className="subject-track"><span style={{ width: `${item.maximum ? Math.max(0, Math.min(100, item.score / item.maximum * 100)) : 0}%`, background: item.color }} /></div><div className="subject-foot"><span>{item.maximum ? Math.round(item.score / item.maximum * 100) : 0}% score</span><span>{Math.max(0, item.maximum - item.score)} marks to full</span></div></div>)}</div></section>
      <section className="panel radar-panel"><div className="panel-heading"><div><p className="eyebrow">CHAPTER MASTERY</p><h2>Strengths & focus areas</h2></div></div><div className="radar-chart"><ResponsiveContainer width="100%" height="100%"><RadarChart data={chapterStrength} outerRadius="70%"><PolarGrid stroke="#e9edf4" /><PolarAngleAxis dataKey="chapter" tick={{ fontSize: 10, fill: "#74809a" }} /><Radar dataKey="score" stroke="#4263eb" fill="#4263eb" fillOpacity={0.17} strokeWidth={2} /><Tooltip contentStyle={chartTooltipStyle} /></RadarChart></ResponsiveContainer></div><div className="focus-tip"><Target size={15} /><span><strong>Focus next:</strong> {weakestChapter?.chapter ?? "Keep practicing"}</span><span className="tip-score">{weakestChapter?.score ?? 0}%</span></div></section>
    </div>
    <section className="panel review-panel">
      <div className="panel-heading"><div><p className="eyebrow">LEARN FROM EVERY QUESTION</p><h2>Review every answer</h2></div><span className="wrong-count">{questions.length} questions · {missedCount} to revisit</span></div>
      <div className="review-filters" aria-label="Filter reviewed questions">{reviewFilters.map((filter) => <button key={filter} type="button" className={reviewFilter === filter ? "review-filter-active" : ""} aria-pressed={reviewFilter === filter} onClick={() => setReviewFilter(filter)}>{filter} <span>{filter === "All" ? questions.length : questions.filter((question) => question.reviewStatus === filter).length}</span></button>)}</div>
      {visibleQuestions.length ? visibleQuestions.map((question, index) => <article className={`review-row review-row-${question.reviewStatus.toLowerCase()}`} key={question.id}>
        <span className="review-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="review-info"><span>{question.subject} <i /> {question.chapter}</span><strong>{question.text}</strong></div>
        <span className={`review-status review-status-${question.reviewStatus.toLowerCase()}`}>{question.reviewStatus}</span>
        <button className="button button-small button-outline" onClick={() => onReview(question)}><Eye size={14} /> Review answer</button>
      </article>) : <div className="review-empty"><CheckCircle2 size={17} />{questions.length === 0 ? "Answer review is not available for this result." : `No ${reviewFilter.toLowerCase()} answers in this test.`}</div>}
      {missedCount > 0 && <button className="revise-button" onClick={() => onReview(questions.find((question) => question.reviewStatus !== "Correct")!)}><BookOpen size={15} /> Review missed & unanswered <ArrowRight size={15} /></button>}
    </section>
  </div>;
}

function AdminHome({ tests, questions, students, onNavigate }: { tests: TestItem[]; questions: Question[]; students: number; onNavigate: (page: Page) => void }) {
  return <><PageTitle eyebrow="ADMIN OVERVIEW" title="Good afternoon, Admin." description="Here's what's happening across your NEET Pro workspace today." action={<button className="button button-primary" onClick={() => onNavigate("builder")}><Plus size={16} /> Create a test</button>} />
    <div className="admin-stats"><article className="admin-stat"><span className="admin-stat-icon stat-blue"><Users size={18} /></span><span>Total users</span><strong>{students.toLocaleString()}<small>Student accounts</small></strong></article><article className="admin-stat"><span className="admin-stat-icon stat-green"><BookOpen size={18} /></span><span>Total tests</span><strong>{tests.length}<small>Assessments created</small></strong></article><article className="admin-stat"><span className="admin-stat-icon stat-purple"><FileQuestion size={18} /></span><span>Published questions</span><strong>{questions.length.toLocaleString()}<small>Across 3 subjects</small></strong></article><article className="admin-stat"><span className="admin-stat-icon stat-orange"><Activity size={18} /></span><span>Revenue</span><strong>₹0<small>Payments not configured</small></strong></article></div>
    <div className="dashboard-columns admin-columns"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Student performance</h2></div><button className="text-button" onClick={() => onNavigate("students")}>All students <ArrowRight size={14} /></button></div><div className="activity-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ day: "Mon", attempts: 134 }, { day: "Tue", attempts: 172 }, { day: "Wed", attempts: 148 }, { day: "Thu", attempts: 215 }, { day: "Fri", attempts: 185 }, { day: "Sat", attempts: 262 }, { day: "Sun", attempts: 220 }]} margin={{ top: 12, right: 10, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef1f6" strokeDasharray="3 4" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#98a2b3" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#98a2b3" }} /><Tooltip contentStyle={chartTooltipStyle} /><Bar dataKey="attempts" fill="#4263eb" radius={[5, 5, 0, 0]} barSize={23} /></BarChart></ResponsiveContainer></div></section>
      <section className="panel quick-actions"><div className="panel-heading"><div><p className="eyebrow">QUICK ACTIONS</p><h2>Manage your content</h2></div></div><button onClick={() => onNavigate("questions")}><span className="quick-action-icon stat-blue"><Plus size={17} /></span><span><strong>Add questions</strong><small>Grow your question bank</small></span><ChevronRight size={17} /></button><button onClick={() => onNavigate("builder")}><span className="quick-action-icon stat-purple"><Sparkles size={17} /></span><span><strong>Create a test</strong><small>Build a mock or chapter test</small></span><ChevronRight size={17} /></button><button onClick={() => onNavigate("students")}><span className="quick-action-icon stat-green"><Users size={17} /></span><span><strong>Manage students</strong><small>View accounts and progress</small></span><ChevronRight size={17} /></button></section></div>
    <section className="panel admin-tests-panel"><div className="panel-heading"><div><p className="eyebrow">TESTS</p><h2>Recently created</h2></div><button className="text-button" onClick={() => onNavigate("builder")}>Test library <ArrowRight size={14} /></button></div>{tests.slice(0, 3).map((test) => <div className="admin-test-row" key={test.id}><span className={`test-icon test-icon-${test.color}`}><TestGlyph icon={test.icon} /></span><span><strong>{test.name}</strong><small>{test.category} · {test.questions} questions</small></span><span className={`status-pill status-${test.status.toLowerCase()}`}><i />{test.status}</span><button className="icon-button" aria-label="Test options"><MoreHorizontal size={18} /></button></div>)}</section>
  </>;
}

function QuestionBank({ questions, search, setSearch, onAdd, onImport }: { questions: Question[]; search: string; setSearch: (value: string) => void; onAdd: () => void; onImport: () => void }) {
  const [subjectFilter, setSubjectFilter] = useState("All subjects");
  const [chapterFilter, setChapterFilter] = useState("All chapters");
  const [difficultyFilter, setDifficultyFilter] = useState("All difficulties");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const chapters = [...new Set(questions
    .filter((question) => subjectFilter === "All subjects" || question.subject === subjectFilter)
    .map((question) => question.chapter))].sort((a, b) => a.localeCompare(b));
  const subjects = [...new Set(questions.map((question) => question.subject))].sort((a, b) => a.localeCompare(b));
  const filtered = questions.filter((question) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${question.text} ${question.subject} ${question.chapter} ${question.tags ?? ""}`.toLowerCase().includes(query);
    const matchesSubject = subjectFilter === "All subjects" || question.subject === subjectFilter;
    const matchesChapter = chapterFilter === "All chapters" || question.chapter === chapterFilter;
    const matchesDifficulty = difficultyFilter === "All difficulties" || question.difficulty === difficultyFilter;
    const matchesStatus = statusFilter === "All statuses" || (question.status ?? "Published") === statusFilter;
    return matchesSearch && matchesSubject && matchesChapter && matchesDifficulty && matchesStatus;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageQuestions = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const publishedCount = questions.filter((question) => (question.status ?? "Published") === "Published").length;
  const draftCount = questions.length - publishedCount;
  const subjectShare = (subject: string) => questions.length ? `${Math.round(questions.filter((question) => question.subject === subject).length / questions.length * 100)}%` : "0%";
  function resetPage() {
    setPage(1);
  }
  return <><PageTitle eyebrow="CONTENT MANAGEMENT" title="Question bank" description="Create, review, and organize your NEET question library." action={<div className="heading-actions"><button className="button button-outline" onClick={onImport}><Upload size={15} /> Bulk import</button><button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add question</button></div>} />
    <div className="question-stats"><span><strong>{questions.length}</strong> total questions</span><span><i className="published-dot" /><strong>{publishedCount}</strong> published</span><span><i className="draft-dot" /><strong>{draftCount}</strong> drafts</span><span className="subject-stat">Physics <strong>{subjectShare("Physics")}</strong></span><span className="subject-stat">Chemistry <strong>{subjectShare("Chemistry")}</strong></span><span className="subject-stat">Biology <strong>{subjectShare("Biology")}</strong></span></div>
    <section className="panel table-panel">
      <div className="question-filter-toolbar">
        <label className="search-field"><Search size={16} /><input placeholder="Search question, chapter, or subject…" value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} /></label>
        <label className="filter-select"><Filter size={15} /><select aria-label="Filter by subject" value={subjectFilter} onChange={(event) => { setSubjectFilter(event.target.value); setChapterFilter("All chapters"); resetPage(); }}><option>All subjects</option>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
        <label className="filter-select"><select aria-label="Filter by chapter" value={chapterFilter} onChange={(event) => { setChapterFilter(event.target.value); resetPage(); }}><option>All chapters</option>{chapters.map((chapter) => <option key={chapter}>{chapter}</option>)}</select></label>
        <label className="filter-select"><select aria-label="Filter by difficulty" value={difficultyFilter} onChange={(event) => { setDifficultyFilter(event.target.value); resetPage(); }}><option>All difficulties</option><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
        <label className="filter-select"><select aria-label="Filter by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); resetPage(); }}><option>All statuses</option><option>Published</option><option>Draft</option></select></label>
      </div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>QUESTION</th><th>SUBJECT / CHAPTER</th><th>DIFFICULTY</th><th>STATUS</th></tr></thead><tbody>{pageQuestions.map((question) => {
        const status = question.status ?? "Published";
        return <tr key={question.id}><td><span className="table-question">{question.text}</span><small className="table-id">ID: {question.id.toUpperCase()}</small>{question.tags && question.tags.length > 0 && <small className="question-tag-list">{question.tags.join(" · ")}</small>}</td><td><strong>{question.subject}</strong><small>{question.chapter}</small></td><td><span className={`difficulty difficulty-${question.difficulty.toLowerCase()}`}>{question.difficulty}</span></td><td><span className={`status-pill status-${status.toLowerCase()}`}><i />{status}</span></td></tr>;
      })}</tbody></table>{filtered.length === 0 && <div className="empty-state"><Search size={24} /><strong>No questions match these filters</strong><span>Clear a filter or try a different search.</span></div>}</div>
      <div className="table-footer"><span>Showing <strong>{filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong> matching · {questions.length} total</span><div className="pagination-actions"><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    </section>
  </>;
}

function TestBuilder({ tests, onCreate }: { tests: TestItem[]; onCreate: () => void }) {
  return <><PageTitle eyebrow="ASSESSMENT DESIGN" title="Test creator" description="Build balanced, exam-ready assessments for your students." action={<button className="button button-primary" onClick={onCreate}><Plus size={16} /> Create new test</button>} />
    <div className="builder-banner"><div className="builder-banner-icon"><Sparkles size={21} /></div><div><strong>Let smart selection do the heavy lifting.</strong><span>Choose subjects and chapters—NEET Pro will balance difficulty across your test.</span></div><button className="button button-white" onClick={onCreate}><Sparkles size={15} /> Auto-generate a test</button></div>
    <div className="builder-section-title"><div><p className="eyebrow">YOUR ASSESSMENTS</p><h2>Test library <span>{tests.length}</span></h2></div><button className="filter-select"><Filter size={15} /> All test types <ChevronDown size={14} /></button></div>
    <section className="panel builder-list">{tests.map((test) => <div className="builder-test-row" key={test.id}><span className={`test-icon test-icon-${test.color}`}><TestGlyph icon={test.icon} /></span><span className="builder-test-info"><strong>{test.name}</strong><small>{test.category} · {test.subject}</small></span><span className="builder-test-metric"><strong>{test.questions}</strong><small>Questions</small></span><span className="builder-test-metric"><strong>{test.duration} min</strong><small>Duration</small></span><span className={`status-pill status-${test.status.toLowerCase()}`}><i />{test.status}</span><button className="icon-button" aria-label="Test options"><MoreHorizontal size={18} /></button></div>)}</section>
  </>;
}

function Students({ students, total, onToggle, onView }: { students: AdminStudent[]; total: number; onToggle: (id: string) => void; onView: (student: AdminStudent) => void }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const activeCount = students.filter((student) => student.active).length;
  const scores = students.map((student) => Number.parseInt(student.score, 10)).filter(Number.isFinite);
  const averageScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
  const filteredStudents = students.filter((student) => {
    const matchesSearch = `${student.name} ${student.phone}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? student.active : !student.active);
    return matchesSearch && matchesStatus;
  });
  function exportStudents() {
    const escapeCell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [
      ["Name", "Phone", "Last score", "Role", "Status"].map(escapeCell).join(","),
      ...students.map((student) => [student.name, student.phone, student.score, student.role, student.active ? "Active" : "Blocked"].map(escapeCell).join(",")),
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "neet-pro-students.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return <><PageTitle eyebrow="LEARNER MANAGEMENT" title="Your students" description="View student accounts, recent scores, and account status." action={<button className="button button-outline" onClick={exportStudents}><Download size={15} /> Export list</button>} />
    <div className="admin-stats student-stats"><article className="admin-stat"><span className="admin-stat-icon stat-blue"><Users size={18} /></span><span>Total students</span><strong>{total.toLocaleString()}<small>Registered learners</small></strong></article><article className="admin-stat"><span className="admin-stat-icon stat-green"><Activity size={18} /></span><span>Active accounts</span><strong>{activeCount}<small>In the current list</small></strong></article><article className="admin-stat"><span className="admin-stat-icon stat-purple"><Target size={18} /></span><span>Average score</span><strong>{averageScore}<small>Based on available scores</small></strong></article></div>
    <section className="panel table-panel"><div className="table-toolbar"><label className="search-field"><Search size={16} /><input placeholder="Search students…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="filter-select"><Filter size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All students</option><option value="active">Active</option><option value="blocked">Blocked</option></select><ChevronDown size={14} /></label></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>STUDENT</th><th>PHONE</th><th>LAST SCORE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{filteredStudents.map((student) => <tr key={student.phone}><td><span className="student-name-cell"><span className="avatar">{student.name[0]}</span><strong>{student.name}</strong></span></td><td>{student.phone}</td><td><strong>{student.score}</strong></td><td><span className={`status-pill ${student.active ? "status-available" : "status-upcoming"}`}><i />{student.active ? "Active" : "Blocked"}</span></td><td><div className="student-row-actions"><button className="button button-small button-outline" onClick={() => onView(student)}>Details</button><button className={`button button-small ${student.active ? "button-danger" : "button-outline"}`} onClick={() => void onToggle(student.id)}>{student.active ? "Block" : "Unblock"}</button></div></td></tr>)}</tbody></table>{filteredStudents.length === 0 && <div className="empty-state"><Search size={22} /><strong>No students found</strong></div>}</div><div className="table-footer">Showing <strong>{filteredStudents.length}</strong> of <strong>{students.length}</strong> students<button disabled>Previous</button><button disabled>Next</button></div></section>
  </>;
}

export default App;
