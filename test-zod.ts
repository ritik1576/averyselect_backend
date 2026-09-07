import { z } from 'zod';

const assessmentQuestionSchema = z.object({
  questionId: z.string().uuid(),
  orderIdx: z.number().int().min(0),
});

const createAssessmentSchema = z.object({
  title: z.string().min(3),
  questions: z.array(assessmentQuestionSchema).optional().refine(
    (questions) => {
      if (!questions) return true;
      const ids = questions.map(q => q.questionId);
      if (new Set(ids).size !== ids.length) return false;
      
      const orders = questions.map(q => q.orderIdx);
      if (new Set(orders).size !== orders.length) return false;

      return true;
    },
    { message: "Questions must be unique and have unique order indices" }
  )
});

try {
  createAssessmentSchema.parse({
    title: "Test",
    questions: [
      { questionId: "0b1cc5d3-8ea9-42b4-9278-f7b56d36e2f1", orderIdx: 1 },
      { questionId: "1b1cc5d3-8ea9-42b4-9278-f7b56d36e2f1", orderIdx: 1 }
    ]
  });
} catch (e) {
  console.log("Error:", e.issues[0].message);
}
