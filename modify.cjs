const fs = require('fs');

let repo = fs.readFileSync('src/modules/session/session.repository.ts', 'utf8');
repo = repo.replace(
`    return prisma.result.update({
      where: { id: result.id },
      data: { totalScore, maxScore, percentage, isPassed: percentage >= passingPercentage }
    });
  }
}

export const sessionRepository = new SessionRepository();`,
`    return prisma.result.update({
      where: { id: result.id },
      data: { totalScore, maxScore, percentage, isPassed: percentage >= passingPercentage }
    });
  }

  async updateResultReviewStatus(sessionId: string, isPassed: boolean | null) {
    return prisma.result.upsert({
      where: { sessionId },
      update: { isPassed },
      create: {
        sessionId,
        isPassed,
        totalScore: 0,
        maxScore: 0,
        percentage: 0
      }
    });
  }
}

export const sessionRepository = new SessionRepository();`
);
fs.writeFileSync('src/modules/session/session.repository.ts', repo);
