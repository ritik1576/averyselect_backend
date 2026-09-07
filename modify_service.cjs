const fs = require('fs');
const path = 'src/modules/session/session.service.ts';
let svc = fs.readFileSync(path, 'utf8');

// Insert after updateQuestionScore
const newMethod = `
  async updateReviewStatus(sessionId: string, companyId: string, isPassed: boolean | null) {
    // Basic authorization check - ensure session belongs to company
    const session = await sessionRepository.findSessionReport(sessionId, companyId);
    if (!session || session.assessment.companyId !== companyId) {
      throw new AppError('Session not found', 404);
    }
    
    return sessionRepository.updateResultReviewStatus(sessionId, isPassed);
  }
}
`;

svc = svc.replace(
`    return sessionRepository.updateQuestionScore(sessionId, questionId, score);
  }
}`,
`    return sessionRepository.updateQuestionScore(sessionId, questionId, score);
  }` + newMethod
);

fs.writeFileSync(path, svc);
