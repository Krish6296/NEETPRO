import dotenv from "dotenv";
import { PrismaClient, type QuestionDifficulty } from "@prisma/client";

dotenv.config();
dotenv.config({ path: "../.env" });

const prisma = new PrismaClient();
const topics = [
  { subject: "Biology", chapter: "Cell Biology", concepts: ["cell membrane", "mitochondrion", "ribosome", "nucleus", "Golgi apparatus", "endoplasmic reticulum", "lysosome", "chloroplast", "cell wall", "nucleolus", "chromosome", "cytoplasm", "vacuole", "centrosome", "plasma membrane"] },
  { subject: "Biology", chapter: "Human Physiology", concepts: ["alveoli", "nephron", "cardiac cycle", "insulin", "nerve impulse", "haemoglobin", "bile", "pepsin", "glomerulus", "synapse", "thyroxine", "myoglobin", "platelet", "diaphragm", "peristalsis"] },
  { subject: "Chemistry", chapter: "Chemical Bonding", concepts: ["ionic bond", "covalent bond", "hybridization", "molecular shape", "hydrogen bonding", "coordinate bond", "dipole moment", "bond angle", "lone pair", "valence shell", "electronegativity", "bond order", "sigma bond", "pi bond", "lattice energy"] },
  { subject: "Chemistry", chapter: "Organic Chemistry", concepts: ["alkane", "alkene", "functional group", "isomerism", "nucleophile", "electrophile", "aromaticity", "ester", "aldehyde", "ketone", "carboxylic acid", "amine", "polymerization", "addition reaction", "substitution reaction"] },
  { subject: "Physics", chapter: "Mechanics", concepts: ["Newton's second law", "momentum", "work", "kinetic energy", "circular motion", "displacement", "acceleration", "inertia", "impulse", "power", "torque", "angular momentum", "gravitational potential energy", "friction", "centripetal force"] },
  { subject: "Physics", chapter: "Electricity", concepts: ["Ohm's law", "resistance", "electric power", "capacitor", "electric field", "electric potential", "current", "charge", "electric flux", "Coulomb's law", "resistivity", "Kirchhoff's law", "electromotive force", "electric dipole", "capacitance"] },
];

async function main() {
  const adminPhone = process.env.ADMIN_PHONE ?? "+15550000001";
  await prisma.user.upsert({
    where: { phone: adminPhone },
    create: { phone: adminPhone, role: "ADMIN", profile: { displayName: "Demo Administrator" } },
    update: { role: "ADMIN" },
  });

  const topicGroups = {
    Physics: topics.filter(topic => topic.subject === "Physics"),
    Chemistry: topics.filter(topic => topic.subject === "Chemistry"),
    Biology: topics.filter(topic => topic.subject === "Biology"),
  };
  const subjectRanges = [
    { subject: "Physics", start: 0, count: 90 },
    { subject: "Chemistry", start: 90, count: 90 },
    { subject: "Biology", start: 180, count: 180 },
  ] as const;
  const data = subjectRanges.flatMap(({ subject, start, count }) =>
    Array.from({ length: count }, (_, localIndex) => {
      const subjectTopics = topicGroups[subject];
      const topic = subjectTopics[localIndex % subjectTopics.length];
      const concept = topic.concepts[Math.floor(localIndex / subjectTopics.length) % topic.concepts.length];
      const correctOptionId = ["A", "B", "C", "D"][localIndex % 4];
      const distractors = subjectTopics.flatMap(item => item.concepts).filter(item => item !== concept);
      const options = ["A", "B", "C", "D"].map((id, optionIndex) => ({
        id,
        text: id === correctOptionId
          ? `${concept} is associated with ${topic.chapter}.`
          : `${distractors[(localIndex + optionIndex) % distractors.length]} is a different ${subject} concept.`,
      }));
      const index = start + localIndex;
      return {
        text: `[Seed] In ${topic.chapter}, which concept is associated with ${concept}? (Question ${index + 1})`,
        options,
        correctOptionId,
        explanation: `This demonstration item is illustrative. Review ${concept} in ${topic.chapter} before relying on it for study.`,
        difficulty: ["EASY", "MEDIUM", "HARD"][index % 3] as QuestionDifficulty,
        subject,
        chapter: topic.chapter,
        tags: ["sample", "seed"],
        status: "PUBLISHED" as const,
      };
    }),
  );
  const existingQuestions = await prisma.question.findMany({
    where: { text: { startsWith: "[Seed] " } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  for (const [index, question] of existingQuestions.slice(0, data.length).entries()) {
    await prisma.question.update({ where: { id: question.id }, data: data[index] });
  }
  if (existingQuestions.length < data.length) {
    await prisma.question.createMany({ data: data.slice(existingQuestions.length) });
  }

  const questions = await prisma.question.findMany({
    where: { text: { startsWith: "[Seed] " }, status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, subject: true },
  });
  if (questions.length < 360) throw new Error(`Expected 360 published seed questions; found ${questions.length}`);

  const names = ["NEET Pro Full Mock 1", "NEET Pro Full Mock 2"];
  const previousNames = ["NEET Pro Sample Mock 1", "NEET Pro Sample Mock 2"];
  const subjectQuestions = {
    Physics: questions.filter(question => question.subject === "Physics").map(question => question.id),
    Chemistry: questions.filter(question => question.subject === "Chemistry").map(question => question.id),
    Biology: questions.filter(question => question.subject === "Biology").map(question => question.id),
  };
  for (const [index, name] of names.entries()) {
    const test = await prisma.test.findFirst({
      where: { name: { in: [name, previousNames[index]] } },
    });
    const savedTest = test
      ? await prisma.test.update({
        where: { id: test.id },
        data: { name, type: "FULL_MOCK", durationMinutes: 180, totalMarks: 720, negativeMarking: 1 },
      })
      : await prisma.test.create({
        data: { name, type: "FULL_MOCK", durationMinutes: 180, totalMarks: 720, negativeMarking: 1 },
      });
    const offset = index * 45;
    const selectedIds = [
      ...subjectQuestions.Physics.slice(offset, offset + 45),
      ...subjectQuestions.Chemistry.slice(offset, offset + 45),
      ...subjectQuestions.Biology.slice(index * 90, (index + 1) * 90),
    ];
    await prisma.$transaction([
      prisma.testQuestion.deleteMany({ where: { testId: savedTest.id } }),
      prisma.testQuestion.createMany({
        data: selectedIds.map((questionId, position) => ({ testId: savedTest.id, questionId, position })),
      }),
    ]);
  }
  console.log(`Seeded demo administrator ${adminPhone}, 360 illustrative sample questions, and 2 balanced full mock tests. Sample questions are not verified past-paper content; the Previous Year Questions category requires verified, year-tagged questions.`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
