const fs = require('fs');
const path = 'src/modules/session/session.controller.ts';
let ctrl = fs.readFileSync(path, 'utf8');

const newSchema = `
const updateReviewStatusSchema = z.object({
  isPassed: z.boolean().nullable()
});

`;

const newMethod = `
  updateReviewStatus = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
    const { companyId } = req.user!;
    const { sessionId } = req.params;

    const parsed = updateReviewStatusSchema.parse(req.body);

    const result = await sessionService.updateReviewStatus(
      sessionId, companyId, parsed.isPassed
    );

    res.status(200).json({ success: true, data: result });
  });
}
`;

ctrl = ctrl.replace(
`// ── Controller ────────────────────────────────────────────────────────────────`,
newSchema + `// ── Controller ────────────────────────────────────────────────────────────────`
);

ctrl = ctrl.replace(
`    res.status(200).json({ success: true, data: result });
  });
}`,
`    res.status(200).json({ success: true, data: result });
  });` + newMethod
);

fs.writeFileSync(path, ctrl);
