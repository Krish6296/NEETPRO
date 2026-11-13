import dotenv from "dotenv";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import jwt, { type SignOptions } from "jsonwebtoken";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, PrismaClient, type Question } from "@prisma/client";

dotenv.config();
dotenv.config({ path: "../.env" });

const app = express();
const prisma = new PrismaClient();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      const error = Object.assign(new Error("Only JPEG, PNG, and WebP images are supported"), {
        status: 400,
        code: "INVALID_IMAGE_TYPE",
      });
      callback(error);
      return;
    }
    callback(null, true);
  },
});
const port = Number(process.env.PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "neet-pro-local-development-secret-change-me");
const demoOtp = process.env.DEMO_OTP ?? "123456";
const otpTtlSeconds = 5 * 60;
const pageSizeMax = 100;

if (process.env.NODE_ENV === "production" && !jwtSecret) {
  throw new Error("JWT_SECRET must be configured in production");
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

type AuthUser = { id: string; phone: string; role: "STUDENT" | "ADMIN"; isBlocked: boolean };
type AuthRequest = Request & { auth?: AuthUser };
type ApiError = Error & { status?: number; code?: string; details?: unknown };

function fail(status: number, code: string, message: string, details?: unknown): never {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.code = code;
  error.details = details;
  throw error;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, name: string, maxLength = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    fail(400, "VALIDATION_ERROR", `${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function integer(value: unknown, name: string, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) fail(400, "VALIDATION_ERROR", `${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

function enumValue<T extends string>(value: unknown, name: string, values: readonly T[], fallback?: T): T {
  const parsed = value === undefined ? fallback : value;
  if (typeof parsed !== "string" || !values.includes(parsed as T)) fail(400, "VALIDATION_ERROR", `${name} must be one of ${values.join(", ")}`);
  return parsed as T;
}

function pagination(request: Request) {
  const page = integer(request.query.page ?? 1, "page", 1, 1_000_000);
  const limit = integer(request.query.limit ?? 20, "limit", 1, pageSizeMax);
  return { page, limit, skip: (page - 1) * limit };
}

function routeParam(request: Request, key: string): string {
  const value = request.params[key];
  if (typeof value !== "string" || !value) fail(400, "VALIDATION_ERROR", `Invalid ${key}`);
  return value;
}

function pageResult<T>(items: T[], total: number, page: number, limit: number) {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

function safeUser(user: AuthUser | { id: string; phone: string; role: string; isBlocked: boolean; profile?: unknown }) {
  return { id: user.id, phone: user.phone, role: user.role, isBlocked: user.isBlocked, ...("profile" in user ? { profile: user.profile } : {}) };
}

function hashOtp(phone: string, code: string) {
  return createHash("sha256").update(`${process.env.OTP_SECRET ?? jwtSecret}:${phone}:${code}`).digest("hex");
}

function equalHash(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicQuestion(question: Question) {
  const { correctOptionId: _correctOptionId, explanation: _explanation, ...safe } = question;
  return safe;
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function attemptExpiresAt(startedAt: Date, durationMinutes: number, testEndTime: Date | null) {
  const durationExpiry = new Date(startedAt.getTime() + durationMinutes * 60_000);
  return testEndTime && testEndTime < durationExpiry ? testEndTime : durationExpiry;
}

function validOptions(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) fail(400, "VALIDATION_ERROR", "options must be an array of 2 to 8 options");
  return value.map((item, index) => {
    if (typeof item === "string" && item.trim()) return { id: String.fromCharCode(65 + index), text: item.trim() };
    const option = object(item);
    return { id: text(option.id, `options[${index}].id`, 50), text: text(option.text, `options[${index}].text`, 2000) };
  });
}

function questionData(input: unknown, partial = false): Prisma.QuestionUncheckedCreateInput {
  const data = object(input);
  const result: Record<string, unknown> = {};
  if (!partial || data.text !== undefined) result.text = text(data.text, "text");
  if (!partial || data.options !== undefined) {
    const options = validOptions(data.options);
    result.options = options;
    if (!partial || data.correctOptionId !== undefined) {
      const correct = text(data.correctOptionId, "correctOptionId", 50);
      if (!options.some(option => option.id === correct)) fail(400, "VALIDATION_ERROR", "correctOptionId must match an option id");
      result.correctOptionId = correct;
    }
  } else if (data.correctOptionId !== undefined) {
    result.correctOptionId = text(data.correctOptionId, "correctOptionId", 50);
  }
  if (!partial || data.subject !== undefined) result.subject = text(data.subject, "subject", 100);
  if (!partial || data.chapter !== undefined) result.chapter = text(data.chapter, "chapter", 150);
  if (!partial || data.difficulty !== undefined) result.difficulty = enumValue(data.difficulty, "difficulty", ["EASY", "MEDIUM", "HARD"] as const);
  if (data.status !== undefined || !partial) result.status = enumValue(data.status, "status", ["DRAFT", "PUBLISHED"] as const, "DRAFT");
  if (data.explanation !== undefined) result.explanation = data.explanation === null ? null : text(data.explanation, "explanation");
  if (data.imageUrl !== undefined) {
    if (data.imageUrl === null) {
      result.imageUrl = null;
    } else {
      const imageUrl = text(data.imageUrl, "imageUrl", 2048);
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch {
        fail(400, "VALIDATION_ERROR", "imageUrl must be a valid HTTP or HTTPS URL");
      }
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        fail(400, "VALIDATION_ERROR", "imageUrl must use HTTP or HTTPS");
      }
      result.imageUrl = imageUrl;
    }
  }
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags) || data.tags.some(tag => typeof tag !== "string")) fail(400, "VALIDATION_ERROR", "tags must be an array of strings");
    result.tags = data.tags.map(tag => (tag as string).trim().toLowerCase()).filter(Boolean);
  }
  return result as Prisma.QuestionUncheckedCreateInput;
}

function hasPreviousYearSource(tags: string[]) {
  const normalizedTags = tags.map(tag => tag.toLowerCase());
  return normalizedTags.includes("pyq") && normalizedTags.some(tag => /^year:(19|20)\d{2}$/.test(tag));
}

function testData(input: unknown, partial = false): Prisma.TestUncheckedCreateInput & { questionIds?: string[] } {
  const data = object(input);
  const result: Record<string, unknown> = {};
  if (!partial || data.name !== undefined) result.name = text(data.name, "name", 150);
  if (!partial || data.type !== undefined) result.type = enumValue(data.type, "type", ["FULL_MOCK", "CHAPTER", "SUBJECT", "PREVIOUS_YEAR"] as const);
  if (!partial || data.durationMinutes !== undefined) result.durationMinutes = integer(data.durationMinutes, "durationMinutes", 1, 600);
  if (!partial || data.totalMarks !== undefined) result.totalMarks = integer(data.totalMarks, "totalMarks", 1, 100000);
  if (data.negativeMarking !== undefined || !partial) {
    const penalty = data.negativeMarking === undefined ? 1 : Number(data.negativeMarking);
    if (!Number.isFinite(penalty) || penalty < 0 || penalty > 10) fail(400, "VALIDATION_ERROR", "negativeMarking must be between 0 and 10");
    result.negativeMarking = penalty;
  }
  for (const field of ["startTime", "endTime"] as const) {
    if (data[field] !== undefined) {
      const date = data[field] === null ? null : new Date(String(data[field]));
      if (date && Number.isNaN(date.getTime())) fail(400, "VALIDATION_ERROR", `${field} must be a valid ISO date`);
      result[field] = date;
    }
  }
  if (result.startTime instanceof Date && result.endTime instanceof Date && result.endTime <= result.startTime) {
    fail(400, "VALIDATION_ERROR", "endTime must be later than startTime");
  }
  if (data.isLocked !== undefined) {
    if (typeof data.isLocked !== "boolean") fail(400, "VALIDATION_ERROR", "isLocked must be a boolean");
    result.isLocked = data.isLocked;
  }
  if (data.questionIds !== undefined) {
    if (!Array.isArray(data.questionIds) || data.questionIds.some(id => typeof id !== "string") || new Set(data.questionIds).size !== data.questionIds.length) {
      fail(400, "VALIDATION_ERROR", "questionIds must be an array of unique ids");
    }
    result.questionIds = data.questionIds as string[];
  }
  return result as Prisma.TestUncheckedCreateInput & { questionIds?: string[] };
}

async function authentication(request: AuthRequest, _response: Response, next: NextFunction) {
  try {
    const header = request.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) fail(401, "UNAUTHENTICATED", "A bearer token is required");
    if (!jwtSecret) fail(500, "CONFIGURATION_ERROR", "JWT_SECRET must be configured");
    const claims = jwt.verify(header.slice(7), jwtSecret) as jwt.JwtPayload;
    if (typeof claims.sub !== "string") fail(401, "INVALID_TOKEN", "Token subject is invalid");
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, phone: true, role: true, isBlocked: true } });
    if (!user || user.isBlocked) fail(401, "ACCOUNT_UNAVAILABLE", "This account is unavailable");
    request.auth = user;
    next();
  } catch (error) {
    next(error);
  }
}

function adminOnly(request: AuthRequest, _response: Response, next: NextFunction) {
  if (request.auth?.role !== "ADMIN") return next(Object.assign(new Error("Admin access is required"), { status: 403, code: "FORBIDDEN" }));
  next();
}

const requireAuth = [authentication];
const requireAdmin = [authentication, adminOnly];

app.get("/api/health", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: "ok", database: "connected" });
  } catch {
    response.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

app.post("/api/auth/otp/request", async (request, response) => {
  const phone = text(object(request.body).phone, "phone", 30);
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) fail(400, "VALIDATION_ERROR", "phone must be a valid international phone number");
  if (process.env.NODE_ENV === "production") fail(503, "OTP_PROVIDER_UNAVAILABLE", "No production SMS provider is configured");
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true, isBlocked: true } });
  if (user?.isBlocked) fail(403, "ACCOUNT_BLOCKED", "This account is blocked");
  const now = new Date();
  const recent = await prisma.otpChallenge.count({ where: { phone, createdAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) } } });
  if (recent >= 5) fail(429, "OTP_RATE_LIMIT", "Too many OTP requests; try again later");
  const code = process.env.DEMO_OTP ?? demoOtp;
  const challenge = await prisma.otpChallenge.create({
    data: { phone, codeHash: hashOtp(phone, code), expiresAt: new Date(now.getTime() + otpTtlSeconds * 1000), userId: user?.id },
  });
  response.status(201).json({
    phone,
    challengeId: challenge.id,
    expiresInSeconds: otpTtlSeconds,
    demoOtp: code,
    demoOnly: true,
    warning: "Development/testing only: OTP is returned in this response; configure an SMS provider before production.",
  });
});

app.post("/api/auth/otp/verify", async (request, response) => {
  const body = object(request.body);
  const phone = text(body.phone, "phone", 30);
  const code = text(body.code, "code", 12);
  const challengeId = body.challengeId === undefined ? undefined : text(body.challengeId, "challengeId", 100);
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, ...(challengeId ? { id: challengeId } : {}), verifiedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= 5 || !equalHash(challenge.codeHash, hashOtp(phone, code))) {
    if (challenge && challenge.attempts < 5) await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    fail(400, "INVALID_OTP", "OTP is invalid or expired");
  }
  const user = await prisma.$transaction(async tx => {
    const claimed = await tx.otpChallenge.updateMany({
      where: { id: challenge.id, verifiedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
      data: { verifiedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) fail(400, "INVALID_OTP", "OTP is invalid or expired");
    return tx.user.upsert({ where: { phone }, create: { phone }, update: {} });
  });
  if (user.isBlocked) fail(403, "ACCOUNT_BLOCKED", "This account is blocked");
  if (!jwtSecret) fail(500, "CONFIGURATION_ERROR", "JWT_SECRET must be configured");
  const token = jwt.sign({ role: user.role }, jwtSecret, { subject: user.id, expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"] });
  response.json({ token, user: safeUser(user) });
});

app.get("/api/auth/me", ...requireAuth, async (request: AuthRequest, response) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth!.id } });
  response.json({ user: safeUser(user) });
});

app.get("/api/tests", ...requireAuth, async (request: AuthRequest, response) => {
  const { page, limit, skip } = pagination(request);
  const where: Prisma.TestWhereInput = request.auth!.role === "ADMIN" ? {} : { isLocked: false };
  if (request.query.type) where.type = enumValue(request.query.type, "type", ["FULL_MOCK", "CHAPTER", "SUBJECT", "PREVIOUS_YEAR"] as const);
  if (request.query.search) where.name = { contains: text(request.query.search, "search", 100), mode: "insensitive" };
  const [items, total] = await prisma.$transaction([
    prisma.test.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" }, include: { _count: { select: { questions: true } } } }),
    prisma.test.count({ where }),
  ]);
  response.json(pageResult(items, total, page, limit));
});

app.get("/api/tests/:testId", ...requireAuth, async (request: AuthRequest, response) => {
  const test = await prisma.test.findUnique({ where: { id: routeParam(request, "testId") }, include: { questions: { orderBy: { position: "asc" }, include: { question: true } } } });
  if (!test || (test.isLocked && request.auth!.role !== "ADMIN")) fail(404, "NOT_FOUND", "Test not found");
  response.json({
    test: { ...test, questions: test.questions.map(({ question, ...item }) => ({ ...item, question: request.auth!.role === "ADMIN" ? question : publicQuestion(question) })) },
  });
});

app.post("/api/tests", ...requireAdmin, async (request, response) => {
  const data = testData(request.body);
  const questionIds = data.questionIds ?? [];
  delete data.questionIds;
  const test = await prisma.$transaction(async tx => {
    const created = await tx.test.create({ data });
    if (questionIds.length) {
      const questions = await tx.question.findMany({ where: { id: { in: questionIds } }, select: { id: true, tags: true } });
      if (questions.length !== questionIds.length) fail(400, "INVALID_QUESTION", "One or more question ids do not exist");
      if (created.type === "PREVIOUS_YEAR" && questions.some(question => !hasPreviousYearSource(question.tags))) {
        fail(400, "PYQ_SOURCE_REQUIRED", "Previous Year Questions tests require questions tagged pyq and year:YYYY");
      }
      await tx.testQuestion.createMany({ data: questionIds.map((questionId, position) => ({ testId: created.id, questionId, position })) });
    }
    return tx.test.findUniqueOrThrow({ where: { id: created.id }, include: { _count: { select: { questions: true } } } });
  });
  response.status(201).json({ test });
});

app.patch("/api/tests/:testId", ...requireAdmin, async (request, response) => {
  const testId = routeParam(request, "testId");
  const current = await prisma.test.findUnique({ where: { id: testId } });
  if (!current) fail(404, "NOT_FOUND", "Test not found");
  const data = testData({ ...current, ...object(request.body) }, true);
  const questionIds = data.questionIds;
  delete data.questionIds;
  const test = await prisma.$transaction(async tx => {
    if (!(await tx.test.findUnique({ where: { id: testId }, select: { id: true } }))) fail(404, "NOT_FOUND", "Test not found");
    const nextType = data.type ?? current.type;
    if (nextType === "PREVIOUS_YEAR" && !questionIds) {
      const currentQuestions = await tx.testQuestion.findMany({ where: { testId }, select: { questionId: true } });
      const questions = await tx.question.findMany({
        where: { id: { in: currentQuestions.map(question => question.questionId) } },
        select: { tags: true },
      });
      if (questions.some(question => !hasPreviousYearSource(question.tags))) {
        fail(400, "PYQ_SOURCE_REQUIRED", "Previous Year Questions tests require questions tagged pyq and year:YYYY");
      }
    }
    if (questionIds) {
      const questions = await tx.question.findMany({ where: { id: { in: questionIds } }, select: { id: true, tags: true } });
      if (questions.length !== questionIds.length) fail(400, "INVALID_QUESTION", "One or more question ids do not exist");
      if (nextType === "PREVIOUS_YEAR" && questions.some(question => !hasPreviousYearSource(question.tags))) {
        fail(400, "PYQ_SOURCE_REQUIRED", "Previous Year Questions tests require questions tagged pyq and year:YYYY");
      }
      await tx.testQuestion.deleteMany({ where: { testId } });
      await tx.testQuestion.createMany({ data: questionIds.map((questionId, position) => ({ testId, questionId, position })) });
    }
    return tx.test.update({ where: { id: testId }, data, include: { _count: { select: { questions: true } } } });
  });
  response.json({ test });
});

app.delete("/api/tests/:testId", ...requireAdmin, async (request, response) => {
  await prisma.test.delete({ where: { id: routeParam(request, "testId") } });
  response.status(204).end();
});

app.get("/api/questions", ...requireAuth, async (request: AuthRequest, response) => {
  const { page, limit, skip } = pagination(request);
  const where: Prisma.QuestionWhereInput = request.auth!.role === "ADMIN" ? {} : { status: "PUBLISHED" };
  if (request.query.subject) where.subject = text(request.query.subject, "subject", 100);
  if (request.query.chapter) where.chapter = text(request.query.chapter, "chapter", 150);
  if (request.query.difficulty) where.difficulty = enumValue(request.query.difficulty, "difficulty", ["EASY", "MEDIUM", "HARD"] as const);
  if (request.query.status && request.auth!.role === "ADMIN") where.status = enumValue(request.query.status, "status", ["DRAFT", "PUBLISHED"] as const);
  if (request.query.search) where.text = { contains: text(request.query.search, "search", 100), mode: "insensitive" };
  const [records, total] = await prisma.$transaction([
    prisma.question.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
    prisma.question.count({ where }),
  ]);
  response.json(pageResult(records.map(question => request.auth!.role === "ADMIN" ? question : publicQuestion(question)), total, page, limit));
});

app.post("/api/questions", ...requireAdmin, async (request, response) => {
  const question = await prisma.question.create({ data: questionData(request.body) });
  response.status(201).json({ question });
});

app.post("/api/uploads/images", ...requireAdmin, imageUpload.single("image"), async (request, response) => {
  const file = request.file;
  if (!file) fail(400, "IMAGE_REQUIRED", "Choose an image file to upload");
  const signatures: Record<string, boolean> = {
    "image/jpeg": file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff,
    "image/png": file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/webp": file.buffer.toString("ascii", 0, 4) === "RIFF" && file.buffer.toString("ascii", 8, 12) === "WEBP",
  };
  if (!signatures[file.mimetype]) fail(400, "INVALID_IMAGE_CONTENT", "The file content does not match its image type");

  const storageUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!storageUrl || !serviceKey || !bucket) {
    fail(503, "IMAGE_STORAGE_UNAVAILABLE", "Configure Supabase Storage credentials to upload question images");
  }
  const extension = file.mimetype === "image/jpeg" ? "jpg" : file.mimetype.slice("image/".length);
  const objectPath = `questions/${randomUUID()}.${extension}`;
  const uploadResponse = await fetch(
    `${storageUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": file.mimetype,
        "x-upsert": "false",
      },
      body: file.buffer,
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!uploadResponse.ok) {
    console.error("Supabase image upload failed", { status: uploadResponse.status });
    fail(502, "IMAGE_STORAGE_ERROR", "Supabase Storage could not save the image");
  }
  response.status(201).json({
    imageUrl: `${storageUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,
  });
});

app.get("/api/questions/:questionId", ...requireAuth, async (request: AuthRequest, response) => {
  const question = await prisma.question.findUnique({ where: { id: routeParam(request, "questionId") } });
  if (!question || (question.status !== "PUBLISHED" && request.auth!.role !== "ADMIN")) fail(404, "NOT_FOUND", "Question not found");
  response.json({ question: request.auth!.role === "ADMIN" ? question : publicQuestion(question) });
});

app.patch("/api/questions/:questionId", ...requireAdmin, async (request, response) => {
  const questionId = routeParam(request, "questionId");
  const current = await prisma.question.findUnique({ where: { id: questionId } });
  if (!current) fail(404, "NOT_FOUND", "Question not found");
  const question = await prisma.question.update({ where: { id: questionId }, data: questionData({ ...current, ...object(request.body) }) });
  response.json({ question });
});

app.delete("/api/questions/:questionId", ...requireAdmin, async (request, response) => {
  await prisma.question.delete({ where: { id: routeParam(request, "questionId") } });
  response.status(204).end();
});

app.post("/api/questions/import", ...requireAdmin, express.text({ type: ["text/csv", "text/plain"], limit: "2mb" }), async (request, response) => {
  const csv = typeof request.body === "string" ? request.body : object(request.body).csv;
  if (typeof csv !== "string" || !csv.trim()) fail(400, "VALIDATION_ERROR", "Provide a CSV request body with a header row");
  const rows = parseCsv(csv);
  if (rows.length < 2) fail(400, "VALIDATION_ERROR", "CSV must contain a header and at least one row");
  const headers = rows[0].map(value => value.trim());
  const required = ["text", "optionA", "optionB", "optionC", "optionD", "correctOptionId", "subject", "chapter"];
  const missing = required.filter(header => !headers.includes(header));
  if (missing.length) fail(400, "VALIDATION_ERROR", `Missing CSV columns: ${missing.join(", ")}`);
  if (rows.length > 501) fail(400, "VALIDATION_ERROR", "A maximum of 500 questions may be imported at once");
  const records = rows.slice(1).filter(row => row.some(value => value.trim())).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""]));
    try {
      return questionData({
        text: record.text,
        options: ["A", "B", "C", "D"].map((id, i) => ({ id, text: record[`option${id}`] })),
        correctOptionId: record.correctOptionId,
        explanation: record.explanation || undefined,
        subject: record.subject,
        chapter: record.chapter,
        difficulty: (record.difficulty || "MEDIUM").toUpperCase(),
        status: (record.status || "PUBLISHED").toUpperCase(),
        tags: record.tags ? record.tags.split("|").map(value => value.trim()) : [],
      });
    } catch (error) {
      fail(400, "CSV_ROW_INVALID", `Invalid CSV data on row ${index + 2}: ${(error as Error).message}`);
    }
  });
  const created = await prisma.question.createMany({ data: records as Prisma.QuestionCreateManyInput[] });
  response.status(201).json({ imported: created.count });
});

app.post("/api/tests/:testId/generate", ...requireAdmin, async (request, response) => {
  const testId = routeParam(request, "testId");
  const body = object(request.body);
  const count = integer(body.questionCount, "questionCount", 1, 500);
  const test = await prisma.test.findUnique({ where: { id: testId } });
  if (!test) fail(404, "NOT_FOUND", "Test not found");
  if (test.type === "FULL_MOCK" && count !== 180) {
    fail(400, "INVALID_FULL_MOCK_SIZE", "A full mock test must contain exactly 180 questions");
  }
  if (test.type === "FULL_MOCK" && (body.subject || body.chapter || body.difficulty)) {
    fail(400, "INVALID_FULL_MOCK_FILTER", "A full mock test must include all subjects and difficulty levels");
  }
  if (test.type === "FULL_MOCK") {
    const quotas = [
      { subject: "Physics", count: 45 },
      { subject: "Chemistry", count: 45 },
      { subject: "Biology", count: 90 },
    ];
    const subjectQuestions = await Promise.all(quotas.map(async quota => {
      const available = await prisma.question.findMany({
        where: { status: "PUBLISHED", subject: quota.subject },
        select: { id: true },
      });
      if (available.length < quota.count) {
        fail(400, "INSUFFICIENT_QUESTIONS", `A full mock needs ${quota.count} published ${quota.subject} questions; only ${available.length} are available`);
      }
      return shuffle(available).slice(0, quota.count);
    }));
    const chosen = shuffle(subjectQuestions.flat());
    await prisma.$transaction(async tx => {
      await tx.testQuestion.deleteMany({ where: { testId } });
      await tx.testQuestion.createMany({ data: chosen.map(({ id }, position) => ({ testId, questionId: id, position })) });
      await tx.test.update({ where: { id: testId }, data: { totalMarks: 720 } });
    });
    response.json({ testId, generated: chosen.length, questionIds: chosen.map(item => item.id) });
    return;
  }
  const filters: Prisma.QuestionWhereInput = { status: "PUBLISHED" };
  if (body.subject) filters.subject = text(body.subject, "subject", 100);
  if (body.chapter) filters.chapter = text(body.chapter, "chapter", 150);
  if (body.difficulty) filters.difficulty = enumValue(body.difficulty, "difficulty", ["EASY", "MEDIUM", "HARD"] as const);
  if (test.type === "PREVIOUS_YEAR") filters.tags = { has: "pyq" };
  const candidates = await prisma.question.findMany({ where: filters, select: { id: true, tags: true } });
  const selected = test.type === "PREVIOUS_YEAR"
    ? candidates.filter(question => hasPreviousYearSource(question.tags))
    : candidates;
  if (selected.length < count) fail(400, "INSUFFICIENT_QUESTIONS", `Only ${selected.length} matching published questions are available`);
  const chosen = shuffle(selected).slice(0, count);
  await prisma.$transaction(async tx => {
    await tx.testQuestion.deleteMany({ where: { testId } });
    await tx.testQuestion.createMany({ data: chosen.map(({ id }, position) => ({ testId, questionId: id, position })) });
    await tx.test.update({ where: { id: testId }, data: { totalMarks: count * 4 } });
  });
  response.json({ testId, generated: count, questionIds: chosen.map(item => item.id) });
});

app.post("/api/attempts", ...requireAuth, async (request: AuthRequest, response) => {
  const testId = text(object(request.body).testId, "testId", 100);
  const test = await prisma.test.findUnique({
    where: { id: testId },
    include: { questions: { where: { question: { status: "PUBLISHED" } }, include: { question: true }, orderBy: { position: "asc" } } },
  });
  if (!test || test.isLocked) fail(404, "TEST_UNAVAILABLE", "Test not found or unavailable");
  const now = new Date();
  if (test.startTime && test.startTime > now) fail(403, "TEST_NOT_STARTED", "This test is not open yet");
  if (test.endTime && test.endTime <= now) fail(403, "TEST_CLOSED", "This test has closed");
  if (!test.questions.length) fail(400, "EMPTY_TEST", "This test has no published questions");
  const ordered = shuffle(test.questions).map(item => ({
    ...item,
    attemptOptions: shuffle(validOptions(item.question.options)),
  }));
  const attempt = await prisma.testAttempt.create({
    data: {
      studentId: request.auth!.id,
      testId,
      questionSnapshots: {
        create: ordered.map(({ questionId, marks, question, attemptOptions }, position) => ({
          question: { connect: { id: questionId } },
          marks,
          position,
          text: question.text,
          options: attemptOptions as Prisma.InputJsonValue,
          correctOptionId: question.correctOptionId,
          explanation: question.explanation,
        })),
      },
    },
  });
  response.status(201).json({
    attempt: { id: attempt.id, testId, status: attempt.status, startedAt: attempt.startedAt, durationMinutes: test.durationMinutes, expiresAt: attemptExpiresAt(attempt.startedAt, test.durationMinutes, test.endTime) },
    questions: ordered.map(({ question, attemptOptions }) => publicQuestion({ ...question, options: attemptOptions })),
    serverTime: now,
  });
});

app.get("/api/attempts/:attemptId", ...requireAuth, async (request: AuthRequest, response) => {
  const attempt = await prisma.testAttempt.findUnique({
    where: { id: routeParam(request, "attemptId") },
    include: { test: true, questionSnapshots: { orderBy: { position: "asc" } }, answers: true },
  });
  if (!attempt || (attempt.studentId !== request.auth!.id && request.auth!.role !== "ADMIN")) fail(404, "NOT_FOUND", "Attempt not found");
  const expiresAt = attemptExpiresAt(attempt.startedAt, attempt.test.durationMinutes, attempt.test.endTime);
  response.json({
    attempt: { id: attempt.id, testId: attempt.testId, status: attempt.status, startedAt: attempt.startedAt, expiresAt },
    questions: attempt.questionSnapshots.map(snapshot => ({
      id: snapshot.questionId,
      text: snapshot.text,
      options: snapshot.options,
      position: snapshot.position,
      answer: attempt.answers.find(answer => answer.questionId === snapshot.questionId)?.selectedOptionId ?? null,
    })),
  });
});

app.put("/api/attempts/:attemptId/answers/:questionId", ...requireAuth, async (request: AuthRequest, response) => {
  const body = object(request.body);
  const selectedOption = body.selectedOption === null ? null : text(body.selectedOption, "selectedOption", 50);
  const timeSpent = body.timeSpent === undefined ? undefined : integer(body.timeSpent, "timeSpent", 0, 60 * 60 * 24);
  const isMarkedForReview = body.isMarkedForReview === undefined ? undefined : body.isMarkedForReview;
  if (isMarkedForReview !== undefined && typeof isMarkedForReview !== "boolean") fail(400, "VALIDATION_ERROR", "isMarkedForReview must be a boolean");
  const attempt = await prisma.testAttempt.findUnique({
    where: { id: routeParam(request, "attemptId") },
    include: { test: true, questionSnapshots: { where: { questionId: routeParam(request, "questionId") } } },
  });
  if (!attempt || attempt.studentId !== request.auth!.id) fail(404, "NOT_FOUND", "Attempt not found");
  if (attempt.status !== "IN_PROGRESS") fail(409, "ATTEMPT_CLOSED", "Answers cannot be changed after submission");
  if (Date.now() >= attemptExpiresAt(attempt.startedAt, attempt.test.durationMinutes, attempt.test.endTime).getTime()) fail(409, "TIME_EXPIRED", "The attempt time has expired; submit the attempt");
  const snapshot = attempt.questionSnapshots[0];
  if (!snapshot) fail(400, "QUESTION_NOT_IN_ATTEMPT", "Question is not part of this attempt");
  if (selectedOption !== null) {
    const options = validOptions(snapshot.options);
    if (!options.some(option => option.id === selectedOption)) fail(400, "INVALID_OPTION", "selectedOption must match one of the question option ids");
  }
  const answer = await prisma.answer.upsert({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: snapshot.questionId } },
    create: { attemptId: attempt.id, questionId: snapshot.questionId, selectedOptionId: selectedOption, ...(timeSpent === undefined ? {} : { timeSpent }), ...(isMarkedForReview === undefined ? {} : { isMarkedForReview }) },
    update: { selectedOptionId: selectedOption, ...(timeSpent === undefined ? {} : { timeSpent }), ...(isMarkedForReview === undefined ? {} : { isMarkedForReview }) },
  });
  response.json({ answer, savedAt: new Date() });
});

async function gradeAttempt(attemptId: string, userId: string, isAdmin = false) {
  return prisma.$transaction(async tx => {
    const attempt = await tx.testAttempt.findUnique({
      where: { id: attemptId },
      include: { test: true, questionSnapshots: true, answers: true },
    });
    if (!attempt || (!isAdmin && attempt.studentId !== userId)) fail(404, "NOT_FOUND", "Attempt not found");
    if (attempt.status === "IN_PROGRESS") {
      const answersByQuestion = new Map(attempt.answers.map(answer => [answer.questionId, answer]));
      let score = 0;
      for (const entry of attempt.questionSnapshots) {
        const answer = answersByQuestion.get(entry.questionId);
        const isCorrect = Boolean(answer?.selectedOptionId && answer.selectedOptionId === entry.correctOptionId);
        if (answer) await tx.answer.update({ where: { id: answer.id }, data: { isCorrect } });
        if (isCorrect) score += entry.marks;
        else if (answer?.selectedOptionId) score -= attempt.test.negativeMarking;
      }
      const graded = await tx.testAttempt.updateMany({
        where: { id: attempt.id, status: "IN_PROGRESS" },
        data: { status: "GRADED", submittedAt: new Date(), totalScore: score },
      });
      if (!graded.count) fail(409, "ATTEMPT_CLOSED", "Attempt was submitted concurrently");
    }
    const finalAttempt = await tx.testAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: {
        test: true,
        answers: true,
        questionSnapshots: {
          orderBy: { position: "asc" },
          include: { question: { select: { subject: true, chapter: true } } },
        },
      },
    });
    const correct = finalAttempt.answers.filter(answer => answer.isCorrect).length;
    const incorrect = finalAttempt.answers.filter(answer => answer.selectedOptionId && answer.isCorrect === false).length;
    const unanswered = finalAttempt.questionSnapshots.length - finalAttempt.answers.filter(answer => answer.selectedOptionId).length;
    const rank = 1 + await tx.testAttempt.count({
      where: {
        testId: finalAttempt.testId,
        status: { in: ["SUBMITTED", "GRADED"] },
        totalScore: { gt: finalAttempt.totalScore ?? 0 },
      },
    });
    if (finalAttempt.rank !== rank) {
      await tx.testAttempt.update({ where: { id: finalAttempt.id }, data: { rank } });
    }
    return {
      id: finalAttempt.id,
      test: { id: finalAttempt.test.id, name: finalAttempt.test.name },
      status: finalAttempt.status,
      startedAt: finalAttempt.startedAt,
      submittedAt: finalAttempt.submittedAt,
      score: finalAttempt.totalScore,
      totalMarks: finalAttempt.test.totalMarks,
      rank,
      correct,
      incorrect,
      unanswered,
      answers: finalAttempt.questionSnapshots.map(snapshot => {
        const answer = finalAttempt.answers.find(item => item.questionId === snapshot.questionId);
        return {
          questionId: snapshot.questionId,
          text: snapshot.text,
          subject: snapshot.question.subject,
          chapter: snapshot.question.chapter,
          options: snapshot.options,
          selectedOption: answer?.selectedOptionId ?? null,
          correctOptionId: snapshot.correctOptionId,
          isCorrect: answer?.isCorrect ?? false,
          marks: answer?.isCorrect ? snapshot.marks : answer?.selectedOptionId ? -finalAttempt.test.negativeMarking : 0,
          explanation: snapshot.explanation,
        };
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

app.post("/api/attempts/:attemptId/submit", ...requireAuth, async (request: AuthRequest, response) => {
  const result = await gradeAttempt(routeParam(request, "attemptId"), request.auth!.id);
  response.json({ result });
});

app.get("/api/attempts/:attemptId/result", ...requireAuth, async (request: AuthRequest, response) => {
  const attempt = await prisma.testAttempt.findUnique({ where: { id: routeParam(request, "attemptId") }, select: { studentId: true, status: true } });
  if (!attempt || (attempt.studentId !== request.auth!.id && request.auth!.role !== "ADMIN")) fail(404, "NOT_FOUND", "Result not found");
  if (attempt.status === "IN_PROGRESS") fail(409, "NOT_GRADED", "Submit the attempt before viewing results");
  response.json({ result: await gradeAttempt(routeParam(request, "attemptId"), request.auth!.id, request.auth!.role === "ADMIN") });
});

app.get("/api/results", ...requireAuth, async (request: AuthRequest, response) => {
  const { page, limit, skip } = pagination(request);
  const where: Prisma.TestAttemptWhereInput = request.auth!.role === "ADMIN" && request.query.userId
    ? { studentId: text(request.query.userId, "userId", 100), status: { in: ["SUBMITTED", "GRADED"] } }
    : { studentId: request.auth!.id, status: { in: ["SUBMITTED", "GRADED"] } };
  const [attempts, total] = await prisma.$transaction([
    prisma.testAttempt.findMany({ where, skip, take: limit, orderBy: { submittedAt: "desc" }, include: { test: { select: { id: true, name: true, totalMarks: true } } } }),
    prisma.testAttempt.count({ where }),
  ]);
  response.json(pageResult(
    attempts.map(({ id, status, startedAt, submittedAt, totalScore, rank, test }) => ({
      id,
      status,
      startedAt,
      submittedAt,
      score: totalScore,
      totalMarks: test.totalMarks,
      rank,
      test,
    })),
    total,
    page,
    limit,
  ));
});

app.get("/api/admin/users", ...requireAdmin, async (request, response) => {
  const { page, limit, skip } = pagination(request);
  const where: Prisma.UserWhereInput = {};
  if (request.query.search) where.phone = { contains: text(request.query.search, "search", 50) };
  if (request.query.role) where.role = enumValue(request.query.role, "role", ["STUDENT", "ADMIN"] as const);
  if (request.query.blocked !== undefined) {
    if (!["true", "false"].includes(String(request.query.blocked))) fail(400, "VALIDATION_ERROR", "blocked must be true or false");
    where.isBlocked = String(request.query.blocked) === "true";
  }
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        phone: true,
        role: true,
        isBlocked: true,
        createdAt: true,
        profile: true,
        attempts: {
          where: { status: { in: ["SUBMITTED", "GRADED"] } },
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { totalScore: true, test: { select: { totalMarks: true } } },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);
  response.json(pageResult(users, total, page, limit));
});

app.patch("/api/admin/users/:userId/block", ...requireAdmin, async (request: AuthRequest, response) => {
  const blocked = object(request.body).isBlocked;
  if (typeof blocked !== "boolean") fail(400, "VALIDATION_ERROR", "isBlocked must be a boolean");
  const userId = routeParam(request, "userId");
  if (userId === request.auth!.id && blocked) fail(400, "SELF_BLOCK", "You cannot block your own admin account");
  const user = await prisma.user.update({ where: { id: userId }, data: { isBlocked: blocked }, select: { id: true, phone: true, role: true, isBlocked: true } });
  response.json({ user });
});

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) fail(400, "INVALID_CSV", "CSV contains an unterminated quoted field");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

app.use((error: ApiError, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    return response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: {
        code: error.code,
        message: error.code === "LIMIT_FILE_SIZE" ? "Image files must be 5 MB or smaller" : "Could not process the uploaded file",
      },
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return response.status(409).json({ error: { code: "CONFLICT", message: "A record with these values already exists" } });
    if (error.code === "P2025") return response.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found" } });
    if (error.code === "P2003" || error.code === "P2014") return response.status(409).json({ error: { code: "RELATION_CONFLICT", message: "Record is still referenced by related data" } });
  }
  const status = error.status ?? (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError" ? 401 : 500);
  if (status >= 500) console.error(error);
  response.status(status).json({
    error: {
      code: error.code ?? (status === 401 ? "INVALID_TOKEN" : status === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR"),
      message: status >= 500 ? "An unexpected server error occurred" : error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  });
});

const server = app.listen(port, () => {
  console.log(`NEET Pro API listening on port ${port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

export { app, gradeAttempt, parseCsv };
